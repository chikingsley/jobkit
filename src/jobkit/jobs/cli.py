"""`fetch-jobs` console script — pull listings from job-board adapters.

uv run fetch-jobs                       # all boards, newest listings, digest
uv run fetch-jobs anesl --limit 10      # one board
uv run fetch-jobs anesl --new-only      # only postings new since the last run
uv run fetch-jobs anesl --all-pages --max-pages 50   # deep crawl (slow; polite sleeps)
uv run fetch-jobs --json                # structured JSON instead of a digest
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import TYPE_CHECKING

from jobkit.jobs import enrich, export, state
from jobkit.jobs.boards import ajarn, anesl, eslcafe_modern, seriousteachers, tefl

if TYPE_CHECKING:
    from collections.abc import Callable

    from jobkit.jobs.models import JobPosting

    Fetcher = Callable[..., list[JobPosting]]

# name -> (fetch_listings, fetch_all|None). fetch_all accepts max_pages= and limit= keywords.
BOARDS: dict[str, tuple[Fetcher, Fetcher | None]] = {
    "anesl": (anesl.fetch_listings, anesl.fetch_all),
    "seriousteachers": (seriousteachers.fetch_listings, seriousteachers.fetch_all),
    "eslcafe-modern": (eslcafe_modern.fetch_listings, eslcafe_modern.fetch_all),
    "ajarn": (ajarn.fetch_listings, ajarn.fetch_all),
    "tefl": (tefl.fetch_listings, tefl.fetch_all),
}

# Field labels worth surfacing in the digest if present (across boards). The ANESL labels use a
# U+2019 apostrophe verbatim. Long values (body/description) are truncated.
DIGEST_FIELDS = (
    "Salary/M",
    "Salary",
    "Start Date",
    "Degree",
    "Required Degrees",
    "Employer’s Type",  # noqa: RUF001
    "country",
    "poster",
    "posted",
)
VALUE_MAX = 140


def _print_digest(postings: list[JobPosting]) -> None:
    for job in postings:
        print(f"\n[{job.board}] {job.title}")
        print(f"  {job.url}")
        if job.location:
            print(f"  location: {job.location}")
        for key in DIGEST_FIELDS:
            value = job.fields.get(key)
            if value:
                print(f"  {key}: {value[:VALUE_MAX]}")
        if job.apply_email:
            print(f"  apply: {job.apply_email}")
        elif job.fields.get("apply_url"):
            print(f"  apply: {job.fields['apply_url']}")
    print(f"\n{len(postings)} posting(s)")


def _render_output(postings: list[JobPosting], args: argparse.Namespace) -> str | None:
    """Build the CSV/JSON output string, or None for digest mode.

    Enriched output (always for CSV; for JSON only with --enriched) parses free text with Claude
    unless --no-llm asks for the offline heuristics. Any LLM client is closed before returning.
    """
    enriching = args.csv or (args.json and args.enriched)
    extractor = enrich.LLMExtractor() if enriching and not args.no_llm else enrich.DEFAULT_EXTRACTOR
    try:
        if args.csv:
            return export.to_csv(postings, extractor=extractor)
        if args.json:
            return export.to_json(postings, enriched=args.enriched, extractor=extractor)
        return None
    finally:
        if isinstance(extractor, enrich.LLMExtractor):
            extractor.close()


def main() -> None:
    """Run the fetch-jobs command-line interface."""
    parser = argparse.ArgumentParser(prog="fetch-jobs", description="Fetch job-board listings.")
    parser.add_argument(
        "boards", nargs="*", help=f"board names (default: all of {', '.join(BOARDS)})"
    )
    parser.add_argument(
        "--limit", type=int, help="max postings per board (default 15 in listings mode)"
    )
    parser.add_argument(
        "--all-pages",
        action="store_true",
        help="deep-crawl all pages instead of just the newest listings (slow)",
    )
    parser.add_argument("--max-pages", type=int, default=5, help="page cap for --all-pages")
    parser.add_argument(
        "--new-only", action="store_true", help="show only postings new since the last run"
    )
    parser.add_argument("--json", action="store_true", help="emit JSON instead of a digest")
    parser.add_argument(
        "--csv", action="store_true", help="emit normalized CSV (one row per posting)"
    )
    parser.add_argument(
        "--enriched",
        action="store_true",
        help="with --json, emit the normalized schema instead of raw board fields",
    )
    parser.add_argument(
        "-o", "--out", help="write the chosen output to this file instead of stdout"
    )
    parser.add_argument(
        "--no-llm",
        action="store_true",
        help="use offline regex heuristics instead of Claude for enriched output",
    )
    args = parser.parse_args()

    names = args.boards or list(BOARDS)
    unknown = [n for n in names if n not in BOARDS]
    if unknown:
        parser.error(f"unknown board(s): {', '.join(unknown)} (have: {', '.join(BOARDS)})")

    postings: list[JobPosting] = []
    for name in names:
        listings_fn, crawl_fn = BOARDS[name]
        if args.all_pages:
            if crawl_fn is None:
                parser.error(f"board {name!r} has no deep-crawl mode")
            items = crawl_fn(max_pages=args.max_pages, limit=args.limit)
        else:
            items = listings_fn(limit=args.limit or 15)
        if args.new_only:
            items = state.filter_new(name, items)
        postings.extend(items)

    output = _render_output(postings, args)
    if output is None:
        _print_digest(postings)
    elif args.out:
        Path(args.out).write_text(output, encoding="utf-8")
        print(f"wrote {len(postings)} posting(s) to {args.out}")
    else:
        print(output)


if __name__ == "__main__":
    main()
