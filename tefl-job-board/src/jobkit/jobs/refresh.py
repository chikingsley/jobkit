"""Phase-based, resumable board refresh orchestration."""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import nullcontext
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from jobkit.jobs import db
from jobkit.jobs.models import DiscoveredJob, JobPosting

if TYPE_CHECKING:
    import sqlite3
    from collections.abc import Sequence
    from contextlib import AbstractContextManager

    from jobkit.jobs.registry import BoardPolicy

    Hydrator = Callable[[DiscoveredJob], JobPosting]

RefreshMode = Literal["full", "latest"]
ProgressReporter = Callable[[str], None]


@dataclass(frozen=True)
class ResumableRefreshResult:
    """Durable board-crawl outcome, including partial work that can be resumed."""

    closed: int
    discovered: int
    failed: int
    hydrated: int
    inserted: int
    reopened: int
    run_id: int
    scan_run_id: int
    skipped: int
    status: Literal["completed", "partial"]
    updated: int


def refresh_board(
    conn: sqlite3.Connection,
    policy: BoardPolicy,
    *,
    mode: RefreshMode,
    restart: bool = False,
    report: ProgressReporter | None = None,
) -> ResumableRefreshResult:
    """Discover once, persist the ID ledger, and resume incomplete hydrations."""
    if restart:
        _cancel_active_run(conn, policy.name, mode)
    run = _read_active_run(conn, policy.name, mode)
    if run is None:
        run = _start_run(conn, policy.name, mode)
    else:
        _report(report, f"resuming crawl {run['id']} ({run['status']})")

    if not bool(run["discovery_complete"]):
        _discover(conn, run, policy, mode, report)
        run = _read_run(conn, int(run["id"]))

    _hydrate(conn, run, policy, report)
    return _finish_or_pause(conn, run)


def _discover(
    conn: sqlite3.Connection,
    run: sqlite3.Row,
    policy: BoardPolicy,
    mode: RefreshMode,
    report: ProgressReporter | None,
) -> None:
    _report(report, f"discovering {policy.name} {mode} inventory")
    try:
        discovery = policy.discover_latest() if mode == "latest" else policy.discover_full()
    except Exception as exc:
        conn.execute(
            "UPDATE crawl_runs SET error_detail=?,updated_at=? WHERE id=?",
            (str(exc), db.now_iso(), run["id"]),
        )
        conn.commit()
        raise
    if mode == "full" and not discovery.complete:
        message = f"{policy.name} did not prove complete source discovery; refusing reconciliation"
        conn.execute(
            "UPDATE crawl_runs SET error_detail=?,updated_at=? WHERE id=?",
            (message, db.now_iso(), run["id"]),
        )
        conn.commit()
        raise RuntimeError(message)
    unique = list({item.job_id: item for item in discovery.items}.values())
    timestamp = db.now_iso()
    conn.executemany(
        """
        INSERT INTO crawl_items
          (run_id,board,job_id,ordinal,metadata_json,status,discovered_at)
        VALUES (?,?,?,?,?,'discovered',?)
        ON CONFLICT(run_id,board,job_id) DO UPDATE SET
          ordinal=excluded.ordinal,
          metadata_json=excluded.metadata_json
        """,
        (
            (
                run["id"],
                policy.name,
                item.job_id,
                ordinal,
                json.dumps(item.metadata, ensure_ascii=False),
                timestamp,
            )
            for ordinal, item in enumerate(unique)
        ),
    )
    closed = db.reconcile_discovered_ids(
        conn,
        crawl_run_id=int(run["id"]),
        board=policy.name,
        checked_at=timestamp,
        close_missing=mode == "full",
    )
    conn.execute(
        """
        UPDATE crawl_runs
        SET status='hydrating',discovery_complete=1,source_complete=?,
            discovery_evidence_json=?,discovered_count=?,
            closed_count=?,error_detail='',updated_at=?
        WHERE id=?
        """,
        (
            int(discovery.complete),
            json.dumps(discovery.evidence, ensure_ascii=False, sort_keys=True),
            len(unique),
            closed,
            timestamp,
            run["id"],
        ),
    )
    conn.commit()
    evidence = ", ".join(f"{key}={value}" for key, value in discovery.evidence.items())
    suffix = f" ({evidence})" if evidence else ""
    _report(report, f"discovered {len(unique)} IDs; closed {closed} absent listings{suffix}")


