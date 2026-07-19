"""`jobs` console script for the durable SQLite job inventory."""

from __future__ import annotations

import argparse
from typing import TYPE_CHECKING

from jobkit.jobs import db, refresh
from jobkit.jobs.registry import BOARD_NAMES, BOARD_POLICIES

if TYPE_CHECKING:
    from collections.abc import Sequence


def main() -> None:
    """Run the jobs command-line interface."""
    parser = argparse.ArgumentParser(
        prog="jobs",
        description="Refresh and inspect the SQLite job inventory.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    _add_refresh_parser(subparsers)
    _add_runs_parser(subparsers)
    _add_stats_parser(subparsers)
    _add_countries_parser(subparsers)
    args = parser.parse_args()

    if args.command == "refresh":
        _run_refresh(args)
    elif args.command == "runs":
        _run_runs(args)
    elif args.command == "stats":
        _run_stats()
    else:
        _run_countries()


def _add_refresh_parser(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    parser = subparsers.add_parser("refresh", help="refresh boards into SQLite")
    parser.add_argument(
        "--latest",
        action="store_true",
        help="fetch each board's newest listings without closing unseen inventory",
    )
    parser.add_argument(
        "--restart",
        action="store_true",
        help="cancel an unfinished crawl and run discovery again instead of resuming it",
    )
    parser.add_argument(
        "boards", nargs="*", help=f"board names (default: all of {', '.join(BOARD_NAMES)})"
    )


def _add_stats_parser(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    subparsers.add_parser("stats", help="show inventory counts")


def _add_runs_parser(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    parser = subparsers.add_parser("runs", help="show durable crawl run state")
    parser.add_argument("--board", choices=BOARD_NAMES, default="", help="filter by board")


def _add_countries_parser(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    subparsers.add_parser("countries", help="show active country counts")


def _run_refresh(args: argparse.Namespace) -> None:
    names = _board_names(args.boards)
    conn = db.connect()
    partial: list[str] = []
    try:
        for name in names:
            policy = BOARD_POLICIES[name]
            print(f"refreshing {name}...", flush=True)
            result = refresh.refresh_board(
                conn,
                mode="latest" if args.latest else "full",
                policy=policy,
                report=lambda message, board=name: print(f"{board}: {message}", flush=True),
                restart=args.restart,
            )
            _print_result(result)
            if result.status == "partial":
                partial.append(name)
    finally:
        conn.close()
    if partial:
        names = ", ".join(partial)
        msg = f"unfinished detail pages remain for: {names}; rerun to resume"
        raise SystemExit(msg)


def _run_stats() -> None:
    conn = db.connect()
    try:
        rows = db.stats_by_board(conn)
    finally:
        conn.close()
    print("by board/status")
    for row in rows:
        print(f"  {row['board']}\t{row['status']}\t{row['count']}")


def _run_runs(args: argparse.Namespace) -> None:
    conn = db.connect()
    try:
        rows = db.crawl_run_history(conn, board=args.board)
    finally:
        conn.close()
    if not rows:
        print("no crawl runs")
        return
    for row in rows:
        print(
            f"{row['id']}\t{row['board']}\t{row['mode']}\t{row['status']}\t"
            f"source_complete={'yes' if row['source_complete'] else 'no'}\t"
            f"discovered={row['discovered']}\thydrated={row['hydrated']}\t"
            f"failed={row['failed']}\tattempts={row['attempts']}\tclosed={row['closed']}"
        )
        print(
            f"  started={row['started_at']} updated={row['updated_at']} "
            f"finished={row['finished_at'] or '-'}"
        )
        if row["error_detail"]:
            print(f"  error={row['error_detail']}")
        if row["discovery_evidence_json"] != "{}":
            print(f"  evidence={row['discovery_evidence_json']}")


def _run_countries() -> None:
    conn = db.connect()
    try:
        rows = db.stats_by_country(conn)
    finally:
        conn.close()
    print("active by country")
    for row in rows:
        print(f"  {row['country']}\t{row['count']}")


def _board_names(requested: Sequence[str]) -> list[str]:
    names = list(requested) or list(BOARD_NAMES)
    unknown = [name for name in names if name not in BOARD_POLICIES]
    if unknown:
        msg = f"unknown board(s): {', '.join(unknown)} (have: {', '.join(BOARD_NAMES)})"
        raise SystemExit(msg)
    return names


def _print_result(result: refresh.ResumableRefreshResult) -> None:
    print(
        f"crawl {result.run_id} ({result.status}): discovered={result.discovered}, "
        f"hydrated={result.hydrated}, failed={result.failed}, "
        f"new={result.inserted}, updated={result.updated}, reopened={result.reopened}, "
        f"closed={result.closed}, skipped={result.skipped}",
        flush=True,
    )
    print(f"DB: {db.DB_PATH}", flush=True)


if __name__ == "__main__":
    main()
