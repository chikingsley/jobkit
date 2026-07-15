"""Authenticated client for JobKit's hosted email-attempt API."""

from __future__ import annotations

from contextlib import AbstractContextManager
from typing import TYPE_CHECKING, cast

import httpx

if TYPE_CHECKING:
    from collections.abc import Iterator, Sequence
    from types import TracebackType

type JsonObject = dict[str, object]
EMAIL_ATTEMPT_STATUSES = (
    "approved",
    "claimed",
    "drafted",
    "sending",
    "uncertain",
    "failed",
    "sent",
)


class JobKitApiError(RuntimeError):
    """A hosted JobKit request failed or returned an invalid response."""


class JobKitClient(AbstractContextManager["JobKitClient"]):
    """Small fail-closed client for authentication and email-attempt transitions."""

    def __init__(
        self,
        base_url: str,
        *,
        timeout_seconds: float = 30.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        """Create a client without performing a network request."""
        self._client = httpx.Client(
            base_url=base_url.rstrip("/"),
            follow_redirects=False,
            timeout=timeout_seconds,
            transport=transport,
        )

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        """Close the underlying HTTP connection pool."""
        self.close()

    def close(self) -> None:
        """Close the underlying HTTP connection pool."""
        self._client.close()

    def sign_in(self, email: str, password: str) -> None:
        """Create a Better Auth session, requiring both a user and session cookie."""
        payload = self._request_json(
            "POST",
            "/api/auth/sign-in/email",
            json={"email": email, "password": password},
        )
        user = payload.get("user")
        issued_session = any("session_token" in cookie.name for cookie in self._client.cookies.jar)
        if not isinstance(user, dict) or not issued_session:
            msg = "JobKit sign-in response did not include a user and session cookie"
            raise JobKitApiError(msg)

    def create_email_attempt(self, job_id: str, draft_id: str, route_id: str) -> JsonObject:
        """Create an approved email attempt from one job, draft, and route."""
        return self._request_json(
            "POST",
            f"/api/jobs/{job_id}/email-attempts",
            json={"draftId": draft_id, "routeId": route_id},
        )

    def list_email_attempts(self, status: str) -> list[JsonObject]:
        """List email attempts in one supported state."""
        if status not in EMAIL_ATTEMPT_STATUSES:
            msg = f"unsupported email-attempt status: {status}"
            raise ValueError(msg)
        payload = self._request_json("GET", "/api/email-attempts", params={"status": status})
        attempts = payload.get("attempts")
        if not isinstance(attempts, list):
            msg = "JobKit email-attempt list response did not contain an attempts array"
            raise JobKitApiError(msg)
        return list(_objects(attempts))

    def claim_email_attempt(self, attempt_id: str) -> JsonObject:
        """Claim one approved attempt and return its exact base64url MIME payload."""
        payload = self._request_json("POST", f"/api/email-attempts/{attempt_id}/claim")
        response_attempt_id = _required_string(payload, "attemptId")
        if response_attempt_id != attempt_id:
            msg = "JobKit claim response attemptId did not match the requested attempt"
            raise JobKitApiError(msg)
        _required_string(payload, "raw")
        return payload

    def record_drafted(
        self,
        attempt_id: str,
        *,
        gmail_draft_id: str,
        gmail_message_id: str,
    ) -> JsonObject:
        """Record the Gmail IDs after a draft has been created."""
        return self._request_json(
            "POST",
            f"/api/email-attempts/{attempt_id}/drafted",
            json={
                "gmailDraftId": gmail_draft_id,
                "gmailMessageId": gmail_message_id,
            },
        )

    def record_sent(
        self,
        attempt_id: str,
        *,
        gmail_draft_id: str,
        gmail_message_id: str,
        gmail_thread_id: str,
    ) -> JsonObject:
        """Record the verified sent message and thread IDs."""
        return self._request_json(
            "POST",
            f"/api/email-attempts/{attempt_id}/sent",
            json={
                "gmailDraftId": gmail_draft_id,
                "gmailMessageId": gmail_message_id,
                "gmailThreadId": gmail_thread_id,
            },
        )

    def record_sending(self, attempt_id: str, *, gmail_draft_id: str) -> JsonObject:
        """Atomically reserve a drafted attempt before Gmail send is invoked."""
        return self._request_json(
            "POST",
            f"/api/email-attempts/{attempt_id}/sending",
            json={"gmailDraftId": gmail_draft_id},
        )

    def record_uncertain(
        self,
        attempt_id: str,
        *,
        stage: str,
        error: str,
        gmail_message_id: str | None = None,
        gmail_thread_id: str | None = None,
    ) -> JsonObject:
        """Record a non-retryable send whose final Gmail state needs reconciliation."""
        payload: JsonObject = {"stage": stage, "error": error[:1000]}
        if gmail_message_id:
            payload["gmailMessageId"] = gmail_message_id
        if gmail_thread_id:
            payload["gmailThreadId"] = gmail_thread_id
        return self._request_json(
            "POST",
            f"/api/email-attempts/{attempt_id}/uncertain",
            json=payload,
        )

    def record_failed(self, attempt_id: str, *, stage: str, error: str) -> JsonObject:
        """Record a bounded failure without exposing credentials or MIME content."""
        return self._request_json(
            "POST",
            f"/api/email-attempts/{attempt_id}/failed",
            json={"stage": stage, "error": error[:1000]},
        )

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        json: JsonObject | None = None,
        params: dict[str, str] | None = None,
    ) -> JsonObject:
        """Perform one request, accepting only a successful JSON-object response."""
        try:
            response = self._client.request(method, path, json=json, params=params)
        except httpx.HTTPError as exc:
            msg = f"JobKit request failed: {method} {path}: {exc}"
            raise JobKitApiError(msg) from exc
        if response.is_redirect:
            msg = (
                f"JobKit request unexpectedly redirected: {method} {path} ({response.status_code})"
            )
            raise JobKitApiError(msg)
        if not response.is_success:
            detail = _error_detail(response)
            msg = f"JobKit request failed: {method} {path} ({response.status_code}): {detail}"
            raise JobKitApiError(msg)
        try:
            payload = response.json()
        except ValueError as exc:
            msg = f"JobKit returned invalid JSON: {method} {path}"
            raise JobKitApiError(msg) from exc
        if not isinstance(payload, dict):
            msg = f"JobKit returned a non-object JSON response: {method} {path}"
            raise JobKitApiError(msg)
        return cast("JsonObject", payload)


def required_string(payload: JsonObject, key: str) -> str:
    """Return a required non-empty string from an API object."""
    return _required_string(payload, key)


def _required_string(payload: JsonObject, key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        msg = f"JobKit response is missing required string field: {key}"
        raise JobKitApiError(msg)
    return value


def _objects(values: Sequence[object]) -> Iterator[JsonObject]:
    for value in values:
        if not isinstance(value, dict):
            msg = "JobKit attempts array contained a non-object entry"
            raise JobKitApiError(msg)
        yield cast("JsonObject", value)


def _error_detail(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return response.text.strip()[:300] or "no response body"
    if isinstance(payload, dict):
        for key in ("message", "error"):
            value = payload.get(key)
            if isinstance(value, str) and value:
                return value[:300]
    return "request rejected"
