"""Run one course exercise through a real Atomscope project and keep what it produced.

Usage (from `backend/`):

    PYTHONPATH=src:../scripts/course ../.venv/bin/python -m run water-wavefunction

Everything goes through `CalculationService`, the same path the application drives, so what is
left behind is a project the application can open -- which is what the example library is meant to
be. The whole course chain lives in one project under `.scratch/course-runs/course/`, because that
is how the exercises relate to each other: ch. 2.8 continues ch. 2.7 from its restart file, and
that is a fork.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from ase.io import write
from atomscope.ase_bridge import to_atoms
from atomscope.backends.registry import default_registry
from atomscope.calculations import Calculation, CalculationService
from atomscope.jobs import JobManager
from atomscope.project import ProjectStore

from exercises import Exercise, by_id

ROOT = Path(__file__).resolve().parents[2]
PROJECT = ROOT / ".scratch" / "course-runs" / "course"


def open_project(root: Path = PROJECT) -> CalculationService:
    project = (
        ProjectStore.open(root)
        if (root / "project.json").exists()
        else ProjectStore.create(root, "CP-PAW hands-on course")
    )
    registry = default_registry()
    # The installed paw tools need an older libgfortran than the system one, and the path to it is
    # only discovered by the health check -- which the API server runs at startup and a script
    # otherwise never does. Without it every tool dies on a format error (see cppaw/settings.py).
    registry.get("cppaw").health_check()
    return CalculationService(project, registry, JobManager())


def find(service: CalculationService, exercise_id: str) -> Calculation | None:
    """The calculation standing for an exercise, by the name it was created under."""
    return next((c for c in service.list() if c.name == exercise_id), None)


async def _finish(service: CalculationService, calc: Calculation) -> Calculation:
    started = service.run(calc.id)
    if started.job is not None:
        await service.jobs.wait(started.job.id)
    calc = service.get(calc.id)
    if calc.status == "completed":
        service.collect_results(calc.id)
    return service.get(calc.id)


async def run(
    exercise: Exercise, service: CalculationService, *, rerun: bool
) -> dict[str, object]:
    existing = find(service, exercise.id)
    if existing is not None and not rerun:
        calc = existing
    elif exercise.continues:
        parent = find(service, exercise.continues)
        if parent is None or parent.status != "completed":
            msg = (
                f"{exercise.id} continues {exercise.continues}, which has not completed"
            )
            raise SystemExit(msg)
        # the course's own idiom: carry on from the restart file with different settings, which
        # is what a fork is. `restart_values` is what turns START=T into START=F.
        calc = service.fork(
            parent.id, exercise.values, name=exercise.id, restart_from_parent=True
        )
    else:
        service.project.save_structure(exercise.structure)
        calc = service.create(
            name=exercise.id,
            backend_id="cppaw",
            structure=exercise.structure,
            values=exercise.values,
        )

    report = service.validate(calc.id)
    if calc.status in ("draft", "ready"):
        calc = await _finish(service, calc)

    summary: dict[str, object] = {
        "id": exercise.id,
        "chapter": exercise.chapter,
        "calculation": calc.id,
        "status": calc.status,
        "issues": [f"{i.key}: {i.message}" for i in report.issues],
    }
    if calc.results is not None:
        summary["properties"] = {
            k: {"value": q.value, "unit": q.unit}
            for k, q in calc.results.properties.items()
        }
        summary["grids"] = [g.name for g in calc.results.grids]
        summary["warnings"] = list(calc.results.warnings)
        if calc.result_structure_id is not None:
            final = service.project.load_structure(calc.result_structure_id)
            out = service.project.calculation_dir(calc.id) / "results" / "final.xyz"
            write(out, to_atoms(final), format="extxyz")
            summary["final_xyz"] = str(out)

    for kind, options in exercise.analysis:
        if calc.status != "completed":
            break
        already = [
            a
            for a in calc.analysis_jobs
            if a.kind == kind and a.job.status == "completed"
        ]
        if already and not rerun:
            summary.setdefault("analysis", {})[kind] = "already done"  # type: ignore[index]
            continue
        service.run_analysis(calc.id, kind, options)
        job = service.get(calc.id).analysis_jobs[-1].job
        await service.jobs.wait(job.id)
        calc = service.get(calc.id)
        done = calc.analysis_jobs[-1]
        summary.setdefault("analysis", {})[kind] = done.job.status  # type: ignore[index]

    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("exercise")
    parser.add_argument(
        "--rerun", action="store_true", help="fork and run again even if it ran"
    )
    args = parser.parse_args()

    service = open_project()
    try:
        summary = asyncio.run(run(by_id(args.exercise), service, rerun=args.rerun))
    finally:
        service.close()
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
