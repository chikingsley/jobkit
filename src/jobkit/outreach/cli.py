"""`outreach` console script — draft-first cold outreach, follow-up tracking, and follow-up drafts.

Three modes (all draft-only; `--dry-run` is the default everywhere, nothing is ever sent):

    uv run outreach jobs.json                 # initial outreach: print composed emails (dry-run)
    uv run outreach jobs.csv --draft          # stage each composed email as a Gmail DRAFT
    uv run outreach jobs.json --no-llm        # offline template fill instead of Claude

    uv run outreach sync                      # reconcile the local tracking DB with SENT mail
    uv run outreach follow-ups                # print follow-ups due (dry-run)
    uv run outreach follow-ups --draft        # stage due follow-ups as in-thread Gmail DRAFTS

Initial outreach now validates every composed email (`jobkit.outreach.validate`) and REFUSES to
draft any with a hard problem (unfilled placeholder, mojibake, no open-ended question, …), warning
on soft ones. The subject follows the targeted `role — school — location` shape.

DRAFT-ONLY: `--draft` calls `users.drafts.create` (via `jobkit.outreach.draft`) and nothing else.
There is no send path anywhere in this package, so no command here can ever send mail.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from pathlib import Path
from typing import TYPE_CHECKING

from jobkit.outreach import compose, draft, gmail, track, validate

if TYPE_CHECKING:
    from jobkit.llm import SuperwhisperClient

_SUBCOMMANDS = {"sync", "follow-ups"}
_INDEX_CSV = Path.home() / "github" / "jobkit" / "job-data" / "outreach-sent" / "index.csv"


def _load_rows(path: Path) -> list[dict[str, str]]:
    """Load normalized job rows from a JSON or CSV file (by extension, JSON content otherwise)."""
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".csv":
        return _rows_from_csv(text)
    if path.suffix.lower() == ".json":
        return _rows_from_json(text)
    # Unknown extension: sniff — JSON starts with '[' or '{', else treat as CSV.
    stripped = text.lstrip()
    return _rows_from_json(text) if stripped[:1] in "[{" else _rows_from_csv(text)


def _rows_from_json(text: str) -> list[dict[str, str]]:
    """Parse JSON that is either a list of row objects or a {"jobs": [...]} wrapper."""
    data = json.loads(text)
    if isinstance(data, dict):
        for key in ("jobs", "postings", "rows", "data"):
            value = data.get(key)
            if isinstance(value, list):
                data = value
                break
    if not isinstance(data, list):
        msg = "expected a JSON array of job rows (or an object wrapping one)"
        raise TypeError(msg)
    return [{str(k): _as_str(v) for k, v in row.items()} for row in data if isinstance(row, dict)]


def _rows_from_csv(text: str) -> list[dict[str, str]]:
    """Parse normalized CSV (the `fetch-jobs --csv` header is the SCHEMA order)."""
    reader = csv.DictReader(io.StringIO(text))
    return [{str(k): _as_str(v) for k, v in row.items()} for row in reader]


def _as_str(value: object) -> str:
    """Coerce a loaded cell value to a stripped string ("" for null)."""
    if value is None:
        return ""
    return str(value).strip()


def _make_client(*, no_llm: bool) -> SuperwhisperClient | None:
    """Build a Superwhisper client for personalization, or None for the offline template path."""
    if no_llm:
        return None
    from jobkit.llm import SuperwhisperClient  # noqa: PLC0415 - keep auth/network off import path.

    try:
        return SuperwhisperClient()
    except Exception as exc:  # noqa: BLE001 - no auth/cache: fall back to the template fill.
        print(f"note: LLM unavailable ({exc}); using offline template fill", file=sys.stderr)
        return None


def _print_email(*, index: int, total: int, to: str, email: dict[str, str]) -> None:
    """Print one composed email block for dry-run / draft confirmation."""
    print(f"\n--- email {index}/{total} -> {to} ---")
    print(f"Subject: {email['subject']}")
    print()
    print(email["body"])


def main() -> None:
    """Run the outreach command-line interface."""
    argv = sys.argv[1:]
    if argv and argv[0] in _SUBCOMMANDS:
        _dispatch_subcommand(argv)
        return
    _run_initial_outreach(argv)


def _build_initial_parser() -> argparse.ArgumentParser:
    """Build the argument parser for the initial-outreach (default) mode."""
    parser = argparse.ArgumentParser(
        prog="outreach",
        description=(
            "Compose cold-outreach emails from normalized job rows and stage Gmail drafts. "
            "Subcommands: 'sync' (refresh follow-up tracking), 'follow-ups' (draft due nudges)."
        ),
    )
    parser.add_argument("input", help="JSON or CSV of normalized job rows (from fetch-jobs)")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="print composed emails and create NO drafts (default)",
    )
    mode.add_argument(
        "--draft",
        action="store_true",
        help="stage each composed email as a Gmail DRAFT (never sends)",
    )
    parser.add_argument(
        "--no-llm",
        action="store_true",
        help="use the offline template fill instead of Claude for personalization",
    )
    return parser


def _run_initial_outreach(argv: list[str]) -> None:
    """Parse args and run the initial cold-outreach compose/validate/draft flow."""
    parser = _build_initial_parser()
    args = parser.parse_args(argv)

    input_path = Path(args.input)
    if not input_path.exists():
        parser.error(f"input file not found: {input_path}")
    try:
        rows = _load_rows(input_path)
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        parser.error(f"could not read job rows from {input_path}: {exc}")

    client = _make_client(no_llm=args.no_llm)
    try:
        _run(rows, draft_mode=args.draft, client=client)
    finally:
        if client is not None:
            client.close()


def _run(
    rows: list[dict[str, str]],
    *,
    draft_mode: bool,
    client: SuperwhisperClient | None,
) -> None:
    """Compose+validate each row's email and either print it (dry-run) or stage a Gmail draft.

    De-dup, BEFORE any LLM tokens are spent: rows whose (recipient, subject) repeats within this
    run are skipped, and in draft mode rows whose exact (recipient, subject) already exists in
    Gmail as a draft or sent message are skipped — so re-running the same input never piles up
    duplicate drafts. The subject is deterministic (`compose.outreach_subject`), which is what
    makes this check exact.
    """
    skipped: list[str] = []
    seen: set[tuple[str, str]] = set()
    composed = 0
    drafted = 0
    rejected = 0
    duplicates = 0
    composable = [row for row in rows if row.get("apply_email", "").strip()]
    total = len(composable)

    for row in rows:
        to = row.get("apply_email", "").strip()
        if not to:
            label = row.get("title") or row.get("url") or row.get("job_id") or "(unknown)"
            skipped.append(f"{label} [{row.get('board', '?')}] - no apply_email")
            continue
        subject = compose.outreach_subject(row)
        key = (to.lower(), subject.strip().lower())
        if key in seen:
            duplicates += 1
            print(f"skipping duplicate row (same recipient + subject this run): {to}")
            continue
        seen.add(key)
        if draft_mode and _already_staged_or_sent(to, subject):
            duplicates += 1
            print(f"skipping {to}: an identical draft/sent message already exists in Gmail")
            continue
        composed += 1
        email = compose.compose_outreach(row, client=client)
        _print_email(index=composed, total=total, to=to, email=email)

        problems = validate.validate_email(to, email["subject"], email["body"])
        _print_problems(problems)
        if validate.has_hard_problems(problems):
            rejected += 1
            print("  REFUSING to draft: email failed hard validation", file=sys.stderr)
            continue

        if draft_mode:
            try:
                draft_id = draft.create_draft(to, email["subject"], email["body"])
            except RuntimeError as exc:
                print(f"  draft FAILED: {exc}", file=sys.stderr)
            else:
                drafted += 1
                print(f"  staged draft: {draft_id}")

    _print_summary(
        total_rows=len(rows),
        composed=composed,
        drafted=drafted,
        rejected=rejected,
        duplicates=duplicates,
        draft_mode=draft_mode,
        skipped=skipped,
    )


def _already_staged_or_sent(to: str, subject: str) -> bool:
    """Return True if a Gmail draft or sent message to `to` with this `subject` already exists.

    Gmail search treats the em dashes as word separators, so the deterministic subject is matched
    on its words. If the read fails we return False and draft anyway: a duplicate draft is caught
    by the human review pass, whereas silently dropping outreach is not.
    """
    words = " ".join(subject.replace("—", " ").split())
    query = f'(in:draft OR in:sent) to:{to} subject:"{words}"'
    try:
        return gmail.any_matching(query)
    except RuntimeError as exc:
        print(f"  note: de-dup check failed ({exc}); drafting anyway", file=sys.stderr)
        return False


def _print_problems(problems: list[str]) -> None:
    """Print validation problems under a composed email (hard vs soft)."""
    for problem in problems:
        marker = "REJECT" if validate.is_hard(problem) else "warn"
        print(f"  [{marker}] {problem}")


def _print_summary(  # noqa: PLR0913 - keyword-only counters for one summary line; trivial.
    *,
    total_rows: int,
    composed: int,
    drafted: int,
    rejected: int,
    duplicates: int,
    draft_mode: bool,
    skipped: list[str],
) -> None:
    """Print the run summary: composed, drafted (or dry-run), rejected, and skipped rows."""
    print(f"\n=== summary: {total_rows} row(s) ===")
    if draft_mode:
        print(f"composed {composed}, staged {drafted} Gmail draft(s) (no mail sent)")
    else:
        print(f"composed {composed} email(s) (dry-run: no drafts created)")
    if rejected:
        print(f"rejected {rejected} email(s) for hard validation problems (no draft)")
    if duplicates:
        print(f"skipped {duplicates} duplicate(s) (already composed this run or already in Gmail)")
    if skipped:
        print(f"skipped {len(skipped)} row(s) with no apply_email:")
        for item in skipped:
            print(f"  - {item}")


# --- follow-up tracking subcommands -------------------------------------------------------------


def _dispatch_subcommand(argv: list[str]) -> None:
    """Route the `sync` / `follow-ups` subcommands."""
    command = argv[0]
    rest = argv[1:]
    if command == "sync":
        _run_sync(rest)
    else:
        _run_followups(rest)


def _run_sync(argv: list[str]) -> None:
    """Run `outreach sync`: reconcile the tracking DB with the live SENT mailbox."""
    parser = argparse.ArgumentParser(
        prog="outreach sync",
        description="Reconcile the local follow-up tracking DB with the chibuzor SENT mailbox.",
    )
    parser.add_argument(
        "--since",
        default=None,
        help="Gmail date window (e.g. 'newer_than:60d' or 'after:2024/01/01'); default 120 days",
    )
    parser.add_argument(
        "--seed",
        action="store_true",
        help="seed initial rows from job-data/outreach-sent/index.csv before syncing",
    )
    args = parser.parse_args(argv)

    index_csv = _INDEX_CSV if args.seed else None
    result = track.sync(since=args.since, index_csv=index_csv)
    print("=== outreach sync ===")
    print(
        f"Gmail fetches: {result.thread_fetches} threads.get "
        f"(+ up to {result.list_fetches} messages.list pages)",
    )
    print(f"threads matched in window: {result.threads_seen}")
    print(f"threads tracked (total):   {result.threads_tracked}")
    print(f"  replied:                 {result.replied}")
    print(f"  awaiting reply:          {result.awaiting}")
    print(f"DB: {track.DB_PATH}")


def _run_followups(argv: list[str]) -> None:
    """Run `outreach follow-ups`: print or draft (in-thread) the follow-ups that are due."""
    parser = argparse.ArgumentParser(
        prog="outreach follow-ups",
        description="Compose polite in-thread follow-ups for due, unreplied threads (draft-only).",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="print the due follow-ups and create NO drafts (default)",
    )
    mode.add_argument(
        "--draft",
        action="store_true",
        help="stage each due follow-up as an in-thread Gmail DRAFT (never sends)",
    )
    parser.add_argument(
        "--now",
        default=None,
        help="ISO timestamp to evaluate cadence against (default: current time)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="only process the first N due threads (0 = all); useful for a controlled test draft",
    )
    args = parser.parse_args(argv)

    now_iso = args.now or track._now_iso()  # noqa: SLF001 - intentional shared clock helper.
    due = track.due_followups(now_iso)
    if args.limit > 0:
        due = due[: args.limit]

    print("=== outreach follow-ups ===")
    if not due:
        print("no follow-ups due.")
        return

    drafted = 0
    for item in due:
        drafted += _handle_followup(item, draft_mode=args.draft)
    print(f"\n=== {len(due)} due; {'drafted ' + str(drafted) if args.draft else 'dry-run'} ===")


def _handle_followup(item: track.DueFollowup, *, draft_mode: bool) -> int:
    """Print (and optionally draft as an in-thread reply) one due follow-up. Returns drafts made."""
    from jobkit.outreach import templates  # noqa: PLC0415 - keep import surface small.

    row = item.row
    subject = row.subject if row.subject.lower().startswith("re:") else f"Re: {row.subject}"
    body = templates.followup_body(item.followup_number, school=row.org, country=row.country)
    print(
        f"\n--- follow-up #{item.followup_number} -> {row.to_email} "
        f"({item.days_since_last}d since last; thread {row.thread_id}) ---",
    )
    print(f"Subject: {subject}")
    print()
    print(body)

    if not draft_mode:
        return 0

    in_reply_to, references = _threading_headers(row.thread_id)
    try:
        draft_id = draft.create_reply_draft(
            thread_id=row.thread_id,
            to=row.to_email,
            subject=subject,
            body=body,
            in_reply_to=in_reply_to,
            references=references,
        )
    except RuntimeError as exc:
        print(f"  draft FAILED: {exc}", file=sys.stderr)
        return 0
    conn = track.connect()
    try:
        track.increment_followup(conn, row.thread_id)
    finally:
        conn.close()
    print(f"  staged in-thread draft: {draft_id} (followups_drafted incremented)")
    return 1


def _threading_headers(thread_id: str) -> tuple[str, str]:
    """Return (In-Reply-To, References) from the thread's latest message's Message-ID."""
    info = gmail.get_thread(thread_id)
    message_ids = [m.message_id_header for m in info.messages if m.message_id_header]
    if not message_ids:
        return "", ""
    return message_ids[-1], " ".join(message_ids)


if __name__ == "__main__":
    main()
