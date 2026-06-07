"""Per-board "seen job_id" store, used to surface only postings new since the last run.

State lives as JSON under ``~/github/jobkit/.cache/boards/<board>-seen.json`` (gitignored).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Iterable

    from jobkit.jobs.models import JobPosting

CACHE_DIR = Path.home() / "github" / "jobkit" / ".cache" / "boards"


def _seen_path(board: str) -> Path:
    return CACHE_DIR / f"{board}-seen.json"


def load_seen(board: str) -> set[str]:
    """Return the set of previously-seen ``job_id``s for ``board`` (empty if none stored)."""
    path = _seen_path(board)
    if not path.exists():
        return set()
    data = json.loads(path.read_text(encoding="utf-8"))
    return set(data.get("seen", []))


def save_seen(board: str, seen: Iterable[str]) -> None:
    """Persist ``seen`` job ids for ``board``, creating the cache directory if needed."""
    path = _seen_path(board)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"seen": sorted(set(seen))}
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def filter_new(board: str, postings: Iterable[JobPosting]) -> list[JobPosting]:
    """Return only postings whose ``job_id`` was not seen before, then update the store.

    The first ever run reports every posting as new and seeds the store.
    """
    postings = list(postings)
    seen = load_seen(board)
    fresh = [p for p in postings if p.job_id not in seen]
    save_seen(board, seen | {p.job_id for p in postings})
    return fresh
