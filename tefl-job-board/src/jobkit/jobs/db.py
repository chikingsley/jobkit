"""SQLite job inventory for scraped board postings.

The database is the durable inventory. Refreshes upsert one row per ``(board, job_id)`` and record
each scan separately so "missing from a full crawl" can be treated very differently from "missing
from a latest-only sample".
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from jobkit.jobs import enrich

if TYPE_CHECKING:
    from collections.abc import Sequence

    from jobkit.jobs.enrich import Extractor
    from jobkit.jobs.models import JobPosting

PROJECT_ROOT = Path(__file__).resolve().parents[3]
WORKSPACE_ROOT = PROJECT_ROOT.parent
DB_PATH = WORKSPACE_ROOT / "job-search" / "job-data" / "jobs.sqlite"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    board                TEXT NOT NULL,
    job_id               TEXT NOT NULL,
    url                  TEXT NOT NULL DEFAULT '',
    title                TEXT NOT NULL DEFAULT '',
    company              TEXT NOT NULL DEFAULT '',
    location             TEXT NOT NULL DEFAULT '',
    country              TEXT NOT NULL DEFAULT '',
    salary               TEXT NOT NULL DEFAULT '',
    currency             TEXT NOT NULL DEFAULT '',
    degree_required      TEXT NOT NULL DEFAULT '',
    eu_passport_required TEXT NOT NULL DEFAULT '',
    contract_length      TEXT NOT NULL DEFAULT '',
    start_date           TEXT NOT NULL DEFAULT '',
    apply_email          TEXT NOT NULL DEFAULT '',
    apply_url            TEXT NOT NULL DEFAULT '',
    posted_date          TEXT NOT NULL DEFAULT '',
    description          TEXT NOT NULL DEFAULT '',
    raw                  TEXT NOT NULL DEFAULT '',
    raw_json             TEXT NOT NULL DEFAULT '{}',
    normalized_json      TEXT NOT NULL DEFAULT '{}',
    status               TEXT NOT NULL DEFAULT 'active'
                         CHECK(status IN ('active', 'stale', 'closed', 'ignored', 'applied')),
    first_seen_at        TEXT NOT NULL DEFAULT '',
    last_seen_at         TEXT NOT NULL DEFAULT '',
    last_present_at      TEXT NOT NULL DEFAULT '',
    last_checked_at      TEXT NOT NULL DEFAULT '',
    closed_at            TEXT NOT NULL DEFAULT '',
    last_run_id          INTEGER,
    PRIMARY KEY (board, job_id)
);

CREATE TABLE IF NOT EXISTS scan_runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at      TEXT NOT NULL,
    finished_at     TEXT NOT NULL DEFAULT '',
    boards          TEXT NOT NULL DEFAULT '[]',
    mode            TEXT NOT NULL DEFAULT 'latest',
    close_missing   INTEGER NOT NULL DEFAULT 0,
    source          TEXT NOT NULL DEFAULT '',
    total_seen      INTEGER NOT NULL DEFAULT 0,
    total_new       INTEGER NOT NULL DEFAULT 0,
    total_updated   INTEGER NOT NULL DEFAULT 0,
    total_reopened  INTEGER NOT NULL DEFAULT 0,
    total_closed    INTEGER NOT NULL DEFAULT 0,
    total_skipped   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scan_items (
    run_id      INTEGER NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
    board       TEXT NOT NULL,
    job_id      TEXT NOT NULL,
    seen_at     TEXT NOT NULL,
    PRIMARY KEY (run_id, board, job_id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_board_status ON jobs(board, status);
CREATE INDEX IF NOT EXISTS idx_jobs_country ON jobs(country);
CREATE INDEX IF NOT EXISTS idx_scan_items_board_job ON scan_items(board, job_id);
"""

