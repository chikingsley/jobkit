"""Stage an outreach email as a Gmail DRAFT — the only mailbox write this package performs.

`create_draft` builds an RFC822 message with `email.message.EmailMessage`, base64url-encodes it,
and calls the authed Google Workspace CLI:

    gws-profile chibuzor gmail users drafts create --json '{"message":{"raw":"<base64url>"}}'

DRAFT-ONLY BY CONSTRUCTION. The single Gmail mutation invoked here is `users.drafts.create` — used
for both new outreach (`create_draft`) and in-thread follow-up replies (`create_reply_draft`, which
adds `threadId` + `In-Reply-To`/`References`). There is deliberately no function in this package
that calls `users.messages.send` or `users.drafts.send`, so nothing can send mail: a human opens
Gmail and reviews/sends each staged draft. Do not add a send path here — it would defeat the design.
"""

from __future__ import annotations

import base64
import json
import subprocess
from email.message import EmailMessage

from jobkit.outreach.templates import SENDER_EMAIL

# The authed CLI and the fixed, draft-only verb. `create` is the ONLY Gmail write used anywhere in
# this package; there is intentionally no `send`/`drafts.send` constant or code path.
_GWS = ("gws-profile", "chibuzor", "gmail")
_CREATE_VERB = ("users", "drafts", "create")
_DELETE_VERB = ("users", "drafts", "delete")


def build_raw_message(  # noqa: PLR0913 - all keyword-only RFC822 fields; a thin message builder.
    *,
    to: str,
    subject: str,
    body: str,
    sender: str = SENDER_EMAIL,
    in_reply_to: str = "",
    references: str = "",
) -> str:
    """Build an RFC822 message and return its base64url-encoded (Gmail `raw`) form.

    When `in_reply_to`/`references` (the prior message's `Message-ID`) are supplied, the standard
    threading headers are set so Gmail and the recipient's client thread the reply correctly.
    """
    message = EmailMessage()
    message["From"] = sender
    message["To"] = to
    message["Subject"] = subject
    if in_reply_to:
        message["In-Reply-To"] = in_reply_to
        message["References"] = references or in_reply_to
    message.set_content(body)
    return base64.urlsafe_b64encode(bytes(message)).decode("ascii")


def create_draft(to: str, subject: str, body: str, *, sender: str = SENDER_EMAIL) -> str:
    """Stage a Gmail draft and return its draft id. Draft-only; never sends.

    Builds the RFC822 message, base64url-encodes it, and shells out to
    `gws-profile chibuzor gmail users drafts create`. Raises `RuntimeError` if the CLI fails or
    returns no draft id.
    """
    raw = build_raw_message(to=to, subject=subject, body=body, sender=sender)
    payload = json.dumps({"message": {"raw": raw}})
    params = json.dumps({"userId": "me"})
    result = subprocess.run(  # noqa: S603 - fixed argv (the draft-only create verb), JSON-quoted.
        [*_GWS, *_CREATE_VERB, "--params", params, "--json", payload],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        msg = f"gmail drafts create failed: {result.stderr.strip() or result.stdout.strip()}"
        raise RuntimeError(msg)
    return _draft_id_from_output(result.stdout)


def create_reply_draft(  # noqa: PLR0913 - keyword-only threading fields; mirrors build_raw_message.
    *,
    thread_id: str,
    to: str,
    subject: str,
    body: str,
    in_reply_to: str = "",
    references: str = "",
    sender: str = SENDER_EMAIL,
) -> str:
    """Stage an in-thread reply as a Gmail DRAFT and return its draft id. Draft-only; never sends.

    Sets `threadId` on the draft so Gmail attaches it to the existing thread, and sets the
    `In-Reply-To`/`References` headers from the thread's latest `Message-ID` for correct threading.
    Uses the same `users.drafts.create` verb as `create_draft` — there is no send path.
    """
    raw = build_raw_message(
        to=to,
        subject=subject,
        body=body,
        sender=sender,
        in_reply_to=in_reply_to,
        references=references,
    )
    payload = json.dumps({"message": {"raw": raw, "threadId": thread_id}})
    params = json.dumps({"userId": "me"})
    result = subprocess.run(  # noqa: S603 - fixed argv (the draft-only create verb), JSON-quoted.
        [*_GWS, *_CREATE_VERB, "--params", params, "--json", payload],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip()
        msg = f"gmail drafts create (reply) failed: {detail}"
        raise RuntimeError(msg)
    return _draft_id_from_output(result.stdout)


def delete_draft(draft_id: str) -> None:
    """Delete a staged draft by id (used to clean up test drafts). Not part of the send path."""
    result = subprocess.run(  # noqa: S603 - fixed argv (drafts delete), id passed as a param.
        [*_GWS, *_DELETE_VERB, "--params", json.dumps({"userId": "me", "id": draft_id})],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        msg = f"gmail drafts delete failed: {result.stderr.strip() or result.stdout.strip()}"
        raise RuntimeError(msg)


def _draft_id_from_output(stdout: str) -> str:
    """Pull the draft id out of the CLI's JSON response."""
    try:
        parsed = json.loads(stdout)
    except json.JSONDecodeError as exc:
        msg = f"could not parse gmail drafts create response: {stdout.strip()}"
        raise RuntimeError(msg) from exc
    draft_id = parsed.get("id") if isinstance(parsed, dict) else None
    if not isinstance(draft_id, str) or not draft_id:
        msg = f"gmail drafts create returned no draft id: {stdout.strip()}"
        raise RuntimeError(msg)
    return draft_id
