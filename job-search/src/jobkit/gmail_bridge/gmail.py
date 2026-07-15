"""Exact Gmail draft creation, explicit sending, and post-send verification via `gws`."""

from __future__ import annotations

import base64
import binascii
import json
import subprocess
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, cast

if TYPE_CHECKING:
    from collections.abc import Sequence

type JsonObject = dict[str, object]
type CommandRunner = Callable[..., subprocess.CompletedProcess[str]]
DEFAULT_GWS_TIMEOUT_SECONDS = 90.0


class GmailBridgeError(RuntimeError):
    """The Gmail CLI failed or returned an invalid/unverified response."""


class GmailSendUncertainError(GmailBridgeError):
    """Gmail send was invoked, so retrying could duplicate an external message."""

    def __init__(
        self,
        message: str,
        *,
        gmail_message_id: str | None = None,
        gmail_thread_id: str | None = None,
    ) -> None:
        """Capture any identifiers returned before send verification failed."""
        super().__init__(message)
        self.gmail_message_id = gmail_message_id
        self.gmail_thread_id = gmail_thread_id


@dataclass(frozen=True)
class GmailDraft:
    """The identifiers returned after Gmail creates a draft."""

    draft_id: str
    message_id: str


@dataclass(frozen=True)
class SentGmailMessage:
    """A sent Gmail message whose SENT label has been independently verified."""

    message_id: str
    thread_id: str


class GmailClient:
    """Run narrowly bounded Gmail operations through a named `gws-profile`."""

    def __init__(
        self,
        profile: str,
        *,
        runner: CommandRunner = subprocess.run,
        timeout_seconds: float = DEFAULT_GWS_TIMEOUT_SECONDS,
    ) -> None:
        """Create a Gmail CLI client without invoking it."""
        if not profile.strip():
            msg = "Gmail profile must not be empty"
            raise ValueError(msg)
        if timeout_seconds <= 0:
            msg = "Gmail CLI timeout must be positive"
            raise ValueError(msg)
        self._prefix = ("gws-profile", profile, "gmail")
        self._runner = runner
        self._timeout_seconds = timeout_seconds

    def create_draft_from_raw(self, raw: str) -> GmailDraft:
        """Decode hosted base64url MIME into a mode-600 temporary file and upload one draft."""
        mime = decode_raw_mime(raw)
        # gws intentionally rejects uploads outside its working tree. Keep the
        # short-lived file inside cwd while preserving owner-only permissions
        # and automatic deletion after the upload subprocess returns.
        with tempfile.NamedTemporaryFile(
            dir=Path.cwd(), prefix=".jobkit-", suffix=".eml"
        ) as message_file:
            Path(message_file.name).chmod(0o600)
            message_file.write(mime)
            message_file.flush()
            result = self._run(
                (
                    "users",
                    "drafts",
                    "create",
                    "--params",
                    json.dumps({"userId": "me"}),
                    "--upload",
                    message_file.name,
                    "--upload-content-type",
                    "message/rfc822",
                ),
            )
        payload = _json_object(result.stdout, operation="gmail drafts create")
        draft_id = _required_string(payload, "id", operation="gmail drafts create")
        message = _required_object(payload, "message", operation="gmail drafts create")
        message_id = _required_string(message, "id", operation="gmail drafts create")
        return GmailDraft(draft_id=draft_id, message_id=message_id)

    def send_and_verify_draft(self, draft_id: str) -> SentGmailMessage:
        """Explicitly send one existing Gmail draft, then require its live SENT label."""
        if not draft_id.strip():
            msg = "Gmail draft id must not be empty"
            raise ValueError(msg)
        message_id: str | None = None
        thread_id: str | None = None
        try:
            sent_result = self._run(
                (
                    "users",
                    "drafts",
                    "send",
                    "--params",
                    json.dumps({"userId": "me"}),
                    "--json",
                    json.dumps({"id": draft_id}),
                ),
            )
            sent = _json_object(sent_result.stdout, operation="gmail drafts send")
            message_id = _required_string(sent, "id", operation="gmail drafts send")
            thread_id = _required_string(sent, "threadId", operation="gmail drafts send")

            verified_result = self._run(
                (
                    "users",
                    "messages",
                    "get",
                    "--params",
                    json.dumps({"userId": "me", "id": message_id, "format": "metadata"}),
                ),
            )
            verified = _json_object(verified_result.stdout, operation="gmail messages get")
            verified_id = _required_string(verified, "id", operation="gmail messages get")
            if verified_id != message_id:
                msg = "Gmail verification returned a different message id"
                raise GmailBridgeError(msg)
            label_ids = verified.get("labelIds")
            if not isinstance(label_ids, list) or "SENT" not in label_ids:
                msg = f"Gmail message {message_id} could not be verified with the SENT label"
                raise GmailBridgeError(msg)
            verified_thread = _required_string(
                verified,
                "threadId",
                operation="gmail messages get",
            )
            if verified_thread != thread_id:
                msg = "Gmail verification returned a different thread id"
                raise GmailBridgeError(msg)
        except (OSError, RuntimeError, ValueError) as exc:
            msg = f"Gmail send was invoked but could not be verified: {exc}"
            raise GmailSendUncertainError(
                msg,
                gmail_message_id=message_id,
                gmail_thread_id=thread_id,
            ) from exc
        return SentGmailMessage(message_id=message_id, thread_id=thread_id)

    def _run(self, arguments: Sequence[str]) -> subprocess.CompletedProcess[str]:
        """Run one fixed-shape Gmail command and require a zero exit status."""
        command = [*self._prefix, *arguments]
        try:
            result = self._runner(
                command,
                check=False,
                capture_output=True,
                text=True,
                timeout=self._timeout_seconds,
            )
        except subprocess.SubprocessError as exc:
            operation = " ".join(arguments[:3])
            msg = f"Gmail CLI did not complete safely: {operation}: {exc}"
            raise GmailBridgeError(msg) from exc
        if result.returncode != 0:
            detail = result.stderr.strip() or result.stdout.strip() or "no CLI output"
            operation = " ".join(arguments[:3])
            msg = f"Gmail CLI failed: {operation}: {detail[:500]}"
            raise GmailBridgeError(msg)
        return result