_UPSERT_SQL = """
INSERT INTO jobs (
    board, job_id, url, title, company, location, country, salary, currency,
    degree_required, eu_passport_required, contract_length, start_date,
    apply_email, apply_url, posted_date, description, raw, raw_json, normalized_json,
    status, first_seen_at, last_seen_at, last_present_at, last_checked_at, closed_at,
    last_run_id
)
VALUES (
    :board, :job_id, :url, :title, :company, :location, :country, :salary, :currency,
    :degree_required, :eu_passport_required, :contract_length, :start_date,
    :apply_email, :apply_url, :posted_date, :description, :raw, :raw_json,
    :normalized_json, :status, :seen_at, :seen_at, :seen_at, :seen_at, :closed_at,
    :run_id
)
ON CONFLICT(board, job_id) DO UPDATE SET
    url = excluded.url,
    title = excluded.title,
    company = excluded.company,
    location = excluded.location,
    country = excluded.country,
    salary = excluded.salary,
    currency = excluded.currency,
    degree_required = excluded.degree_required,
    eu_passport_required = excluded.eu_passport_required,
    contract_length = excluded.contract_length,
    start_date = excluded.start_date,
    apply_email = excluded.apply_email,
    apply_url = excluded.apply_url,
    posted_date = excluded.posted_date,
    description = excluded.description,
    raw = excluded.raw,
    raw_json = excluded.raw_json,
    normalized_json = excluded.normalized_json,
    status = CASE
        WHEN jobs.status IN ('applied', 'ignored') THEN jobs.status
        ELSE 'active'
    END,
    last_seen_at = excluded.last_seen_at,
    last_present_at = excluded.last_present_at,
    last_checked_at = excluded.last_checked_at,
    closed_at = CASE
        WHEN jobs.status IN ('applied', 'ignored') THEN jobs.closed_at
        ELSE ''
    END,
    last_run_id = excluded.last_run_id
"""


@dataclass(frozen=True)
class RefreshResult:
    """Summary of a database refresh operation."""

    run_id: int
    db_path: Path
    seen: int
    inserted: int
    updated: int
    reopened: int
    closed: int
    skipped: int


