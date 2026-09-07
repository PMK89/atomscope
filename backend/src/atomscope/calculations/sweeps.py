"""Sweeps: several calculations that differ in one way, read back as one curve.

The tutorial's chapter 8 is entirely this shape -- plane-wave cutoff, dual cutoff, number of
k-points, cell size -- and so are two of chapter 6's exercises, the k-point convergence of
silicon and its energy-against-volume curve. What they have in common is not a parameter but a
picture: N runs, one number on the x axis, the total energy on the y axis.

Two kinds of thing vary, and both have to work:

* **a schema value** -- ``epwpsi``, ``cdual``, ``kpoint_r``. The structure is the same every time.
* **the structure** -- a cell-size sweep moves the lattice vectors, a volume sweep scales them.
  No schema value can express that, so a point may carry a structure of its own.

Membership lives on each calculation (:class:`SweepMembership`), so a sweep is a view over the
project rather than a second thing to keep in step with it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import Field

from atomscope.calculations.models import Calculation, CalculationStatus, SweepMembership
from atomscope.model import Structure, new_uid
from atomscope.model.common import StrictModel

if TYPE_CHECKING:
    from atomscope.calculations.service import CalculationService

MILLIHARTREE = 0.0272113838
"""One millihartree in eV: the precision a total energy is quoted to."""


class SweepPointSpec(StrictModel):
    """One point: where it sits on the axis, and what makes it different."""

    x: float
    values: dict[str, object] = Field(
        default_factory=dict, description="overrides on top of the sweep's base values"
    )
    structure: Structure | None = Field(
        default=None, description="a structure of its own; None uses the sweep's"
    )


class SweepSpec(StrictModel):
    """What to build. ``key`` names the schema value being varied, when one is."""

    name: str
    backend_id: str
    label: str
    unit: str | None = None
    key: str | None = None
    base_values: dict[str, object] = Field(default_factory=dict)
    restart_from: str | None = Field(
        default=None,
        description="a completed calculation every point continues from, carrying its restart"
        " file; without it each point starts from scratch",
    )
    points: list[SweepPointSpec] = Field(min_length=2)


class SweepPoint(StrictModel):
    x: float
    calculation_id: str
    status: CalculationStatus
    energy_ev: float | None = None
    properties: dict[str, float] = Field(
        default_factory=dict,
        description="every scalar the run reported, so a sweep can be read against any of them",
    )


class SweepResult(StrictModel):
    """A sweep as a curve: ready for a line chart, in the order the x axis wants."""

    sweep_id: str
    label: str
    unit: str | None
    key: str | None
    points: list[SweepPoint]

    def converged_from(self, tolerance_ev: float = MILLIHARTREE) -> float | None:
        """The smallest ``x`` from which every later energy is within ``tolerance_ev`` of the last.

        This is the question a convergence test asks -- "where can I stop?" -- which the tutorial
        answers by eye off the plot. None when fewer than two points have energies, or when the
        curve never settles that far.

        The default tolerance is one millihartree, because that is the precision the answer is
        quoted to and, more to the point, about what a wave-function optimization left at its
        default stopping rule actually delivers: asking for less than the runs are converged to
        measures the noise floor rather than the physics.
        """
        known = [(p.x, p.energy_ev) for p in self.points if p.energy_ev is not None]
        if len(known) < 2:
            return None
        last = known[-1][1]
        assert last is not None  # noqa: S101
        for i, (x, _) in enumerate(known):
            if all(abs(e - last) <= tolerance_ev for _, e in known[i:] if e is not None):
                return x
        return None


def create_sweep(
    service: CalculationService, spec: SweepSpec, structure: Structure
) -> list[Calculation]:
    """One calculation per point, each carrying its membership. Nothing is run yet.

    With ``restart_from`` each point is a fork of that calculation and continues from its restart
    file, which is what the tutorial's ch. 8.2 prescribes: converge once, then vary the parameter
    from there. It matters for more than speed -- every point starts from the same electronic
    state, so the curve shows the parameter rather than eight independent convergences.
    """
    sweep_id = new_uid()
    made: list[Calculation] = []
    for index, point in enumerate(spec.points):
        name = f"{spec.name} — {spec.label} {point.x:g}"
        values = {**spec.base_values, **point.values}
        if spec.restart_from is not None:
            calc = service.fork(
                spec.restart_from,
                values,
                name=name,
                restart_from_parent=True,
                structure=point.structure,
            )
        else:
            calc = service.create(
                name=name,
                backend_id=spec.backend_id,
                structure=point.structure or structure,
                values=values,
            )
        calc.sweep = SweepMembership(
            sweep_id=sweep_id,
            label=spec.label,
            unit=spec.unit,
            key=spec.key,
            x=point.x,
            index=index,
        )
        service.save(calc)
        made.append(calc)
    return made


def members(service: CalculationService, sweep_id: str) -> list[Calculation]:
    """The sweep's calculations, in x order."""
    found = [c for c in service.list() if c.sweep is not None and c.sweep.sweep_id == sweep_id]
    return sorted(found, key=lambda c: (c.sweep.x, c.sweep.index))  # type: ignore[union-attr]


def sweep_result(service: CalculationService, sweep_id: str) -> SweepResult:
    """Read the curve back. Points that have not finished are kept, without an energy, so the
    plot shows the gap rather than closing over it."""
    found = members(service, sweep_id)
    if not found:
        msg = f"no calculations belong to sweep {sweep_id!r}"
        raise KeyError(msg)
    first = found[0].sweep
    assert first is not None  # noqa: S101
    points = []
    for calc in found:
        assert calc.sweep is not None  # noqa: S101
        scalars = (
            {k: float(q.value) for k, q in calc.results.properties.items()}
            if calc.results is not None
            else {}
        )
        points.append(
            SweepPoint(
                x=calc.sweep.x,
                calculation_id=calc.id,
                status=calc.status,
                energy_ev=scalars.get("energy"),
                properties=scalars,
            )
        )
    return SweepResult(
        sweep_id=sweep_id,
        label=first.label,
        unit=first.unit,
        key=first.key,
        points=points,
    )


async def run_sweep(service: CalculationService, sweep_id: str) -> SweepResult:
    """Run every point that has not run, one after another.

    Sequentially and deliberately: these are real DFT runs, and on one workstation two at once
    take longer than two in a row while making everything else on the machine slower. (There is
    a record of what load does to the test suite in `docs/STATE.md`.)
    """
    for calc in members(service, sweep_id):
        if calc.status in ("completed", "failed", "cancelled"):
            continue
        started = service.run(calc.id)
        if started.job is not None:
            await service.jobs.wait(started.job.id)
        if service.get(calc.id).status == "completed":
            service.collect_results(calc.id)
    return sweep_result(service, sweep_id)


__all__ = [
    "SweepPoint",
    "SweepPointSpec",
    "SweepResult",
    "SweepSpec",
    "create_sweep",
    "members",
    "run_sweep",
    "sweep_result",
]
