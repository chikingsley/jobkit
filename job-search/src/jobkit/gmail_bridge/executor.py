"""Polling executor for explicit send requests created in the JobKit UI."""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

from jobkit.gmail_bridge.api import required_string
from jobkit.gmail_bridge.workflow import (
    GmailWorkflowError,
    send_drafted_attempt,
    stage_approved_attempt,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    from jobkit.gmail_bridge.api import JobKitClient, JsonObject
    from jobkit.gmail_bridge.gmail import GmailClient


def process_requested_sends(
    api: JobKitClient,
    gmail: GmailClient,
) -> list[JsonObject]:
    """Process each explicitly requested attempt once, preserving fail-closed states."""
    results: list[JsonObject] = []
    attempts = api.list_email_attempts("attention", send_requested=True)
    for attempt in attempts:
        attempt_id = required_string(attempt, "attemptId")
        status = required_string(attempt, "status")
        try:
            if status == "approved":
                stage_approved_attempt(api, gmail, attempt_id)
                status = "drafted"
            if status == "drafted":
                results.append(send_drafted_attempt(api, gmail, attempt_id))
        except GmailWorkflowError as error:
            results.append(
                {
                    "attemptId": attempt_id,
                    "error": str(error),
                    "status": "execution_error",
                }
            )
    return results


def watch_requested_sends(
    api: JobKitClient,
    gmail: GmailClient,
    *,
    poll_seconds: float,
    on_result: Callable[[JsonObject], None],
) -> None:
    """Continuously execute only user-requested sends for one authenticated session."""
    if poll_seconds <= 0:
        msg = "poll interval must be positive"
        raise ValueError(msg)
    while True:
        for result in process_requested_sends(api, gmail):
            on_result(result)
        time.sleep(poll_seconds)