def now_iso() -> str:
    """Return a compact UTC timestamp for DB audit columns."""
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def connect(db_path: Path = DB_PATH) -> sqlite3.Connection:
    """Open the jobs database, creating its parent directory and schema if needed."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(_SCHEMA)
    return conn


def refresh_postings(  # noqa: PLR0913 - explicit DB refresh controls are clearer at call sites.
    conn: sqlite3.Connection,
    postings: Sequence[JobPosting],
    *,
    boards: Sequence[str],
    mode: str,
    close_missing: bool,
    extractor: Extractor = enrich.DEFAULT_EXTRACTOR,
) -> RefreshResult:
    """Upsert fetched postings and optionally close absent active rows after a full crawl."""
    seen_at = now_iso()
    run_id = _start_scan(
        conn,
        boards=boards,
        mode=mode,
        close_missing=close_missing,
        source="fetch",
        started_at=seen_at,
    )
    try:
        rows = enrich.enrich_all(postings, extractor=extractor)
        inserted = updated = reopened = skipped = 0
        for posting, row in zip(postings, rows, strict=True):
            outcome = _upsert_row(
                conn,
                row=row,
                raw_json=json.dumps(posting.as_dict(), ensure_ascii=False),
                status="active",
                run_id=run_id,
                seen_at=seen_at,
            )
            if outcome == "inserted":
                inserted += 1
            elif outcome == "reopened":
                reopened += 1
            elif outcome == "updated":
                updated += 1
            else:
                skipped += 1
        closed = (
            _close_missing(conn, run_id=run_id, boards=boards, checked_at=seen_at)
            if close_missing
            else 0
        )
        result = RefreshResult(
            run_id=run_id,
            db_path=_database_path(conn),
            seen=len(rows),
            inserted=inserted,
            updated=updated,
            reopened=reopened,
            closed=closed,
            skipped=skipped,
        )
        _finish_scan(conn, result, finished_at=now_iso())
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    return result


def stats_by_board(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    """Return inventory counts by board and status."""
    return conn.execute(
        """
        SELECT board, status, COUNT(*) AS count
        FROM jobs
        GROUP BY board, status
        ORDER BY board, status
        """,
    ).fetchall()


def stats_by_country(conn: sqlite3.Connection, *, status: str = "active") -> list[sqlite3.Row]:
    """Return country counts for a status, largest first."""
    return conn.execute(
        """
        SELECT COALESCE(NULLIF(country, ''), '(blank)') AS country, COUNT(*) AS count
        FROM jobs
        WHERE status = ?
        GROUP BY COALESCE(NULLIF(country, ''), '(blank)')
        ORDER BY count DESC, country
        """,
        (status,),
    ).fetchall()


def _upsert_row(  # noqa: PLR0913 - one DB boundary with explicit audit fields.
    conn: sqlite3.Connection,
    *,
    row: dict[str, str],
    raw_json: str,
    status: str,
    run_id: int,
    seen_at: str,
) -> str:
    normalized = _normalize_row(row)
    board = normalized["board"]
    job_id = normalized["job_id"]
    if not board or not job_id:
        return "skipped"
    existing = conn.execute(
        "SELECT status FROM jobs WHERE board = ? AND job_id = ?",
        (board, job_id),
    ).fetchone()
    params = {
        **normalized,
        "raw_json": raw_json,
        "normalized_json": json.dumps(normalized, ensure_ascii=False),
        "status": status,
        "seen_at": seen_at,
        "closed_at": "" if status in ("active", "stale") else seen_at,
        "run_id": run_id,
    }
    conn.execute(_UPSERT_SQL, params)
    conn.execute(
        """
        INSERT OR IGNORE INTO scan_items (run_id, board, job_id, seen_at)
        VALUES (?, ?, ?, ?)
        """,
        (run_id, board, job_id, seen_at),
    )
    if existing is None:
        return "inserted"
    previous_status = str(existing["status"])
    if previous_status == "closed" and status in ("active", "stale"):
        return "reopened"
    return "updated"


def _normalize_row(row: dict[str, str]) -> dict[str, str]:
    return {key: str(row.get(key) or "").strip() for key in enrich.SCHEMA}


def _close_missing(
    conn: sqlite3.Connection,
    *,
    run_id: int,
    boards: Sequence[str],
    checked_at: str,
) -> int:
    closed = 0
    for board in boards:
        cur = conn.execute(
            """
            UPDATE jobs
            SET status = 'closed',
                closed_at = ?,
                last_checked_at = ?,
                last_run_id = ?
            WHERE board = ?
              AND status NOT IN ('closed', 'applied', 'ignored')
              AND NOT EXISTS (
                  SELECT 1
                  FROM scan_items
                  WHERE scan_items.run_id = ?
                    AND scan_items.board = jobs.board
                    AND scan_items.job_id = jobs.job_id
              )
            """,
            (checked_at, checked_at, run_id, board, run_id),
        )
        closed += cur.rowcount
    return closed


def _start_scan(  # noqa: PLR0913 - mirrors scan_runs columns.
    conn: sqlite3.Connection,
    *,
    boards: Sequence[str],
    mode: str,
    close_missing: bool,
    source: str,
    started_at: str,
) -> int:
    cur = conn.execute(
        """
        INSERT INTO scan_runs (started_at, boards, mode, close_missing, source)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            started_at,
            json.dumps(list(boards), ensure_ascii=False),
            mode,
            1 if close_missing else 0,
            source,
        ),
    )
    if cur.lastrowid is None:
        msg = "scan_runs insert did not return a row id"
        raise RuntimeError(msg)
    return cur.lastrowid


def _finish_scan(conn: sqlite3.Connection, result: RefreshResult, *, finished_at: str) -> None:
    conn.execute(
        """
        UPDATE scan_runs
        SET finished_at = ?,
            total_seen = ?,
            total_new = ?,
            total_updated = ?,
            total_reopened = ?,
            total_closed = ?,
            total_skipped = ?
        WHERE id = ?
        """,
        (
            finished_at,
            result.seen,
            result.inserted,
            result.updated,
            result.reopened,
            result.closed,
            result.skipped,
            result.run_id,
        ),
    )


def _database_path(conn: sqlite3.Connection) -> Path:
    row = conn.execute("PRAGMA database_list").fetchone()
    return Path(str(row["file"])) if row is not None else DB_PATH
