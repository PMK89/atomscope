"""Run one of the course's convergence sweeps in the shared course project.

Usage (from `backend/`):

    PYTHONPATH=src:../scripts/course ../.venv/bin/python -m sweep iron-cutoff

The sweep lives in the same project as the single-run exercises
(`.scratch/course-runs/course/`), because that is where the reference calculation it continues
from lives. `--recollect` re-reads finished points with the parser as it is now.
"""

from __future__ import annotations

import argparse
import asyncio
import json

from ase.units import Hartree
from atomscope.calculations import CalculationService
from atomscope.calculations.sweeps import create_sweep, members, run_sweep

from exercises import SweepExercise, sweep_by_id
from run import find, open_project


async def run(
    exercise: SweepExercise, service: CalculationService, *, recollect: bool
) -> dict[str, object]:
    spec = exercise.spec
    if exercise.continues:
        reference = find(service, exercise.continues)
        if reference is None or reference.status != "completed":
            msg = (
                f"{exercise.id} continues {exercise.continues}, which has not completed"
            )
            raise SystemExit(msg)
        spec = spec.model_copy(update={"restart_from": reference.id})

    existing = [
        c for c in service.list() if c.sweep is not None and c.sweep.label == spec.label
    ]
    if existing:
        sweep_id = existing[0].sweep.sweep_id  # type: ignore[union-attr]
    else:
        service.project.save_structure(exercise.structure)
        for point in spec.points:
            if point.structure is not None:
                service.project.save_structure(point.structure)
        sweep_id = create_sweep(service, spec, exercise.structure)[0].sweep.sweep_id  # type: ignore[union-attr]

    if recollect:
        # a finished run's results are only as complete as the parser was on the day it finished
        for calc in members(service, sweep_id):
            if calc.status == "completed":
                service.collect_results(calc.id)

    result = await run_sweep(service, sweep_id)
    rows = [
        {
            "x": p.x,
            "status": p.status,
            "energy_hartree": None
            if p.energy_ev is None
            else round(p.energy_ev / Hartree, 6),
            # the two counts the tutorial's convergence tables ask for beside every energy
            "plane_waves_wavefunction": p.properties.get("plane_waves_wavefunction"),
            "plane_waves_density": p.properties.get("plane_waves_density"),
        }
        for p in result.points
    ]
    return {
        "id": exercise.id,
        "chapter": exercise.chapter,
        "axis": f"{result.label} ({result.unit})" if result.unit else result.label,
        "converged_from_mh": result.converged_from(),
        "points": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("exercise")
    parser.add_argument(
        "--recollect",
        action="store_true",
        help="re-read finished points with the current parser",
    )
    args = parser.parse_args()
    service = open_project()
    try:
        summary = asyncio.run(
            run(sweep_by_id(args.exercise), service, recollect=args.recollect)
        )
    finally:
        service.close()
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
