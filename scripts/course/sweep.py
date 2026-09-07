"""Run one of the course's convergence sweeps through a real Atomscope project.

Usage (from `backend/`):

    PYTHONPATH=src:../scripts/course ../.venv/bin/python -m sweep water-cell-size

This goes the whole way through `CalculationService`, so what it leaves behind is a project the
application can open -- which is what the example library is meant to be. The project lands in
`.scratch/course-runs/<id>/project`.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from ase.units import Hartree
from atomscope.backends.registry import default_registry
from atomscope.calculations import CalculationService
from atomscope.calculations.sweeps import create_sweep, members, run_sweep
from atomscope.jobs import JobManager
from atomscope.project import ProjectStore

from exercises import SweepExercise, sweep_by_id

ROOT = Path(__file__).resolve().parents[2]


async def run(
    exercise: SweepExercise, root: Path, *, fresh: bool, recollect: bool = False
) -> dict[str, object]:
    if fresh and root.exists():
        import shutil

        shutil.rmtree(root)
    project = (
        ProjectStore.open(root)
        if (root / "project.json").exists()
        else ProjectStore.create(root, exercise.id)
    )
    service = CalculationService(project, default_registry(), JobManager())

    project.save_structure(exercise.structure)
    for point in exercise.spec.points:
        if point.structure is not None:
            project.save_structure(point.structure)

    existing = [c for c in service.list() if c.sweep is not None]
    if existing:
        sweep_id = existing[0].sweep.sweep_id  # type: ignore[union-attr]
    else:
        made = create_sweep(service, exercise.spec, exercise.structure)
        sweep_id = made[0].sweep.sweep_id  # type: ignore[union-attr]

    if recollect:
        # re-read the work directories with the parser as it is now: a completed run's results
        # are only as complete as the parser was on the day it finished
        for calc in members(service, sweep_id):
            if calc.status == "completed":
                service.collect_results(calc.id)

    result = await run_sweep(service, sweep_id)
    rows = [
        {
            "x": p.x,
            "status": p.status,
            "energy_ev": p.energy_ev,
            "energy_hartree": None
            if p.energy_ev is None
            else round(p.energy_ev / Hartree, 6),
            # the two counts the tutorial's convergence tables ask for beside every energy
            "plane_waves_wavefunction": p.properties.get("plane_waves_wavefunction"),
            "plane_waves_density": p.properties.get("plane_waves_density"),
        }
        for p in result.points
    ]
    summary: dict[str, object] = {
        "id": exercise.id,
        "chapter": exercise.chapter,
        "axis": f"{result.label} ({result.unit})" if result.unit else result.label,
        "converged_from_mh": result.converged_from(),
        "points": rows,
        "project": str(root),
    }
    (root / "sweep.json").write_text(json.dumps(summary, indent=2))
    service.close()
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("exercise")
    parser.add_argument(
        "--keep", action="store_true", help="continue an existing project"
    )
    parser.add_argument(
        "--recollect",
        action="store_true",
        help="re-read finished runs with the parser as it is now",
    )
    args = parser.parse_args()
    exercise = sweep_by_id(args.exercise)
    root = ROOT / ".scratch" / "course-runs" / exercise.id / "project"
    summary = asyncio.run(
        run(exercise, root, fresh=not args.keep, recollect=args.recollect)
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
