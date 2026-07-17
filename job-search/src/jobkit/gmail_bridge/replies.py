"""Sync genuine inbound Gmail replies for sent applications into the hosted worker.

Read-only against Gmail: one `threads.get` per sent attempt with a recorded
gmail_thread_id, plus one `messages.get` (full format) per reply that survives
classification. Classification reuses the tracking module's bounce/auto-reply
filters so only real human replies are recorded. The worker is fail-closed: it
only accepts inbound rows whose gmail_thread_id matches one of the signed-in
user's own sent attempts, and duplicate gmail message ids are no-ops.
"""

from __future__ import annotations

import base64
import json
import subprocess
from typing import TYPE_CHECKING, cast

from jobkit.outreach.gmail import ThreadMessage
from jobkit.outreach.track import _is_automated, _is_inbound, _iso_from_ms

if TYPE_CHECKING:
    from jobkit.gmail_bridge.api import JobKitClient

type JsonObj = dict[str, object]


def sync_inbound_replies(
    api: JobKitClient,
    gws_profile: str,
    *,
    sender_email: str,
) -> dict[str, int]:
    """Pull replies for every sent attempt into the worker; return sync counters."""
    stats = {
        "duplicates": 0,
        "recorded": 0,
        "replies_seen": 0,
        "skipped_automated": 0,
        "threads_checked": 0,
    }
    sender = sender_email.lower()
    for attempt in api.list_email_attempts("sent"):
        thread_id = attempt.get("gmailThreadId")
        if not (isinstance(thread_id, str) and thread_id):
            continue
        stats["threads_checked"] += 1
        for message in _thread_messages(gws_profile, thread_id):
            if message.is_sent or sender in message.headers.get("From", "").lower():
                continue
            stats["replies_seen"] += 1
            if _is_automated(message) or not _is_inbound(message, sender):
                stats["skipped_automated"] += 1
                continue
            payload: JsonObj = {
                "bodyText": _message_text(gws_profile, message.msg_id) or "(no text body)",
                "fromAddress": message.headers.get("From", ""),
                "gmailMessageId": message.msg_id,
                "gmailThreadId": thread_id,
                "sentAt": _iso_from_ms(message.internal_date_ms),
                "subject": message.headers.get("Subject", ""),
                "toAddress": message.headers.get("To", ""),
            }
            result = api.record_inbound_message(payload)
            if result.get("created"):
                stats["recorded"] += 1
            else:
                stats["duplicates"] += 1
    return stats


def _run_read(gws_profile: str, resource: str, method: str, params: JsonObj) -> JsonObj:
    """Run one read-only `gws-profile <profile> gmail` call and parse its JSON output."""
    result = subprocess.run(  # noqa: S603 - fixed argv; read-only verb; JSON-quoted params.
        ["gws-profile", gws_profile, "gmail", *resource.split(), method, "--params", json.dumps(params)],  # noqa: S607
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        msg = f"gmail {resource} {method} failed: {result.stderr.strip() or result.stdout.strip()}"
        raise RuntimeError(msg)
    parsed = json.loads(result.stdout or "{}")
    return cast("JsonObj", parsed) if isinstance(parsed, dict) else {}


def _thread_messages(gws_profile: str, thread_id: str) -> list[ThreadMessage]:
    """Fetch a thread's messages with metadata headers, sorted by internal date."""
    data = _run_read(
        gws_profile,
        "users threads",
        "get",
        {"userId": "me", "id": thread_id, "format": "metadata"},
    )
    messages: list[ThreadMessage] = []
    raw_messages = data.get("messages")
    for raw in raw_messages if isinstance(raw_messages, list) else []:
        if not isinstance(raw, dict):
            continue
        payload = raw.get("payload")
        headers: dict[str, str] = {}
        if isinstance(payload, dict):
            raw_headers = payload.get("headers")
            for header in raw_headers if isinstance(raw_headers, list) else []:
                if isinstance(header, dict):
                    name, value = header.get("name"), header.get("value")
                    if isinstance(name, str) and isinstance(value, str):
                        headers[name] = value
        raw_labels = raw.get("labelIds")
        labels = tuple(
            label for label in (raw_labels if isinstance(raw_labels, list) else []) if isinstance(label, str)
        )
        try:
            internal = int(cast("int", raw.get("internalDate", 0)))
        except (TypeError, ValueError):
            internal = 0
        msg_id = raw.get("id")
        messages.append(
            ThreadMessage(
                msg_id=msg_id if isinstance(msg_id, str) else "",
                label_ids=labels,
                headers=headers,
                internal_date_ms=internal,
            ),
        )
    messages.sort(key=lambda m: m.internal_date_ms)
    return messages


def _message_text(gws_profile: str, msg_id: str) -> str:
    """Fetch one message in full format and return its decoded text/plain body."""
    data = _run_read(
        gws_profile,
        "users messages",
        "get",
        {"userId": "me", "id": msg_id, "format": "full"},
    )
    payload = data.get("payload")
    text = _walk_text(payload) if isinstance(payload, dict) else ""
    if text:
        return text.strip()
    snippet = data.get("snippet")
    return snippet.strip() if isinstance(snippet, str) else ""


def _walk_text(part: JsonObj) -> str:
    """Depth-first search for the first decodable text/plain part."""
    body = part.get("body")
    data = body.get("data") if isinstance(body, dict) else None
    if part.get("mimeType") == "text/plain" and isinstance(data, str):
        return base64.urlsafe_b64decode(data + "===").decode("utf-8", errors="replace")
    parts = part.get("parts")
    for sub in parts if isinstance(parts, list) else []:
        if isinstance(sub, dict):
            text = _walk_text(cast("JsonObj", sub))
            if text:
                return text
    return ""
