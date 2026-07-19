"""Registered job-board refresh policies."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from jobkit.jobs.boards import ajarn, anesl, eslcafe_modern, seriousteachers, tefl

if TYPE_CHECKING:
    from collections.abc import Callable
    from contextlib import AbstractContextManager

    from jobkit.jobs.models import DiscoveredJob, DiscoveryResult, JobPosting

    Hydrator = Callable[[DiscoveredJob], JobPosting]
    HydrationSession = Callable[[], AbstractContextManager[Hydrator]]


@dataclass(frozen=True)
class BoardPolicy:
    """How a board should be refreshed for the durable inventory."""

    name: str
    discover_full: Callable[[], DiscoveryResult]
    discover_latest: Callable[[], DiscoveryResult]
    hydrate: Hydrator
    hydrate_delay_seconds: float = 1.0
    hydrate_workers: int = 1
    hydration_session: HydrationSession | None = None


BOARD_POLICIES: dict[str, BoardPolicy] = {
    "anesl": BoardPolicy(
        "anesl",
        anesl.discover_full,
        anesl.discover_latest,
        anesl.hydrate,
        hydrate_delay_seconds=0,
        hydrate_workers=anesl.DETAIL_WORKERS,
    ),
    "seriousteachers": BoardPolicy(
        "seriousteachers",
        seriousteachers.discover_full,
        seriousteachers.discover_latest,
        seriousteachers.hydrate,
        hydration_session=seriousteachers.hydration_session,
    ),
    "eslcafe-modern": BoardPolicy(
        "eslcafe-modern",
        eslcafe_modern.discover_full,
        eslcafe_modern.discover_latest,
        eslcafe_modern.hydrate,
    ),
    "ajarn": BoardPolicy(
        "ajarn",
        ajarn.discover_full,
        ajarn.discover_latest,
        ajarn.hydrate,
    ),
    "tefl": BoardPolicy(
        "tefl",
        tefl.discover_full,
        tefl.discover_latest,
        tefl.hydrate,
    ),
}

BOARD_NAMES: tuple[str, ...] = tuple(BOARD_POLICIES)
