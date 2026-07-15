"""Tests for UI-requested Gmail execution."""

from __future__ import annotations

import unittest
from typing import TYPE_CHECKING, cast

from jobkit.gmail_bridge.executor import process_requested_sends
from jobkit.gmail_bridge.gmail import GmailDraft, SentGmailMessage

if TYPE_CHECKING:
    from jobkit.gmail_bridge.api import JobKitClient
    from jobkit.gmail_bridge.gmail import GmailClient


class RequestedSendApi:
    """Minimal stateful API fake for one explicitly requested attempt."""

    def __init__(self) -> None:
        """Start with one approved send request."""
        self.status = "approved"
        self.transitions: list[str] = []

    def list_email_attempts(
        self,
        status: str,
        *,
        send_requested: bool = False,
    ) -> list[dict[str, object]]:
        """Return the attempt only when it belongs to the requested state view."""
        if status == "attention" and send_requested and self.status != "sent":
            return [{"attemptId": "attempt-1", "status": self.status}]
        if status == "drafted" and self.status == "drafted":
            return [
                {
                    "attemptId": "attempt-1",
                    "gmailDraftId": "gmail-draft-1",
                    "status": self.status,
                }
            ]
        return []

    def claim_email_attempt(self, attempt_id: str) -> dict[str, object]:
        """Claim the approved attempt."""
        self.assert_attempt(attempt_id)
        self.status = "claimed"
        self.transitions.append("claimed")
        return {"attemptId": attempt_id, "raw": "cmF3LW1pbWU="}

    def record_drafted(self, attempt_id: str, **_ids: str) -> dict[str, object]:
        """Record Gmail draft creation."""
        self.assert_attempt(attempt_id)
        self.status = "drafted"
        self.transitions.append("drafted")
        return {"ok": True}

    def record_sending(self, attempt_id: str, **_ids: str) -> dict[str, object]:
        """Reserve the attempt for sending."""
        self.assert_attempt(attempt_id)
        self.status = "sending"
        self.transitions.append("sending")
        return {"ok": True}

    def record_sent(self, attempt_id: str, **_ids: str) -> dict[str, object]:
        """Record verified Gmail delivery."""
        self.assert_attempt(attempt_id)
        self.status = "sent"
        self.transitions.append("sent")
        return {"ok": True}

    def record_failed(self, attempt_id: str, **_details: str) -> dict[str, object]:
        """Record a pre-send failure."""
        self.assert_attempt(attempt_id)
        self.status = "failed"
        self.transitions.append("failed")
        return {"ok": True}

    def record_uncertain(self, attempt_id: str, **_details: object) -> dict[str, object]:
        """Record an ambiguous post-send state."""
        self.assert_attempt(attempt_id)
        self.status = "uncertain"
        self.transitions.append("uncertain")
        return {"ok": True}

    @staticmethod
    def assert_attempt(attempt_id: str) -> None:
        """Reject an unexpected fixture identifier."""
        if attempt_id != "attempt-1":
            msg = f"unexpected attempt: {attempt_id}"
            raise AssertionError(msg)


class RequestedSendGmail:
    """Return fixed Gmail identifiers without external calls."""

    def create_draft_from_raw(self, raw: str) -> GmailDraft:
        """Create the expected fixture draft."""
        if raw != "cmF3LW1pbWU=":
            msg = "unexpected raw MIME"
            raise AssertionError(msg)
        return GmailDraft(draft_id="gmail-draft-1", message_id="draft-message-1")

    def send_and_verify_draft(self, draft_id: str) -> SentGmailMessage:
        """Return a verified sent message for the fixture draft."""
        if draft_id != "gmail-draft-1":
            msg = f"unexpected Gmail draft: {draft_id}"
            raise AssertionError(msg)
        return SentGmailMessage(message_id="sent-message-1", thread_id="thread-1")


class RequestedSendExecutorTests(unittest.TestCase):
    """Ensure one UI request becomes one verified send."""

    def test_processes_requested_attempt_once(self) -> None:
        """Approved requests are drafted, sent, and absent from the next poll."""
        api = RequestedSendApi()
        gmail = RequestedSendGmail()

        first = process_requested_sends(
            cast("JobKitClient", api),
            cast("GmailClient", gmail),
        )
        second = process_requested_sends(
            cast("JobKitClient", api),
            cast("GmailClient", gmail),
        )

        self.assertEqual(first[0]["status"], "sent")
        self.assertEqual(second, [])
        self.assertEqual(
            api.transitions,
            ["claimed", "drafted", "sending", "sent"],
        )

    def test_records_one_workflow_error_without_crashing_the_poll(self) -> None:
        """A Gmail failure is returned after its durable failed transition."""

        class BrokenGmail(RequestedSendGmail):
            def create_draft_from_raw(self, raw: str) -> GmailDraft:
                _ = raw
                msg = "Gmail unavailable"
                raise RuntimeError(msg)

        api = RequestedSendApi()
        results = process_requested_sends(
            cast("JobKitClient", api),
            cast("GmailClient", BrokenGmail()),
        )

        self.assertEqual(results[0]["status"], "execution_error")
        self.assertEqual(api.status, "failed")
        self.assertIn("Gmail unavailable", str(results[0]["error"]))


if __name__ == "__main__":
    unittest.main()
