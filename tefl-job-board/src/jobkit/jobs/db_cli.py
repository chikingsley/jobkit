"""`jobs` console script for the durable SQLite job inventory."""

from __future__ import annotations

import argparse
from typing import TYPE_CHECKING

from jobkit.jobs import db, enrich
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
    _add_stats_parser(subparsers)
    _add_countries_parser(subparsers)
    args = parser.parse_args()

    if args.command == "refresh":
        _run_refresh(args)
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
        "boards", nargs="*", help=f"board names (default: all of {', '.join(BOARD_NAMES)})"
    )


def _add_stats_parser(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    subparsers.add_parser("stats", help="show inventory counts")


def _add_countries_parser(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    subparsers.add_parser("countries", help="show active country counts")


def _run_refresh(args: argparse.Namespace) -> None:
    names = _board_names(args.boards)
    conn = db.connect()
    try:
        for name in names:
            policy = BOARD_POLICIES[name]
            print(f"refreshing {name}...", flush=True)
            postings = policy.fetch_latest() if args.latest else policy.fetch_full()
            result = db.refresh_postings(
                conn,
                postings,
                boards=(name,),
                mode="latest" if args.latest else "full",
                close_missing=not args.latest,
                extractor=enrich.DEFAULT_EXTRACTOR,
            )
            _print_result("refresh", result)
    finally:
        conn.close()


def _run_stats() -> None:
    conn = db.connect()
    try:
        rows = db.stats_by_board(conn)
    finally:
        conn.close()
    print("by board/status")
    for row in rows:
        print(f"  {row['board']}\t{row['status']}\t{row['count']}")


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


def _print_result(label: str, result: db.RefreshResult) -> None:
    print(
        f"{label} run {result.run_id}: seen={result.seen}, "
        f"new={result.inserted}, updated={result.updated}, reopened={result.reopened}, "
        f"closed={result.closed}, skipped={result.skipped}",
        flush=True,
    )
    print(f"DB: {result.db_path}", flush=True)


if __name__ == "__main__":
    main()