def _hydrate(
    conn: sqlite3.Connection,
    run: sqlite3.Row,
    policy: BoardPolicy,
    report: ProgressReporter | None,
) -> None:
    pending = _pending_items(conn, int(run["id"]))
    if not pending:
        return
    conn.execute(
        "UPDATE crawl_runs SET status='hydrating',error_detail='',updated_at=? WHERE id=?",
        (db.now_iso(), run["id"]),
    )
    conn.commit()
    total = len(pending)
    _report(report, f"hydrating {total} pending detail pages")
    with _open_hydrator(policy) as hydrate:
        if policy.hydrate_workers > 1:
            _hydrate_parallel(conn, run, policy, pending, report, hydrate)
            return
        for index, item in enumerate(pending, start=1):
            if index > 1 and policy.hydrate_delay_seconds > 0:
                time.sleep(policy.hydrate_delay_seconds)
            _hydrate_one(conn, run, policy.name, item, hydrate)
            _report_percent(report, index, total)


def _hydrate_parallel(  # noqa: PLR0913 - the batch boundary keeps DB, policy, and progress explicit.
    conn: sqlite3.Connection,
    run: sqlite3.Row,
    policy: BoardPolicy,
    pending: Sequence[DiscoveredJob],
    report: ProgressReporter | None,
    hydrate: Hydrator,
) -> None:
    total = len(pending)
    with ThreadPoolExecutor(max_workers=policy.hydrate_workers) as executor:
        futures = {}
        for item in pending:
            _record_attempt(conn, int(run["id"]), policy.name, item.job_id)
            futures[executor.submit(hydrate, item)] = item
        for index, future in enumerate(as_completed(futures), start=1):
            item = futures[future]
            try:
                posting = future.result()
            except Exception as exc:  # noqa: BLE001 - every adapter failure is persisted per item.
                _record_failure(conn, int(run["id"]), policy.name, item.job_id, exc)
            else:
                _record_success(conn, run, policy.name, item.job_id, posting)
            _report_percent(report, index, total)


def _hydrate_one(
    conn: sqlite3.Connection,
    run: sqlite3.Row,
    board: str,
    item: DiscoveredJob,
    hydrate: Hydrator,
) -> None:
    _record_attempt(conn, int(run["id"]), board, item.job_id)
    try:
        posting = hydrate(item)
    except Exception as exc:  # noqa: BLE001 - every adapter failure is persisted per item.
        _record_failure(conn, int(run["id"]), board, item.job_id, exc)
        return
    _record_success(conn, run, board, item.job_id, posting)


def _open_hydrator(policy: BoardPolicy) -> AbstractContextManager[Hydrator]:
    if policy.hydration_session is not None:
        return policy.hydration_session()
    return nullcontext(policy.hydrate)


def _record_attempt(conn: sqlite3.Connection, run_id: int, board: str, job_id: str) -> None:
    conn.execute(
        """
        UPDATE crawl_items
        SET attempts=attempts+1,last_attempt_at=?
        WHERE run_id=? AND board=? AND job_id=?
        """,
        (db.now_iso(), run_id, board, job_id),
    )
    conn.commit()


def _record_success(
    conn: sqlite3.Connection,
    run: sqlite3.Row,
    board: str,
    job_id: str,
    posting: JobPosting,
) -> None:
    if not isinstance(posting, JobPosting):
        msg = f"{board} hydrator returned {type(posting).__name__}, expected JobPosting"
        raise TypeError(msg)
    timestamp = db.now_iso()
    try:
        outcome = db.upsert_posting(
            conn,
            posting,
            run_id=int(run["scan_run_id"]),
            seen_at=timestamp,
        )
        conn.execute(
            """
            UPDATE crawl_items
            SET status='hydrated',outcome=?,error_detail='',hydrated_at=?
            WHERE run_id=? AND board=? AND job_id=?
            """,
            (outcome, timestamp, run["id"], board, job_id),
        )
        conn.commit()
    except BaseException:
        conn.rollback()
        raise


def _record_failure(
    conn: sqlite3.Connection,
    run_id: int,
    board: str,
    job_id: str,
    error: Exception,
) -> None:
    conn.execute(
        """
        UPDATE crawl_items
        SET status='failed',error_detail=?
        WHERE run_id=? AND board=? AND job_id=?
        """,
        (str(error)[:4000], run_id, board, job_id),
    )
    conn.commit()


