"""Shared data model for job-board postings."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class JobPosting:
    """One job posting pulled from a board. `fields` holds board-specific label/value pairs."""

    board: str
    job_id: str
    url: str
    title: str = ""
    location: str = ""
    apply_email: str = ""
    fields: dict[str, str] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        """Return a plain dictionary representation."""
        return asdict(self)
