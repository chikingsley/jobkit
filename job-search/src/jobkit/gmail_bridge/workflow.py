"""Fail-closed workflows joining hosted attempts to explicit Gmail operations."""

from __future__ import annotations

from dataclasses import asdict
from typing import TYPE_CHECKING

from jobkit.gmail_bridge.api import JobKitClient, required_string
from jobkit.gmail_bridge.gmail import GmailSendUncertainError

if TYPE_CHECKING:
    from jobkit.gmail_bridge.gmail import GmailClient

type JsonObject = dict[str, object]


class GmailWorkflowError(RuntimeError):
    """An email-attempt transition failed and was reported when possible."""


def stage_approved_attempt(
    api: JobKitClient,
    gmail: GmailClient,
    attempt_id: str,
) -> JsonObject:
    """Claim one approved attempt, create a Gmail draft, and record both Gmail IDs."""
    try:
        claim = api.claim_email_attempt(attempt_id)
        gmail_draft = gmail.create_draft_from_raw(required_string(claim, "raw"))
        api.record_drafted(
            attempt_id,
            gmail_draft_id=gmail_draft.draft_id,
            gmail_message_id=gmail_draft.message_id,
        )
    except (OSError, RuntimeError, ValueError) as exc:
        _record_failure(api, attempt_id, stage="draft", error=exc)
        msg = f"Could not stage email attempt {attempt_id}: {exc}"
        raise GmailWorkflowError(msg) from exc
    return {"attemptId": attempt_id, **asdict(gmail_draft), "status": "drafted"}


def send_drafted_attempt(
    api: JobKitClient,
    gmail: GmailClient,
    attempt_id: str,
) -> JsonObject:
    """Send one API-recorded Gmail draft, verify SENT, and record message/thread IDs."""
    attempt = _find_drafted_attempt(api, attempt_id)
    gmail_draft_id = required_string(attempt, "gmailDraftId")
    try:
        api.record_sending(attempt_id, gmail_draft_id=gmail_draft_id)
    except (OSError, RuntimeError, ValueError) as exc:
        msg = f"Could not reserve email attempt {attempt_id} for sending: {exc}"
        raise GmailWorkflowError(msg) from exc

    try:
        sent = gmail.send_and_verify_draft(gmail_draft_id)
    except GmailSendUncertainError as exc:
        _record_uncertain(
            api,
            attempt_id,
            stage="gmail_send_or_verify",
            error=exc,
            gmail_ids=(exc.gmail_message_id, exc.gmail_thread_id),
        )
        msg = (
            f"Send state is uncertain for email attempt {attempt_id}: {exc}. "
            "Do not retry until Gmail and JobKit have been reconciled."
        )
        raise GmailWorkflowError(msg) from exc
    except (OSError, RuntimeError, ValueError) as exc:
        _record_uncertain(api, attempt_id, stage="gmail_send_or_verify", error=exc)
        msg = (
            f"Send state is uncertain for email attempt {attempt_id}: {exc}. "
            "Do not retry until Gmail and JobKit have been reconciled."
        )
        raise GmailWorkflowError(msg) from exc

    try:
        api.record_sent(
            attempt_id,
            gmail_draft_id=gmail_draft_id,
            gmail_message_id=sent.message_id,
            gmail_thread_id=sent.thread_id,
        )
    except (OSError, RuntimeError, ValueError) as exc:
        _record_uncertain(
            api,
            attempt_id,
            stage="record_sent",
            error=exc,
            gmail_ids=(sent.message_id, sent.thread_id),
        )
        msg = (
            f"Gmail sent email attempt {attempt_id}, but JobKit could not record it: {exc}. "
            "Do not retry until Gmail and JobKit have been reconciled."
        )
        raise GmailWorkflowError(msg) from exc
    return {
        "attemptId": attempt_id,
        "gmailDraftId": gmail_draft_id,
        "gmailMessageId": sent.message_id,
        "gmailThreadId": sent.thread_id,
        "status": "sent",
    }


def _find_drafted_attempt(api: JobKitClient, attempt_id: str) -> JsonObject:
    for attempt in api.list_email_attempts("drafted"):
        candidate_id = attempt.get("attemptId", attempt.get("id"))
        if candidate_id == attempt_id:
            return attempt
    msg = f"Email attempt {attempt_id} is not in drafted state"
    raise GmailWorkflowError(msg)


def _record_failure(
    api: JobKitClient,
    attempt_id: str,
    *,
    stage: str,
    error: Exception,
) -> None:
    """Best-effort failure reporting that never masks the primary error."""
    try:
        api.record_failed(attempt_id, stage=stage, error=str(error))
    except (OSError, RuntimeError, ValueError):
        return


def _record_uncertain(
    api: JobKitClient,
    attempt_id: str,
    *,
    stage: str,
    error: Exception,
    gmail_ids: tuple[str | None, str | None] = (None, None),
) -> None:
    """Best-effort non-retryable send-state reporting that preserves the primary error."""
    gmail_message_id, gmail_thread_id = gmail_ids
    try:
        api.record_uncertain(
            attempt_id,
            stage=stage,
            error=str(error),
            gmail_message_id=gmail_message_id,
            gmail_thread_id=gmail_thread_id,
        )
    except (OSError, RuntimeError, ValueError):
        return
