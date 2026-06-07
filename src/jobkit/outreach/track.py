"""Follow-up tracking for ESL outreach — a hybrid Gmail + local-SQLite store.

WHY A HYBRID MODEL. Gmail is the source of truth for what was sent and what came back (we never
duplicate message bodies), but it is slow to scan and has no notion of "which threads are due for a
follow-up". So we keep a small local SQLite ledger — one row per outreach *thread* — that caches the
facts we need to decide cadence (when we last sent, how many follow-ups we have drafted, whether a
reply arrived) and lets `due_followups()` answer instantly without touching the network. `sync()`
reconciles the ledger with the live mailbox incrementally; everything else reads the ledger.

DB LOCATION. `~/github/jobkit/.cache/outreach/track.db` (under the gitignored `.cache/`, mirroring
`jobkit.jobs.state`). The schema is created/migrated on open.

REPLY DETECTION. A thread counts as `replied` when it contains any message that is NOT from us
(no SENT label and a From that is not the sender) dated after our first send — i.e. a genuine
inbound message, not our own echoes. Automated mail does NOT count: a Mail Delivery Subsystem
bounce or an out-of-office auto-reply must not flip `replied` (that would silence the follow-up
cadence on exactly the threads that most need a nudge — or a corrected address).

SYNC BUDGET. `sync()` is bounded: it lists SENT outreach with a single bounded query
(`in:sent newer_than:120d` by default, or `since`), paging at most a few times, then fetches each
resulting thread once with `format=metadata`. A typical run is ~1-3 `messages.list` calls plus one
`threads.get` per active thread (tens, not thousands). Initial rows can be seeded from
`job-data/outreach-sent/index.csv` to avoid a full historical re-scan.

DRAFT-ONLY. Nothing in this module sends mail. It reads Gmail (`jobkit.outreach.gmail`) and the
local ledger; the only mutation the package performs anywhere is `users.drafts.create`.
"""

from __future__ import annotations

import csv
import re
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from jobkit.outreach import gmail, templates

DB_PATH = Path.home() / "github" / "jobkit" / ".cache" / "outreach" / "track.db"

# Default bounded scan window and paging budget for sync().
_DEFAULT_SINCE = "newer_than:120d"
_MAX_LIST_FETCHES = 5

# The Gmail query that recovered the ESL outreach corpus: SENT mail mentioning the campaign's
# vocabulary. Kept broad enough to catch the school-specific subjects, bounded by the window.
_OUTREACH_TERMS = "English teacher OR English teaching OR ESL OR TEFL OR TESOL OR teaching position"

# A reply is "inbound" only if dated at least this long after our first send (guards against the
# rare clock-skew case where an autoreply shares our send second).
_REPLY_GRACE_MS = 0

