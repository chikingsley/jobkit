"""`jobkit-gmail` CLI for hosted attempts and a personal authenticated Gmail account."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

from jobkit.gmail_bridge.api import EMAIL_ATTEMPT_STATUSES, JobKitClient
from jobkit.gmail_bridge.gmail import GmailClient
from jobkit.gmail_bridge.workflow import send_drafted_attempt, stage_approved_attempt

if TYPE_CHECKING:
    from collections.abc import Sequence

DEFAULT_JOBKIT_URL = "https://outreach-product.peacockery.studio"
DEFAULT_GWS_PROFILE = "chibuzor"


def main() -> None:
    """Run the command-line entry point."""
    raise SystemExit(run())


def run(argv: Sequence[str] | None = None) -> int:
    """Parse one explicit bridge operation and return a process exit code."""
    parser = _parser()
    args = parser.parse_args(argv)
    try:
        _validate_url(args.url)
        email = args.email or os.environ.get("JOBKIT_EMAIL") or input("JobKit email: ").strip()
        if not email:
            parser.error("JobKit email is required (--email or JOBKIT_EMAIL)")
        password = os.environ.get("JOBKIT_PASSWORD") or getpass.getpass("JobKit password: ")
        if not password:
            parser.error("JobKit password is required (JOBKIT_PASSWORD or secure prompt)")

        with JobKitClient(args.url) as api:
            api.sign_in(email, password)
            result = _dispatch(args, api)
        print(json.dumps(result, indent=2, sort_keys=True))
    except (RuntimeError, ValueError, OSError) as exc:
        print(f"jobkit-gmail: {exc}", file=sys.stderr)
        return 1
    return 0


def _dispatch(args: argparse.Namespace, api: JobKitClient) -> object:
    if args.command == "queue":
        return api.create_email_attempt(args.job_id, args.draft_id, args.route_id)
    if args.command == "list":
        if args.status == "all":
            statuses = EMAIL_ATTEMPT_STATUSES
        elif args.status == "attention":
            statuses = ("approved", "claimed", "drafted", "sending", "uncertain", "failed")
        else:
            statuses = (args.status,)
        return {
            "attempts": [
                attempt for status in statuses for attempt in api.list_email_attempts(status)
            ],
        }
    gmail = GmailClient(args.gws_profile)
    if args.command == "draft":
        return stage_approved_attempt(api, gmail, args.attempt_id)
    return send_drafted_attempt(api, gmail, args.attempt_id)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="jobkit-gmail",
        description=(
            "Stage exact hosted JobKit email attempts as Gmail drafts, or explicitly send one "
            "already-recorded draft. The draft command never sends mail."
        ),
    )
    parser.add_argument(
        "--url",
        default=os.environ.get("JOBKIT_URL", DEFAULT_JOBKIT_URL),
        help="hosted JobKit origin (default: production; JOBKIT_URL)",
    )
    parser.add_argument("--email", help="JobKit sign-in email (or JOBKIT_EMAIL)")
    parser.add_argument(
        "--gws-profile",
        default=os.environ.get("JOBKIT_GWS_PROFILE", DEFAULT_GWS_PROFILE),
        help="authenticated gws-profile name (default: chibuzor; JOBKIT_GWS_PROFILE)",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    queue = subparsers.add_parser("queue", help="create an approved hosted email attempt")
    queue.add_argument("job_id")
    queue.add_argument("--draft-id", required=True)
    queue.add_argument("--route-id", required=True)

    list_parser = subparsers.add_parser("list", help="list approved and/or drafted attempts")
    list_parser.add_argument(
        "--status",
        choices=(*EMAIL_ATTEMPT_STATUSES, "attention", "all"),
        default="attention",
        help="attempt states to show (default: attention excludes completed sent attempts)",
    )

    draft = subparsers.add_parser(
        "draft",
        help="claim one approved attempt and stage a Gmail draft; never sends",
    )
    draft.add_argument("attempt_id")

    send = subparsers.add_parser(
        "send",
        help="explicitly send one existing, API-recorded Gmail draft and verify SENT",
    )
    send.add_argument("attempt_id")
    return parser


def _validate_url(value: str) -> None:
    parsed = urlsplit(value)
    local_hosts = {"127.0.0.1", "::1", "localhost"}
    if parsed.scheme == "https" and parsed.netloc:
        return
    if parsed.scheme == "http" and parsed.hostname in local_hosts:
        return
    msg = "JobKit URL must use HTTPS (HTTP is allowed only for localhost)"
    raise ValueError(msg)
