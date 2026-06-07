"""Export collected `JobPosting` records to JSON or CSV.

Both formats share the normalized column order defined by `enrich.SCHEMA`, so a CSV opened in a
spreadsheet and the enriched JSON line up field-for-field across every board. JSON can also emit
the raw `as_dict()` shape (board-specific `fields`) when `enriched=False`.

Run `uv run python -m jobkit.jobs.export` to see a self-contained demo on fake postings
(one structured ANESL-style, two free-text), with no network or other modules required.
"""

from __future__ import annotations

import csv
import io
import json
from pathlib import Path
from typing import TYPE_CHECKING

from jobkit.jobs.enrich import DEFAULT_EXTRACTOR, SCHEMA, enrich_all

if TYPE_CHECKING:
    from jobkit.jobs.enrich import Extractor
    from jobkit.jobs.models import JobPosting

# CSV column order is exactly the enrich schema, kept deterministic for stable diffs/imports.
CSV_COLUMNS: tuple[str, ...] = SCHEMA

# Default fan-out for enrichment. The LLM path is I/O-bound, so running several postings'
# extractions concurrently is a big win; the heuristic default is unaffected (see `enrich_all`).
DEFAULT_MAX_WORKERS = 8


def to_json(
    postings: list[JobPosting],
    *,
    enriched: bool = True,
    extractor: Extractor = DEFAULT_EXTRACTOR,
    max_workers: int = DEFAULT_MAX_WORKERS,
) -> str:
    """Serialize postings to pretty UTF-8 JSON.

    When `enriched` (default) each posting is run through `enrich_all` into the normalized
    `SCHEMA` using `extractor`, fanning out up to `max_workers` concurrent extractions; otherwise
    the raw `JobPosting.as_dict()` shape is emitted. Row order is always the input order.
    """
    if enriched:
        rows = enrich_all(postings, extractor=extractor, max_workers=max_workers)
        return json.dumps(rows, indent=2, ensure_ascii=False)
    return json.dumps([p.as_dict() for p in postings], indent=2, ensure_ascii=False)


def to_csv(
    postings: list[JobPosting],
    *,
    extractor: Extractor = DEFAULT_EXTRACTOR,
    max_workers: int = DEFAULT_MAX_WORKERS,
) -> str:
    """Serialize postings to a CSV string using the normalized `CSV_COLUMNS` order.

    Uses the stdlib `csv` writer so commas, quotes, newlines and unicode inside values are
    quoted/escaped correctly. Enrichment fans out up to `max_workers` concurrent extractions while
    preserving input row order.
    """
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=list(CSV_COLUMNS), extrasaction="ignore")
    writer.writeheader()
    writer.writerows(enrich_all(postings, extractor=extractor, max_workers=max_workers))
    return buffer.getvalue()


def write_json(
    postings: list[JobPosting],
    path: str | Path,
    *,
    enriched: bool = True,
    extractor: Extractor = DEFAULT_EXTRACTOR,
    max_workers: int = DEFAULT_MAX_WORKERS,
) -> Path:
    """Write `to_json` output to `path` (utf-8) and return the resolved path."""
    target = Path(path)
    target.write_text(
        to_json(postings, enriched=enriched, extractor=extractor, max_workers=max_workers),
        encoding="utf-8",
    )
    return target


def write_csv(
    postings: list[JobPosting],
    path: str | Path,
    *,
    extractor: Extractor = DEFAULT_EXTRACTOR,
    max_workers: int = DEFAULT_MAX_WORKERS,
) -> Path:
    """Write `to_csv` output to `path` (utf-8) and return the resolved path."""
    target = Path(path)
    target.write_text(
        to_csv(postings, extractor=extractor, max_workers=max_workers), encoding="utf-8"
    )
    return target