# Automated-mail signals. A message matching any of these is NOT a reply: bounces come from
# mailer-daemon/postmaster addresses with delivery-failure subjects, and auto-replies carry an
# `Auto-Submitted` header (RFC 3834) or an out-of-office subject. Substring/regex matching on
# headers is deliberate — bounce wording varies wildly across providers.
_AUTOMATED_FROM_CUES = ("mailer-daemon", "postmaster@", "no-reply", "noreply@", "donotreply")
_AUTOMATED_SUBJECT_RE = re.compile(
    r"undeliver|delivery status|delivery has failed|mail delivery|returned mail"
    r"|failure notice|delivery incomplete|address not found|message blocked"
    r"|out of (?:the )?office|automatic reply|auto[ -]?reply|away from",
    re.IGNORECASE,
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS threads (
    thread_id        TEXT PRIMARY KEY,
    to_email         TEXT NOT NULL DEFAULT '',
    org              TEXT NOT NULL DEFAULT '',
    country          TEXT NOT NULL DEFAULT '',
    subject          TEXT NOT NULL DEFAULT '',
    first_sent       TEXT NOT NULL DEFAULT '',
    last_sent        TEXT NOT NULL DEFAULT '',
    our_msgs         INTEGER NOT NULL DEFAULT 0,
    replied          INTEGER NOT NULL DEFAULT 0,
    outcome          TEXT NOT NULL DEFAULT '',
    followups_drafted INTEGER NOT NULL DEFAULT 0,
    last_synced      TEXT NOT NULL DEFAULT ''
);
"""


@dataclass(frozen=True)
class ThreadRow:
    """One tracked outreach thread (a row of the `threads` table)."""

    thread_id: str
    to_email: str
    org: str
    country: str
    subject: str
    first_sent: str
    last_sent: str
    our_msgs: int
    replied: bool
    outcome: str
    followups_drafted: int
    last_synced: str


def connect(db_path: Path = DB_PATH) -> sqlite3.Connection:
    """Open the tracking DB (creating parent dirs + schema), returning a Row-factory connection."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(_SCHEMA)
    return conn


def _row_to_thread(row: sqlite3.Row) -> ThreadRow:
    """Map a sqlite Row to a `ThreadRow` dataclass."""
    return ThreadRow(
        thread_id=row["thread_id"],
        to_email=row["to_email"],
        org=row["org"],
        country=row["country"],
        subject=row["subject"],
        first_sent=row["first_sent"],
        last_sent=row["last_sent"],
        our_msgs=row["our_msgs"],
        replied=bool(row["replied"]),
        outcome=row["outcome"],
        followups_drafted=row["followups_drafted"],
        last_synced=row["last_synced"],
    )


def all_threads(conn: sqlite3.Connection) -> list[ThreadRow]:
    """Return every tracked thread, newest-first by `last_sent`."""
    cur = conn.execute("SELECT * FROM threads ORDER BY last_sent DESC")
    return [_row_to_thread(r) for r in cur.fetchall()]


def get_row(conn: sqlite3.Connection, thread_id: str) -> ThreadRow | None:
    """Return a single tracked thread by id, or None."""
    cur = conn.execute("SELECT * FROM threads WHERE thread_id = ?", (thread_id,))
    row = cur.fetchone()
    return _row_to_thread(row) if row is not None else None


def seed_from_index(conn: sqlite3.Connection, index_csv: Path) -> int:
    """Seed initial rows from `job-data/outreach-sent/index.csv` (idempotent).

    The historical index has no Gmail thread id, so we key seeded rows by a synthetic
    `seed:<to_email>:<subject>` id and never overwrite a real synced thread. Returns rows inserted.
    """
    if not index_csv.exists():
        return 0
    inserted = 0
    with index_csv.open(encoding="utf-8") as handle:
        for record in csv.DictReader(handle):
            to_email = (record.get("to_email") or "").strip()
            subject = (record.get("subject") or "").strip()
            if not to_email:
                continue
            thread_id = f"seed:{to_email}:{subject}"
            if get_row(conn, thread_id) is not None:
                continue
            date = (record.get("date") or "").strip()
            replied = 1 if (record.get("replied") or "").strip().lower() == "yes" else 0
            conn.execute(
                """
                INSERT OR IGNORE INTO threads
                  (thread_id, to_email, org, country, subject, first_sent, last_sent,
                   our_msgs, replied, outcome, followups_drafted, last_synced)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0, 'seed')
                """,
                (
                    thread_id,
                    to_email,
                    (record.get("org") or "").strip(),
                    (record.get("country") or "").strip(),
                    subject,
                    date,
                    date,
                    replied,
                    (record.get("outcome") or "").strip(),
                ),
            )
            inserted += 1
    conn.commit()
    return inserted


@dataclass(frozen=True)
class SyncResult:
    """Summary of a `sync()` run."""

    threads_tracked: int
    replied: int
    awaiting: int
    threads_seen: int
    list_fetches: int
    thread_fetches: int


def _sender_address() -> str:
    """Return the bare sender email address, lowercased, used to classify SENT vs inbound."""
    return templates.SENDER_EMAIL.lower()


def _is_inbound(msg: gmail.ThreadMessage, sender: str) -> bool:
    """Return True if `msg` is a genuine inbound reply (not from us, not a bounce/auto-reply)."""
    if msg.is_sent:
        return False
    if sender in msg.headers.get("From", "").lower():
        return False
    return not _is_automated(msg)


def _is_automated(msg: gmail.ThreadMessage) -> bool:
    """Return True if `msg` looks like automated mail (bounce, auto-reply, out-of-office)."""
    from_header = msg.headers.get("From", "").lower()
    if any(cue in from_header for cue in _AUTOMATED_FROM_CUES):
        return True
    auto_submitted = msg.headers.get("Auto-Submitted", "").strip().lower()
    if auto_submitted and auto_submitted != "no":
        return True
    return bool(_AUTOMATED_SUBJECT_RE.search(msg.headers.get("Subject", "")))


def _summarize_thread(info: gmail.ThreadInfo, sender: str) -> dict[str, object] | None:
    """Reduce a fetched thread to the ledger facts, or None if it has no message from us."""
    sent = [m for m in info.messages if m.is_sent]
    if not sent:
        return None
    first_sent_ms = sent[0].internal_date_ms
    last_sent_ms = sent[-1].internal_date_ms
    replied = any(
        _is_inbound(m, sender) and m.internal_date_ms >= first_sent_ms + _REPLY_GRACE_MS
        for m in info.messages
    )
    first_msg = info.messages[0]
    to_header = sent[0].headers.get("To", "")
    return {
        "to_email": _extract_email(to_header),
        "org": _domain_of(_extract_email(to_header)),
        "subject": _base_subject(first_msg.headers.get("Subject", "")),
        "first_sent": _iso_from_ms(first_sent_ms),
        "last_sent": _iso_from_ms(last_sent_ms),
        "our_msgs": len(sent),
        "replied": 1 if replied else 0,
    }


def sync(
    since: str | None = None,
    *,
    db_path: Path = DB_PATH,
    index_csv: Path | None = None,
) -> SyncResult:
    """Reconcile the local ledger with the live SENT mailbox (bounded, incremental).

    Lists SENT outreach within the window (`since` or the default 120-day window), then fetches
    each thread once and upserts its row. Optionally seeds historical rows from `index_csv` first.
    Records `last_synced` on every touched row. Returns a `SyncResult` summary.
    """
    window = since or _DEFAULT_SINCE
    query = f"in:sent ({_OUTREACH_TERMS}) {window}"
    sender = _sender_address()
    now_iso = _now_iso()

    conn = connect(db_path)
    try:
        if index_csv is not None:
            seed_from_index(conn, index_csv)

        thread_ids, list_fetches = gmail.list_sent_thread_ids(query, max_fetches=_MAX_LIST_FETCHES)
        thread_fetches = 0
        for thread_id in thread_ids:
            info = gmail.get_thread(thread_id)
            thread_fetches += 1
            facts = _summarize_thread(info, sender)
            if facts is None:
                continue
            _upsert(conn, thread_id, facts, now_iso)
        conn.commit()

        rows = all_threads(conn)
        replied = sum(1 for r in rows if r.replied)
        return SyncResult(
            threads_tracked=len(rows),
            replied=replied,
            awaiting=len(rows) - replied,
            threads_seen=len(thread_ids),
            list_fetches=list_fetches,
            thread_fetches=thread_fetches,
        )
    finally:
        conn.close()


def _upsert(
    conn: sqlite3.Connection,
    thread_id: str,
    facts: dict[str, object],
    now_iso: str,
) -> None:
    """Insert or update a thread row from synced `facts`, preserving local follow-up counters."""
    existing = get_row(conn, thread_id)
    followups = existing.followups_drafted if existing is not None else 0
    outcome = existing.outcome if existing is not None and existing.outcome else ""
    conn.execute(
        """
        INSERT INTO threads
          (thread_id, to_email, org, country, subject, first_sent, last_sent,
           our_msgs, replied, outcome, followups_drafted, last_synced)
        VALUES (:thread_id, :to_email, :org, '', :subject, :first_sent, :last_sent,
                :our_msgs, :replied, :outcome, :followups, :last_synced)
        ON CONFLICT(thread_id) DO UPDATE SET
          to_email   = excluded.to_email,
          org        = excluded.org,
          subject    = excluded.subject,
          first_sent = excluded.first_sent,
          last_sent  = excluded.last_sent,
          our_msgs   = excluded.our_msgs,
          replied    = excluded.replied,
          last_synced = excluded.last_synced
        """,
        {
            "thread_id": thread_id,
            "to_email": facts["to_email"],
            "org": facts["org"],
            "subject": facts["subject"],
            "first_sent": facts["first_sent"],
            "last_sent": facts["last_sent"],
            "our_msgs": facts["our_msgs"],
            "replied": facts["replied"],
            "outcome": outcome,
            "followups": followups,
            "last_synced": now_iso,
        },
    )


@dataclass(frozen=True)
class DueFollowup:
    """A thread due for a follow-up, with the follow-up number to draft next."""

    row: ThreadRow
    followup_number: int
    days_since_last: int


def due_followups(
    now_iso: str,
    *,
    db_path: Path = DB_PATH,
    cadence: tuple[int, ...] = (4, 10),
    max_followups: int = 2,
) -> list[DueFollowup]:
    """Return threads due for a follow-up given `now_iso` (caller supplies the clock).

    A thread is due when it is unreplied, has drafted fewer than `max_followups` follow-ups, and
    `last_sent` is older than the next cadence step (#1 >= cadence[0] days, #2 >= cadence[1]).
    Seed rows (synthetic ids) are skipped — we cannot reply in-thread to a thread we never fetched.
    """
    now = _parse_iso(now_iso)
    conn = connect(db_path)
    try:
        due: list[DueFollowup] = []
        for row in all_threads(conn):
            if row.replied or row.thread_id.startswith("seed:"):
                continue
            if row.followups_drafted >= max_followups:
                continue
            next_n = row.followups_drafted + 1
            if next_n > len(cadence):
                continue
            required_days = cadence[next_n - 1]
            last_sent = _parse_iso(row.last_sent)
            if last_sent is None:
                continue
            days = (now - last_sent).days if now is not None else 0
            if days >= required_days:
                due.append(DueFollowup(row=row, followup_number=next_n, days_since_last=days))
        return due
    finally:
        conn.close()


def increment_followup(conn: sqlite3.Connection, thread_id: str) -> None:
    """Increment a thread's drafted-follow-up counter (after a successful in-thread draft)."""
    conn.execute(
        "UPDATE threads SET followups_drafted = followups_drafted + 1 WHERE thread_id = ?",
        (thread_id,),
    )
    conn.commit()


def set_followup_count(conn: sqlite3.Connection, thread_id: str, count: int) -> None:
    """Set a thread's drafted-follow-up counter (used to reset after deleting a test draft)."""
    conn.execute(
        "UPDATE threads SET followups_drafted = ? WHERE thread_id = ?",
        (count, thread_id),
    )
    conn.commit()


# --- small pure helpers -------------------------------------------------------------------------


def _now_iso() -> str:
    """Return the current UTC time as an ISO-8601 string (used for last_synced)."""
    return datetime.now(UTC).isoformat()


def _parse_iso(value: str) -> datetime | None:
    """Parse an ISO-8601 or `YYYY-MM-DD` timestamp to an aware UTC datetime, or None."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        try:
            parsed = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=UTC)
        except ValueError:
            return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _iso_from_ms(ms: int) -> str:
    """Convert Gmail's epoch-millisecond `internalDate` to an ISO-8601 UTC string."""
    if ms <= 0:
        return ""
    return datetime.fromtimestamp(ms / 1000, tz=UTC).isoformat()


def _extract_email(header: str) -> str:
    """Pull the bare `addr@host` out of a `Name <addr@host>` To/From header."""
    text = header.strip()
    if "<" in text and ">" in text:
        text = text[text.index("<") + 1 : text.index(">")]
    return text.strip().lower()


def _domain_of(email: str) -> str:
    """Return the domain part of an email address (or '')."""
    return email.split("@", 1)[1] if "@" in email else ""


def _base_subject(subject: str) -> str:
    """Strip a leading `Re:`/`Fwd:` so the stored subject matches the original outreach."""
    text = subject.strip()
    lowered = text.lower()
    for prefix in ("re:", "fwd:", "fw:"):
        while lowered.startswith(prefix):
            text = text[len(prefix) :].strip()
            lowered = text.lower()
    return text
