"""Timing/memory helper and the case registry used by every benchmark module.

Each case is a *factory*: it does the (untimed) setup and returns the callable to time, the
number of items processed (atoms, grid points, frames) and a free-text note. ``run.py`` executes
one case per child process so that ``resource.getrusage`` -- a process-lifetime high-water mark --
reports that case's peak memory instead of the maximum over everything run before it.
"""

from __future__ import annotations

import resource
from collections.abc import Callable
from dataclasses import dataclass, field
from statistics import median
from time import perf_counter
from typing import Any

#: setup -> (timed callable, items processed per call, note)
CaseFactory = Callable[[], tuple[Callable[[], Any], int, str]]


@dataclass(frozen=True)
class Case:
    """One benchmark case."""

    name: str
    group: str
    factory: CaseFactory
    items_label: str = "atoms"
    repeats: int = 3
    quick: bool = True
    timeout_s: float = 180.0


@dataclass
class Measurement:
    """What a child process reports back for one case."""

    name: str
    group: str
    items_label: str
    wall_s: float
    wall_min_s: float
    repeats: int
    items: int
    note: str
    rss_setup_mb: float
    peak_rss_mb: float
    error: str | None = None
    timed_out: bool = False
    extra: dict[str, float] = field(default_factory=dict)

    @property
    def throughput(self) -> float | None:
        if self.items <= 0 or self.wall_s <= 0:
            return None
        return self.items / self.wall_s


_REGISTRY: dict[str, Case] = {}


def register(
    name: str,
    group: str,
    factory: CaseFactory,
    *,
    items_label: str = "atoms",
    repeats: int = 3,
    quick: bool = True,
    timeout_s: float = 180.0,
) -> None:
    """Add a case to the registry (raises on duplicate names)."""
    if name in _REGISTRY:
        msg = f"duplicate benchmark case {name!r}"
        raise ValueError(msg)
    _REGISTRY[name] = Case(
        name=name,
        group=group,
        factory=factory,
        items_label=items_label,
        repeats=repeats,
        quick=quick,
        timeout_s=timeout_s,
    )


def registry() -> dict[str, Case]:
    """All registered cases, in registration order."""
    return dict(_REGISTRY)


def peak_rss_mb() -> float:
    """Process high-water RSS in MB (``ru_maxrss`` is KiB on Linux)."""
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0


def run_case(case: Case) -> Measurement:
    """Run one case in this process and return its measurement."""
    rss_before = peak_rss_mb()
    try:
        fn, items, note = case.factory()
    except (Exception, MemoryError) as exc:  # noqa: BLE001 - a broken fixture is a result
        return Measurement(
            name=case.name,
            group=case.group,
            items_label=case.items_label,
            wall_s=float("nan"),
            wall_min_s=float("nan"),
            repeats=0,
            items=0,
            note="",
            rss_setup_mb=rss_before,
            peak_rss_mb=peak_rss_mb(),
            error=f"{type(exc).__name__}: {exc}",
        )
    rss_setup = peak_rss_mb()
    times: list[float] = []
    try:
        for _ in range(case.repeats):
            start = perf_counter()
            fn()
            times.append(perf_counter() - start)
    except (Exception, MemoryError) as exc:  # a case that blows up is a result, not a crash
        return Measurement(
            name=case.name,
            group=case.group,
            items_label=case.items_label,
            wall_s=float("nan"),
            wall_min_s=float("nan"),
            repeats=len(times),
            items=0,
            note="",
            rss_setup_mb=rss_setup,
            peak_rss_mb=peak_rss_mb(),
            error=f"{type(exc).__name__}: {exc}",
        )
    return Measurement(
        name=case.name,
        group=case.group,
        items_label=case.items_label,
        wall_s=median(times),
        wall_min_s=min(times),
        repeats=case.repeats,
        items=items,
        note=note,
        rss_setup_mb=rss_setup,
        peak_rss_mb=peak_rss_mb(),
    )


__all__ = [
    "Case",
    "CaseFactory",
    "Measurement",
    "peak_rss_mb",
    "register",
    "registry",
    "run_case",
]
