"""HTTP contract tests for the hosted JobKit client."""

from __future__ import annotations

import json
import unittest

import httpx

from jobkit.gmail_bridge.api import JobKitApiError, JobKitClient


class JobKitClientTests(unittest.TestCase):
    """Exercise auth cookies, endpoint shapes, and invalid-response failures."""

    def test_auth_and_email_attempt_contract(self) -> None:
        """The client preserves Better Auth cookies and sends exact transition bodies."""
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.url.path == "/api/auth/sign-in/email":
                return httpx.Response(
                    200,
                    headers={
                        "set-cookie": (
                            "better-auth.session_token=secret; Path=/; HttpOnly; Secure"
                        ),
                    },
                    json={"user": {"id": "user-1"}},
                )
            self.assertIn("better-auth.session_token=secret", request.headers.get("cookie", ""))
            if request.url.path == "/api/email-attempts" and request.method == "GET":
                return httpx.Response(200, json={"attempts": [{"attemptId": "attempt-1"}]})
            if request.url.path.endswith("/claim"):
                return httpx.Response(
                    200,
                    json={"attemptId": "attempt-1", "raw": "cmF3", "recipient": "a@b.test"},
                )
            return httpx.Response(200, json={"ok": True})

        transport = httpx.MockTransport(handler)
        with JobKitClient("https://outreach.test", transport=transport) as client:
            client.sign_in("person@example.com", "not-logged")
            self.assertEqual(client.list_email_attempts("approved")[0]["attemptId"], "attempt-1")
            self.assertEqual(client.list_email_attempts("sending")[0]["attemptId"], "attempt-1")
            self.assertEqual(client.list_email_attempts("uncertain")[0]["attemptId"], "attempt-1")
            self.assertEqual(client.claim_email_attempt("attempt-1")["raw"], "cmF3")
            client.record_drafted(
                "attempt-1",
                gmail_draft_id="draft-gmail-1",
                gmail_message_id="message-gmail-1",
            )
            client.record_sending("attempt-1", gmail_draft_id="draft-gmail-1")
            client.record_sent(
                "attempt-1",
                gmail_draft_id="draft-gmail-1",
                gmail_message_id="message-gmail-2",
                gmail_thread_id="thread-gmail-1",
            )
            client.record_uncertain(
                "attempt-1",
                stage="gmail_send_or_verify",
                error="verify failed",
                gmail_message_id="message-gmail-2",
                gmail_thread_id="thread-gmail-1",
            )
            client.record_failed("attempt-1", stage="draft", error="bounded")

        bodies = [json.loads(request.content) for request in requests if request.content]
        self.assertIn(
            {"gmailDraftId": "draft-gmail-1", "gmailMessageId": "message-gmail-1"},
            bodies,
        )
        self.assertIn({"gmailDraftId": "draft-gmail-1"}, bodies)
        self.assertIn(
            {
                "stage": "gmail_send_or_verify",
                "error": "verify failed",
                "gmailMessageId": "message-gmail-2",
                "gmailThreadId": "thread-gmail-1",
            },
            bodies,
        )
        self.assertIn(
            {
                "gmailDraftId": "draft-gmail-1",
                "gmailMessageId": "message-gmail-2",
                "gmailThreadId": "thread-gmail-1",
            },
            bodies,
        )
        self.assertIn({"stage": "draft", "error": "bounded"}, bodies)

    def test_sign_in_requires_session_cookie(self) -> None:
        """A plausible JSON body without a Better Auth session cookie is rejected."""
        transport = httpx.MockTransport(
            lambda _request: httpx.Response(200, json={"user": {"id": "user-1"}}),
        )
        with (
            JobKitClient("https://outreach.test", transport=transport) as client,
            self.assertRaisesRegex(JobKitApiError, "session cookie"),
        ):
            client.sign_in("person@example.com", "not-logged")

    def test_non_json_success_is_rejected(self) -> None:
        """A successful status with a non-JSON body fails closed."""

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("sign-in/email"):
                return httpx.Response(
                    200,
                    headers={"set-cookie": "better-auth.session_token=secret"},
                    json={"user": {"id": "user-1"}},
                )
            return httpx.Response(200, text="not json")

        with JobKitClient(
            "https://outreach.test",
            transport=httpx.MockTransport(handler),
        ) as client:
            client.sign_in("person@example.com", "not-logged")
            with self.assertRaisesRegex(JobKitApiError, "invalid JSON"):
                client.list_email_attempts("approved")


if __name__ == "__main__":
    unittest.main()