def _finish_or_pause(conn: sqlite3.Connection, run: sqlite3.Row) -> ResumableRefreshResult:
    summary = conn.execute(
        """
        SELECT COUNT(*) discovered,
               SUM(status='hydrated') hydrated,
               SUM(status='failed') failed,
               SUM(outcome='inserted') inserted,
               SUM(outcome='updated') updated,
               SUM(outcome='reopened') reopened,
               SUM(outcome='skipped') skipped
        FROM crawl_items WHERE run_id=?
        """,
        (run["id"],),
    ).fetchone()
    failed = int(summary["failed"] or 0)
    status: Literal["completed", "partial"] = "partial" if failed else "completed"
    timestamp = db.now_iso()
    error_detail = f"{failed} detail pages remain failed" if failed else ""
    conn.execute(
        """
        UPDATE crawl_runs
        SET status=?,hydrated_count=?,failed_count=?,error_detail=?,
            finished_at=CASE WHEN ?='completed' THEN ? ELSE '' END,
            updated_at=?
        WHERE id=?
        """,
        (
            status,
            int(summary["hydrated"] or 0),
            failed,
            error_detail,
            status,
            timestamp,
            timestamp,
            run["id"],
        ),
    )
    result = ResumableRefreshResult(
        closed=int(run["closed_count"]),
        discovered=int(summary["discovered"] or 0),
        failed=failed,
        hydrated=int(summary["hydrated"] or 0),
        inserted=int(summary["inserted"] or 0),
        reopened=int(summary["reopened"] or 0),
        run_id=int(run["id"]),
        scan_run_id=int(run["scan_run_id"]),
        skipped=int(summary["skipped"] or 0),
        status=status,
        updated=int(summary["updated"] or 0),
    )
    if status == "completed":
        db.finish_scan(
            conn,
            db.RefreshResult(
                run_id=result.scan_run_id,
                db_path=db.database_path(conn),
                seen=result.discovered,
                inserted=result.inserted,
                updated=result.updated,
                reopened=result.reopened,
                closed=result.closed,
                skipped=result.skipped,
            ),
            finished_at=timestamp,
        )
    conn.commit()
    return result


def _pending_items(conn: sqlite3.Connection, run_id: int) -> list[DiscoveredJob]:
    rows = conn.execute(
        """
        SELECT job_id,metadata_json
        FROM crawl_items
        WHERE run_id=? AND status IN ('discovered','failed')
        ORDER BY ordinal
        """,
        (run_id,),
    ).fetchall()
    return [
        DiscoveredJob(job_id=str(row["job_id"]), metadata=json.loads(row["metadata_json"]))
        for row in rows
    ]


def _start_run(conn: sqlite3.Connection, board: str, mode: RefreshMode) -> sqlite3.Row:
    timestamp = db.now_iso()
    scan_run_id = db.start_scan(
        conn,
        board=board,
        mode=mode,
        close_missing=mode == "full",
        started_at=timestamp,
    )
    cursor = conn.execute(
        """
        INSERT INTO crawl_runs
          (scan_run_id,board,mode,status,started_at,updated_at)
        VALUES (?,?,?,'discovering',?,?)
        """,
        (scan_run_id, board, mode, timestamp, timestamp),
    )
    conn.commit()
    if cursor.lastrowid is None:
        msg = "crawl_runs insert did not return a row id"
        raise RuntimeError(msg)
    return _read_run(conn, cursor.lastrowid)


def _read_active_run(conn: sqlite3.Connection, board: str, mode: RefreshMode) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT * FROM crawl_runs
        WHERE board=? AND mode=? AND status IN ('discovering','hydrating','partial')
        ORDER BY id DESC LIMIT 1
        """,
        (board, mode),
    ).fetchone()


def _read_run(conn: sqlite3.Connection, run_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM crawl_runs WHERE id=?", (run_id,)).fetchone()
    if row is None:
        msg = f"crawl run {run_id} disappeared"
        raise RuntimeError(msg)
    return row


def _cancel_active_run(conn: sqlite3.Connection, board: str, mode: RefreshMode) -> None:
    timestamp = db.now_iso()
    active = _read_active_run(conn, board, mode)
    if active is None:
        return
    conn.execute(
        """
        UPDATE crawl_runs
        SET status='canceled',finished_at=?,updated_at=?
        WHERE id=?
        """,
        (timestamp, timestamp, active["id"]),
    )
    conn.execute(
        "UPDATE scan_runs SET finished_at=? WHERE id=? AND finished_at=''",
        (timestamp, active["scan_run_id"]),
    )
    conn.commit()


def _report(reporter: ProgressReporter | None, message: str) -> None:
    if reporter is not None:
        reporter(message)


def _report_percent(reporter: ProgressReporter | None, completed: int, total: int) -> None:
    if reporter is None or total <= 0:
        return
    current_percent = completed * 100 // total
    previous_percent = (completed - 1) * 100 // total
    if completed == total or current_percent > previous_percent:
        reporter(f"hydrated {completed}/{total} ({current_percent}%)")
