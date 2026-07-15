"""Integration-style workflow tests with in-memory API and Gmail fakes."""

from __future__ import annotations

import unittest
from typing import TYPE_CHECKING, cast

from jobkit.gmail_bridge.gmail import GmailDraft, SentGmailMessage
from jobkit.gmail_bridge.workflow import (
    GmailWorkflowError,
    send_drafted_attempt,
    stage_approved_attempt,
)

if TYPE_CHECKING:
    from jobkit.gmail_bridge.api import JobKitClient
    from jobkit.gmail_bridge.gmail import GmailClient


class FakeApi:
    """Record the API-side transitions made by one workflow."""

    def __init__(self) -> None:
        """Start with one drafted attempt and no transitions."""
        self.drafted: list[dict[str, object]] = [
            {"attemptId": "attempt-1", "gmailDraftId": "gmail-draft-1"},
        ]
        self.transitions: list[tuple[str, dict[str, object]]] = []

    def claim_email_attempt(self, attempt_id: str) -> dict[str, object]:
        """Return an exact raw payload for the requested attempt."""
        return {"attemptId": attempt_id, "raw": "cmF3LW1pbWU="}

    def list_email_attempts(self, status: str) -> list[dict[str, object]]:
        """Return the one drafted fixture."""
        return self.drafted if status == "drafted" else []

    def record_drafted(self, attempt_id: str, **ids: str) -> dict[str, object]:
        """Record the drafted transition."""
        self.transitions.append(("drafted", {"attemptId": attempt_id, **ids}))
        return {"ok": True}

    def record_sent(self, attempt_id: str, **ids: str) -> dict[str, object]:
        """Record the sent transition."""
        self.transitions.append(("sent", {"attemptId": attempt_id, **ids}))
        return {"ok": True}

    def record_sending(self, attempt_id: str, **ids: str) -> dict[str, object]:
        """Record the atomic sending reservation."""
        self.transitions.append(("sending", {"attemptId": attempt_id, **ids}))
        return {"ok": True}

    def record_uncertain(self, attempt_id: str, **details: object) -> dict[str, object]:
        """Record the non-retryable uncertain transition."""
        self.transitions.append(("uncertain", {"attemptId": attempt_id, **details}))
        return {"ok": True}

    def record_failed(self, attempt_id: str, **details: str) -> dict[str, object]:
        """Record the failed transition."""
        self.transitions.append(("failed", {"attemptId": attempt_id, **details}))
        return {"ok": True}


class FakeGmail:
    """Return fixed Gmail identifiers without invoking a subprocess."""

    def create_draft_from_raw(self, raw: str) -> GmailDraft:
        """Create a fixed draft for the fixture raw value."""
        if raw != "cmF3LW1pbWU=":
            msg = "unexpected raw fixture"
            raise AssertionError(msg)
        return GmailDraft(draft_id="gmail-draft-1", message_id="gmail-message-1")

    def send_and_verify_draft(self, draft_id: str) -> SentGmailMessage:
        """Return a fixed verified send for the fixture draft."""
        if draft_id != "gmail-draft-1":
            msg = "unexpected draft fixture"
            raise AssertionError(msg)
        return SentGmailMessage(message_id="gmail-message-2", thread_id="gmail-thread-1")


class GmailWorkflowTests(unittest.TestCase):
    """Verify state transitions across the hosted API and Gmail boundary."""

    def test_stage_and_send_are_separate_explicit_workflows(self) -> None:
        """Drafting records a draft only; sending records verified sent IDs separately."""
        api = FakeApi()
        gmail = FakeGmail()
        staged = stage_approved_attempt(
            cast("JobKitClient", api),
            cast("GmailClient", gmail),
            "attempt-1",
        )
        self.assertEqual(staged["status"], "drafted")
        self.assertEqual([transition[0] for transition in api.transitions], ["drafted"])

        sent = send_drafted_attempt(
            cast("JobKitClient", api),
            cast("GmailClient", gmail),
            "attempt-1",
        )
        self.assertEqual(sent["status"], "sent")
        self.assertEqual(
            [transition[0] for transition in api.transitions],
            ["drafted", "sending", "sent"],
        )

    def test_draft_failure_is_recorded_and_raised(self) -> None:
        """A Gmail failure records failed and does not record drafted."""

        class BrokenGmail(FakeGmail):
            def create_draft_from_raw(self, raw: str) -> GmailDraft:
                _ = raw
                msg = "gmail unavailable"
                raise RuntimeError(msg)

        api = FakeApi()
        with self.assertRaisesRegex(GmailWorkflowError, "gmail unavailable"):
            stage_approved_attempt(
                cast("JobKitClient", api),
                cast("GmailClient", BrokenGmail()),
                "attempt-1",
            )
        self.assertEqual([transition[0] for transition in api.transitions], ["failed"])

    def test_send_failure_after_reservation_is_uncertain_not_failed(self) -> None:
        """Any exception after the sending transition is non-retryable uncertainty."""

        class BrokenSendGmail(FakeGmail):
            def send_and_verify_draft(self, draft_id: str) -> SentGmailMessage:
                if draft_id != "gmail-draft-1":
                    msg = "unexpected draft fixture"
                    raise AssertionError(msg)
                msg = "send response lost"
                raise RuntimeError(msg)

        api = FakeApi()
        with self.assertRaisesRegex(GmailWorkflowError, "uncertain"):
            send_drafted_attempt(
                cast("JobKitClient", api),
                cast("GmailClient", BrokenSendGmail()),
                "attempt-1",
            )
        self.assertEqual(
            [transition[0] for transition in api.transitions],
            ["sending", "uncertain"],
        )

    def test_failed_sending_reservation_never_invokes_gmail(self) -> None:
        """If drafted-to-sending fails, Gmail is not invoked."""

        class ReservationFailsApi(FakeApi):
            def record_sending(self, attempt_id: str, **ids: str) -> dict[str, object]:
                _ = (attempt_id, ids)
                msg = "concurrent sender already reserved this attempt"
                raise RuntimeError(msg)

        class MustNotRunGmail(FakeGmail):
            def send_and_verify_draft(self, draft_id: str) -> SentGmailMessage:
                msg = f"Gmail unexpectedly invoked for {draft_id}"
                raise AssertionError(msg)

        api = ReservationFailsApi()
        with self.assertRaisesRegex(GmailWorkflowError, "reserve"):
            send_drafted_attempt(
                cast("JobKitClient", api),
                cast("GmailClient", MustNotRunGmail()),
                "attempt-1",
            )
        self.assertEqual(api.transitions, [])


if __name__ == "__main__":
    unittest.main()