def _demo_postings() -> list[JobPosting]:
    """Build fake postings spanning a structured and two free-text boards for the demo."""
    from jobkit.jobs.models import JobPosting  # noqa: PLC0415 - demo-only import.

    structured = JobPosting(
        board="anesl",
        job_id="HEN7632",
        url="https://cafe.anesl.com/jobdetail.aspx?id=HEN7632",
        title="College English teachers needed at Zhengzhou, Henan Province",
        location="Zhengzhou Henan",
        apply_email="hr@anesl.com",
        fields={
            "Employer’s Type": "Public University",  # noqa: RUF001 - real ANESL U+2019 label.
            "Location": "Zhengzhou Henan",
            "Start Date": "From: Anytime At least 10 Months",
            "Degree": "Only Bachelors/ Degree or Above",
            "Salary/M": "From RMB: 15000 To RMB: 18000",
            "Update": "2026/6/1",
        },
    )
    free_text = JobPosting(
        board="eslcafe-modern",
        job_id="university-job-in-thailand-asap",
        url="https://www.eslcafe.com/postajob-detail/university-job-in-thailand-asap",
        title="University job in Thailand, ASAP",
        location="Thailand",
        apply_email="",
        fields={
            "body": (
                "We are hiring a Bachelor degree holder for a 1 year contract in Bangkok, "
                "Thailand. Salary THB 45,000 per month. Send your CV to hiring@school.ac.th "
                "or apply at https://school.ac.th/apply. Posted: Jun 01, 2026"
            ),
            "company": "Bangkok International School",
            "posted": "Jun 01, 2026",
            "board_slug": "international",
        },
    )
    semi = JobPosting(
        board="seriousteachers",
        job_id="280367",
        url="https://www.seriousteachers.com/job_details/280367/0/",
        title="Kindergarten, Public School and University Jobs",
        location="China, Beijing",
        apply_email="",
        fields={
            "Required Degrees": "Bachelor",
            "Salary": "Negotiable",
            "country": "China",
            "apply_url": "https://www.seriousteachers.com/te2/Login/280367/25174",
            "description": "Monthly salary: 20000 - 30000 RMB. 10-Month Contract. Free apartment.",
        },
    )
    return [structured, free_text, semi]


class _SlowFakeExtractor:
    """Offline stub `Extractor`: sleeps briefly, then tags the row with its input index.

    Used by the demo to prove the threaded `enrich_all` runs extractions concurrently (wall time
    well under the serial sum) while still returning rows in input order — no network or real LLM
    needed. The `title` carries the index so ordering is verifiable from the output.
    """

    def __init__(self, *, delay: float = 0.1) -> None:
        self._delay = delay

    def extract(self, posting: JobPosting) -> dict[str, str]:
        """Sleep, then return a minimal `SCHEMA` row stamped with the posting's job_id index."""
        import time  # noqa: PLC0415 - demo-only import.

        from jobkit.jobs.enrich import SCHEMA as _SCHEMA  # noqa: PLC0415 - demo-only import.

        time.sleep(self._delay)
        row = dict.fromkeys(_SCHEMA, "")
        row["job_id"] = posting.job_id
        row["title"] = posting.title
        return row


def _ordering_check() -> None:
    """Prove the threaded path preserves input order and runs concurrently (offline, no LLM)."""
    import time  # noqa: PLC0415 - demo-only import.

    from jobkit.jobs.enrich import enrich_all  # noqa: PLC0415 - demo-only import.
    from jobkit.jobs.models import JobPosting  # noqa: PLC0415 - demo-only import.

    count, delay, workers = 24, 0.1, 8
    postings = [
        JobPosting(
            board="fake",
            job_id=str(i),
            url=f"https://example.test/{i}",
            title=f"posting-{i}",
            location="",
            apply_email="",
            fields={},
        )
        for i in range(count)
    ]
    extractor = _SlowFakeExtractor(delay=delay)

    start = time.perf_counter()
    rows = enrich_all(postings, extractor=extractor, max_workers=workers)
    elapsed = time.perf_counter() - start

    order_ok = [r["job_id"] for r in rows] == [str(i) for i in range(count)]
    serial = count * delay
    print(  # noqa: T201 - demo entry point.
        f"ordering check: {count} postings, delay={delay}s, workers={workers}\n"
        f"  order preserved: {order_ok}\n"
        f"  threaded wall time: {elapsed:.2f}s (serial would be ~{serial:.2f}s)",
    )


def _main() -> None:
    """Print enriched CSV and JSON for the demo postings (offline, self-contained)."""
    postings = _demo_postings()
    print("=== CSV ===")  # noqa: T201 - demo entry point.
    print(to_csv(postings))  # noqa: T201
    print("=== JSON (enriched) ===")  # noqa: T201
    print(to_json(postings))  # noqa: T201
    print("=== ordering/concurrency check ===")  # noqa: T201
    _ordering_check()


if __name__ == "__main__":
    _main()