def decode_raw_mime(raw: str) -> bytes:
    """Strictly decode one non-empty base64url Gmail raw message."""
    if not raw.strip():
        msg = "JobKit returned an empty Gmail raw message"
        raise GmailBridgeError(msg)
    encoded = raw.encode("ascii", errors="strict")
    padding = b"=" * (-len(encoded) % 4)
    try:
        mime = base64.b64decode(encoded + padding, altchars=b"-_", validate=True)
    except (binascii.Error, ValueError) as exc:
        msg = "JobKit returned invalid base64url Gmail MIME"
        raise GmailBridgeError(msg) from exc
    if not mime.strip():
        msg = "JobKit returned an empty decoded Gmail MIME message"
        raise GmailBridgeError(msg)
    return mime


def _json_object(stdout: str, *, operation: str) -> JsonObject:
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError as exc:
        msg = f"{operation} returned invalid JSON"
        raise GmailBridgeError(msg) from exc
    if not isinstance(payload, dict):
        msg = f"{operation} returned a non-object JSON response"
        raise GmailBridgeError(msg)
    return cast("JsonObject", payload)


def _required_object(payload: JsonObject, key: str, *, operation: str) -> JsonObject:
    value = payload.get(key)
    if not isinstance(value, dict):
        msg = f"{operation} response is missing object field: {key}"
        raise GmailBridgeError(msg)
    return cast("JsonObject", value)


def _required_string(payload: JsonObject, key: str, *, operation: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        msg = f"{operation} response is missing string field: {key}"
        raise GmailBridgeError(msg)
    return value
