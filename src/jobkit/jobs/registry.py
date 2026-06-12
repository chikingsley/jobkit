"""Registered job-board refresh policies."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from jobkit.jobs.boards import ajarn, anesl, eslcafe_modern, seriousteachers, tefl

if TYPE_CHECKING:
    from collections.abc import Callable

    from jobkit.jobs.models import JobPosting


@dataclass(frozen=True)
class BoardPolicy:
    """How a board should be refreshed for the durable inventory."""

    name: str
    fetch: Callable[[], list[JobPosting]]
    complete: bool


def _fetch_anesl() -> list[JobPosting]:
    return anesl.fetch_all()


def _fetch_ajarn() -> list[JobPosting]:
    return ajarn.fetch_all()


def _fetch_eslcafe_modern() -> list[JobPosting]:
    return eslcafe_modern.fetch_all(max_pages=10)


def _fetch_tefl() -> list[JobPosting]:
    return tefl.fetch_all(max_pages=30)


def _fetch_seriousteachers() -> list[JobPosting]:
    # Full coverage is the country x subject crawl: ~500 list pages plus detail pages.
    return seriousteachers.fetch_all(max_pages=520)


BOARD_POLICIES: dict[str, BoardPolicy] = {
    "anesl": BoardPolicy("anesl", _fetch_anesl, complete=True),
    "seriousteachers": BoardPolicy("seriousteachers", _fetch_seriousteachers, complete=True),
    "eslcafe-modern": BoardPolicy("eslcafe-modern", _fetch_eslcafe_modern, complete=True),
    "ajarn": BoardPolicy("ajarn", _fetch_ajarn, complete=True),
    "tefl": BoardPolicy("tefl", _fetch_tefl, complete=True),
}

BOARD_NAMES: tuple[str, ...] = tuple(BOARD_POLICIES)
