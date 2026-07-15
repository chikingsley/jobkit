"""Subprocess and temporary-file tests for Gmail operations."""

from __future__ import annotations

import base64
import json
import stat
import subprocess
import unittest
from pathlib import Path

from jobkit.gmail_bridge.gmail import (
    GmailBridgeError,
    GmailClient,
    GmailSendUncertainError,
    decode_raw_mime,
)


class GmailClientTests(unittest.TestCase):
    """Verify exact argv, secure ephemeral MIME upload, and SENT-label checks."""

    def test_create_draft_uses_secure_temporary_eml_and_cleans_it(self) -> None:
        """Decoded MIME exists only during draft upload and has owner-only permissions."""
        mime = b"From: me@example.com\r\nTo: you@example.com\r\n\r\nHello\r\n"
        raw = base64.urlsafe_b64encode(mime).decode("ascii").rstrip("=")
        observed_path: Path | None = None

        def runner(
            command: list[str],
            **kwargs: object,
        ) -> subprocess.CompletedProcess[str]:
            nonlocal observed_path
            self.assertEqual(kwargs["timeout"], 90.0)
            upload_index = command.index("--upload") + 1
            observed_path = Path(command[upload_index])
            self.assertEqual(observed_path.suffix, ".eml")
            self.assertEqual(observed_path.parent, Path.cwd())
            self.assertEqual(observed_path.read_bytes(), mime)
            mode = stat.S_IMODE(observed_path.stat().st_mode)
            self.assertEqual(mode, 0o600)
            self.assertEqual(command[-2:], ["--upload-content-type", "message/rfc822"])
            return subprocess.CompletedProcess(
                command,
                0,
                stdout=json.dumps({"id": "draft-1", "message": {"id": "message-1"}}),
                stderr="",
            )

        draft = GmailClient("chibuzor", runner=runner).create_draft_from_raw(raw)
        self.assertEqual(draft.draft_id, "draft-1")
        self.assertEqual(draft.message_id, "message-1")
        if observed_path is None:
            self.fail("runner did not observe an upload path")
        self.assertFalse(observed_path.exists())

    def test_send_requires_follow_up_get_with_sent_label(self) -> None:
        """A send result is not accepted until messages.get independently returns SENT."""
        commands: list[list[str]] = []

        def runner(
            command: list[str],
            **_kwargs: object,
        ) -> subprocess.CompletedProcess[str]:
            commands.append(command)
            if command[3:6] == ["users", "drafts", "send"]:
                body = {"id": "message-2", "threadId": "thread-1"}
            else:
                body = {
                    "id": "message-2",
                    "threadId": "thread-1",
                    "labelIds": ["SENT", "INBOX"],
                }
            return subprocess.CompletedProcess(command, 0, stdout=json.dumps(body), stderr="")

        sent = GmailClient("chibuzor", runner=runner).send_and_verify_draft("draft-1")
        self.assertEqual(sent.message_id, "message-2")
        self.assertEqual(sent.thread_id, "thread-1")
        self.assertEqual(commands[0][3:6], ["users", "drafts", "send"])
        self.assertEqual(commands[1][3:6], ["users", "messages", "get"])

    def test_send_fails_without_sent_label(self) -> None:
        """The bridge rejects an unverified send result."""

        def runner(
            command: list[str],
            **_kwargs: object,
        ) -> subprocess.CompletedProcess[str]:
            if command[3:6] == ["users", "drafts", "send"]:
                body = {"id": "message-2", "threadId": "thread-1"}
            else:
                body = {"id": "message-2", "threadId": "thread-1", "labelIds": []}
            return subprocess.CompletedProcess(command, 0, stdout=json.dumps(body), stderr="")

        with self.assertRaisesRegex(GmailBridgeError, "SENT label"):
            GmailClient("chibuzor", runner=runner).send_and_verify_draft("draft-1")

    def test_send_timeout_is_uncertain(self) -> None:
        """A timed-out drafts.send is ambiguous and cannot be treated as safely failed."""

        def runner(command: list[str], **_kwargs: object) -> subprocess.CompletedProcess[str]:
            raise subprocess.TimeoutExpired(command, 90.0)

        with self.assertRaisesRegex(GmailSendUncertainError, "could not be verified"):
            GmailClient("chibuzor", runner=runner).send_and_verify_draft("draft-1")

    def test_invalid_base64_is_rejected_before_gws(self) -> None:
        """Malformed hosted MIME never reaches the Gmail subprocess."""
        with self.assertRaisesRegex(GmailBridgeError, "invalid base64url"):
            decode_raw_mime("not valid + base64")


if __name__ == "__main__":
    unittest.main()
