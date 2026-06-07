"""Read-only Gmail access for follow-up tracking — list SENT outreach and inspect threads.

Wraps the authed Google Workspace CLI (`gws-profile chibuzor gmail <resource> <method>`) for the
two READ operations tracking needs: list message ids matching a bounded query, and fetch a thread's
per-message metadata (labels, From, Subject, Date, Message-ID). Bodies are not needed for tracking,
so we request `format=metadata` to keep fetches small and never decode message text here.

This module performs NO mailbox writes — every verb here is a `list`/`get`. Drafting (the only
allowed mutation, `users.drafts.create`) lives in `jobkit.outreach.draft`; there is no send path
anywhere in the package.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from typing import cast

# A decoded JSON object as returned by the Gmail CLI (string keys, arbitrary values).
type JsonObj = dict[str, object]

_GWS = ("gws-profile", "chibuzor", "gmail")


@dataclass(frozen=True)
class ThreadMessage:
    """One message in a thread: its labels, key headers, and Gmail's internalDate (epoch ms)."""

    msg_id: str
    label_ids: tuple[str, ...]
    headers: dict[str, str]
    internal_date_ms: int

    @property
    def is_sent(self) -> bool:
        """True if this message was sent by us (carries the SENT label)."""
        return "SENT" in self.label_ids

    @property
    def message_id_header(self) -> str:
        """The RFC822 `Message-ID` header (used for In-Reply-To/References), or ''."""
        return self.headers.get("Message-ID", "")


@dataclass(frozen=True)
class ThreadInfo:
    """A thread's id, its messages in order, and the addressee of our first sent message."""

    thread_id: str
    messages: tuple[ThreadMessage, ...]


def _run_read(resource: str, method: str, params: dict[str, object]) -> dict[str, object]:
    """Run a read-only `gws-profile ... <resource> <method>` call and parse its JSON output."""
    result = subprocess.run(  # noqa: S603 - fixed argv; read-only verb; JSON-quoted params.
        [*_GWS, *resource.split(), method, "--params", json.dumps(params)],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        msg = f"gmail {resource} {method} failed: {result.stderr.strip() or result.stdout.strip()}"
        raise RuntimeError(msg)
    try:
        parsed = json.loads(result.stdout or "{}")
    except json.JSONDecodeError as exc:
        msg = f"could not parse gmail {resource} {method} response"
        raise RuntimeError(msg) from exc
    return parsed if isinstance(parsed, dict) else {}


def list_sent_thread_ids(
    query: str,
    *,
    max_fetches: int,
    page_size: int = 100,
) -> tuple[list[str], int]:
    """Return (distinct thread ids, number of `messages.list` pages fetched) for `query`.

    Bounded: pages at most `max_fetches` times (one Gmail `messages.list` call per page), so a
    typical sync is a handful of list calls plus one `threads.get` per new/active thread.
    """
    seen: dict[str, None] = {}
    page_token: str | None = None
    pages = 0
    for _ in range(max_fetches):
        params: dict[str, object] = {"userId": "me", "q": query, "maxResults": page_size}
        if page_token:
            params["pageToken"] = page_token
        page = _run_read("users messages", "list", params)
        pages += 1
        for entry in _as_obj_list(page.get("messages")):
            tid = entry.get("threadId")
            if isinstance(tid, str):
                seen.setdefault(tid, None)
        next_token = page.get("nextPageToken")
        if not isinstance(next_token, str) or not next_token:
            break
        page_token = next_token
    return list(seen), pages


def any_matching(query: str) -> bool:
    """Return True if any message matches `query` (one `messages.list` call, maxResults=1).

    Used by the outreach CLI's de-dup guard: before staging an initial draft it checks whether a
    draft or sent message to the same address with the same subject already exists, so re-running
    the same input file never piles up duplicate drafts. Read-only.
    """
    page = _run_read("users messages", "list", {"userId": "me", "q": query, "maxResults": 1})
    return bool(_as_obj_list(page.get("messages")))


def get_thread(thread_id: str) -> ThreadInfo:
    """Fetch a thread's messages with metadata headers (one Gmail `threads.get` call)."""
    # Use plain `metadata` format: this CLI returns the full header set then, whereas passing
    # `metadataHeaders` paradoxically suppresses the headers. `metadata` still omits bodies, so
    # fetches stay small (we only ever read From/To/Subject/Date/Message-ID + labels).
    data = _run_read(
        "users threads",
        "get",
        {"userId": "me", "id": thread_id, "format": "metadata"},
    )
    messages: list[ThreadMessage] = []
    for raw in _as_obj_list(data.get("messages")):
        payload = raw.get("payload")
        headers: dict[str, str] = {}
        if isinstance(payload, dict):
            for header in _as_obj_list(cast("JsonObj", payload).get("headers")):
                name = header.get("name")
                value = header.get("value")
                if isinstance(name, str) and isinstance(value, str):
                    headers[name] = value
        raw_labels = raw.get("labelIds")
        labels = tuple(
            label_id
            for label_id in (raw_labels if isinstance(raw_labels, list) else [])
            if isinstance(label_id, str)
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
    return ThreadInfo(thread_id=thread_id, messages=tuple(messages))


def _as_obj_list(value: object) -> list[JsonObj]:
    """Coerce a decoded JSON value to a list of JSON objects (dropping non-dict entries)."""
    if not isinstance(value, list):
        return []
    return [cast("JsonObj", item) for item in value if isinstance(item, dict)]
