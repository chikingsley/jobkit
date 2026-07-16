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
    fetch_full: Callable[[], list[JobPosting]]
    fetch_latest: Callable[[], list[JobPosting]]


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
    "anesl": BoardPolicy("anesl", _fetch_anesl, anesl.fetch_listings),
    "seriousteachers": BoardPolicy(
        "seriousteachers", _fetch_seriousteachers, seriousteachers.fetch_listings
    ),
    "eslcafe-modern": BoardPolicy(
        "eslcafe-modern", _fetch_eslcafe_modern, eslcafe_modern.fetch_listings
    ),
    "ajarn": BoardPolicy("ajarn", _fetch_ajarn, ajarn.fetch_listings),
    "tefl": BoardPolicy("tefl", _fetch_tefl, tefl.fetch_listings),
}

BOARD_NAMES: tuple[str, ...] = tuple(BOARD_POLICIES)
