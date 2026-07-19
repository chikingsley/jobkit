"""Integration coverage for the durable discovery/hydration boundary."""

from __future__ import annotations

import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING

from jobkit.jobs import db, refresh
from jobkit.jobs.models import DiscoveredJob, DiscoveryResult, JobPosting
from jobkit.jobs.registry import BoardPolicy

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator


class ResumableRefreshIntegrationTest(unittest.TestCase):
    """Exercise interruption, resume, and safe full reconciliation in SQLite."""

    def test_failed_hydration_resumes_without_repeating_completed_work(self) -> None:
        """A second invocation hydrates only the item that failed during the first."""
        with tempfile.TemporaryDirectory() as directory:
            conn = db.connect(Path(directory) / "jobs.sqlite")
            calls: list[str] = []
            fail_second = True

            def discover() -> DiscoveryResult:
                return DiscoveryResult(
                    items=(DiscoveredJob("first"), DiscoveredJob("second")),
                    complete=True,
                )

            def hydrate(item: DiscoveredJob) -> JobPosting:
                nonlocal fail_second
                calls.append(item.job_id)
                if item.job_id == "second" and fail_second:
                    fail_second = False
                    message = "temporary detail failure"
                    raise RuntimeError(message)
                return JobPosting(
                    board="integration-board",
                    job_id=item.job_id,
                    title=f"Job {item.job_id}",
                    url=f"https://example.test/{item.job_id}",
                )

            policy = BoardPolicy(
                "integration-board",
                discover,
                discover,
                hydrate,
                hydrate_delay_seconds=0,
            )
            first = refresh.refresh_board(conn, policy, mode="full")
            second = refresh.refresh_board(conn, policy, mode="full")

            assert first.status == "partial"
            assert first.hydrated == 1
            assert first.failed == 1
            assert second.status == "completed"
            assert second.run_id == first.run_id
            assert calls == ["first", "second", "second"]
            rows = conn.execute(
                "SELECT job_id,attempts,status FROM crawl_items ORDER BY ordinal"
            ).fetchall()
            assert [dict(row) for row in rows] == [
                {"job_id": "first", "attempts": 1, "status": "hydrated"},
                {"job_id": "second", "attempts": 2, "status": "hydrated"},
            ]
            runs = db.crawl_run_history(conn)
            assert len(runs) == 1
            assert {
                key: runs[0][key]
                for key in (
                    "id",
                    "board",
                    "mode",
                    "status",
                    "source_complete",
                    "discovery_evidence_json",
                    "discovered",
                    "hydrated",
                    "failed",
                    "attempts",
                    "closed",
                    "error_detail",
                )
            } == {
                "id": first.run_id,
                "board": "integration-board",
                "mode": "full",
                "status": "completed",
                "source_complete": 1,
                "discovery_evidence_json": "{}",
                "discovered": 2,
                "hydrated": 2,
                "failed": 0,
                "attempts": 3,
                "closed": 0,
                "error_detail": "",
            }
            assert conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 2
            conn.close()

    def test_complete_full_discovery_closes_only_absent_listing(self) -> None:
        """A later complete source traversal closes an ID that truly disappeared."""
        with tempfile.TemporaryDirectory() as directory:
            conn = db.connect(Path(directory) / "jobs.sqlite")
            discovered_ids = ["first", "second"]

            def discover() -> DiscoveryResult:
                return DiscoveryResult(
                    items=tuple(DiscoveredJob(job_id) for job_id in discovered_ids),
                    complete=True,
                )

            def hydrate(item: DiscoveredJob) -> JobPosting:
                return _posting(item.job_id)

            policy = BoardPolicy(
                "integration-board",
                discover,
                discover,
                hydrate,
                hydrate_delay_seconds=0,
            )
            refresh.refresh_board(conn, policy, mode="full")
            discovered_ids[:] = ["first"]
            result = refresh.refresh_board(conn, policy, mode="full")

            assert result.closed == 1
            rows = conn.execute("SELECT job_id,status FROM jobs ORDER BY job_id").fetchall()
            assert [dict(row) for row in rows] == [
                {"job_id": "first", "status": "active"},
                {"job_id": "second", "status": "closed"},
            ]
            conn.close()

    def test_unproven_full_discovery_cannot_close_inventory(self) -> None:
        """An incomplete parser result fails closed before reconciliation or hydration."""
        with tempfile.TemporaryDirectory() as directory:
            conn = db.connect(Path(directory) / "jobs.sqlite")
            complete = True
            hydrate_calls = 0

            def discover() -> DiscoveryResult:
                return DiscoveryResult(items=(DiscoveredJob("existing"),), complete=complete)

            def hydrate(item: DiscoveredJob) -> JobPosting:
                nonlocal hydrate_calls
                hydrate_calls += 1
                return _posting(item.job_id)

            policy = BoardPolicy(
                "integration-board",
                discover,
                discover,
                hydrate,
                hydrate_delay_seconds=0,
            )
            refresh.refresh_board(conn, policy, mode="full")
            complete = False

            with self.assertRaisesRegex(  # noqa: PT027 - this suite intentionally uses unittest.
                RuntimeError, "refusing reconciliation"
            ):
                refresh.refresh_board(conn, policy, mode="full")

            status = conn.execute(
                "SELECT status FROM jobs WHERE board='integration-board' AND job_id='existing'"
            ).fetchone()[0]
            assert status == "active"
            assert hydrate_calls == 1
            conn.close()

    def test_policy_hydration_session_wraps_the_whole_batch(self) -> None:
        """Session-backed boards can reuse one authenticated client for every item."""
        with tempfile.TemporaryDirectory() as directory:
            conn = db.connect(Path(directory) / "jobs.sqlite")
            events: list[str] = []

            def discover() -> DiscoveryResult:
                return DiscoveryResult(
                    items=(DiscoveredJob("first"), DiscoveredJob("second")),
                    complete=True,
                )

            def unused_hydrator(_item: DiscoveredJob) -> JobPosting:
                message = "the session hydrator should be authoritative"
                raise AssertionError(message)

            @contextmanager
            def hydration_session() -> Iterator[Callable[[DiscoveredJob], JobPosting]]:
                events.append("open")

                def hydrate(item: DiscoveredJob) -> JobPosting:
                    events.append(item.job_id)
                    return _posting(item.job_id)

                try:
                    yield hydrate
                finally:
                    events.append("close")

            policy = BoardPolicy(
                "integration-board",
                discover,
                discover,
                unused_hydrator,
                hydrate_delay_seconds=0,
                hydration_session=hydration_session,
            )
            result = refresh.refresh_board(conn, policy, mode="full")

            assert result.status == "completed"
            assert events == ["open", "first", "second", "close"]
            conn.close()


def _posting(job_id: str) -> JobPosting:
    return JobPosting(
        board="integration-board",
        job_id=job_id,
        title=f"Job {job_id}",
        url=f"https://example.test/{job_id}",
    )


if __name__ == "__main__":
    unittest.main()
