"""Run one course exercise through Atomscope's CP-PAW backend and keep what it produced.

Usage (from `backend/`):

    PYTHONPATH=src:../scripts/course ../.venv/bin/python -m run <exercise-id> [--work DIR]

Everything the run writes stays under `.scratch/course-runs/<id>/`, which is gitignored: these
are real calculations with real binaries, not fixtures. What ends up in `examples/` is assembled
from the results afterwards.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import time
from pathlib import Path

from ase.io import write
from atomscope.ase_bridge import to_atoms
from atomscope.backends.base import Resources
from atomscope.backends.cppaw.plugin import CppawPlugin
from atomscope.jobs import JobManager

from exercises import Exercise, by_id

ROOT = Path(__file__).resolve().parents[2]
ROOT_NAME = "case"
"""The calculation root. The application uses `case`, and `analysis_run_spec` assumes it."""


async def run(exercise: Exercise, work_root: Path, *, fresh: bool) -> dict[str, object]:
    plugin = CppawPlugin()
    found = plugin.discover_executables()
    if not found.available:
        msg = f"CP-PAW not available: {found.messages}"
        raise SystemExit(msg)

    if fresh and work_root.exists():
        shutil.rmtree(work_root)
    inp, work = work_root / "input", work_root / "work"
    inp.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)

    if exercise.continues:
        # the course carries on in the same directory: the restart file is the whole point of
        # START=F, and copying it is what "continue where you left off" means here
        previous = work_root.parent / exercise.continues / "work"
        restart = previous / f"{ROOT_NAME}.rstrt"
        if not restart.exists():
            msg = (
                f"{exercise.id} continues {exercise.continues}, which has not been run"
            )
            raise SystemExit(msg)
        shutil.copy(restart, work / f"{ROOT_NAME}.rstrt")
        for extra in (f"{ROOT_NAME}.strc", f"{ROOT_NAME}.banddata"):
            if (previous / extra).exists():
                shutil.copy(previous / extra, work / extra)

    # "case" is the root the application itself uses, and the analysis tools assume it; keeping
    # it here means the example library goes down exactly the path a person using Atomscope does
    report = plugin.validate(exercise.structure, exercise.values)
    generated = plugin.generate_inputs(exercise.structure, exercise.values, ROOT_NAME)
    (inp / "structure.json").write_text(exercise.structure.model_dump_json())
    (inp / "values.json").write_text(json.dumps(exercise.values, indent=2))
    for f in generated.files:
        (inp / f.name).write_text(f.text)
        (work / f.name).write_text(f.text)

    started = time.monotonic()
    manager = JobManager()
    record = await manager.wait(
        manager.submit(plugin.run_spec(inp, work, generated, Resources())).id
    )
    elapsed = time.monotonic() - started

    summary: dict[str, object] = {
        "id": exercise.id,
        "chapter": exercise.chapter,
        "status": record.status,
        "seconds": round(elapsed, 1),
        "issues": [f"{i.key}: {i.message}" for i in report.issues],
    }
    if record.status == "completed":
        results = plugin.parse_results(work, generated)
        summary["properties"] = {
            k: {"value": v.value, "unit": v.unit} for k, v in results.properties.items()
        }
        summary["trajectory_frames"] = (
            len(results.trajectory.frames) if results.trajectory is not None else 0
        )
        summary["grids"] = sorted(results.grids or {})
        if results.final_structure is not None:
            (work_root / "final.json").write_text(
                results.final_structure.model_dump_json()
            )
            # ...and as a file any viewer opens, which is what the example library hands out
            write(
                work_root / "final.xyz",
                to_atoms(results.final_structure),
                format="extxyz",
            )
    else:
        for name in ("driver.err", "driver.log"):
            if (work / name).exists():
                summary[name] = (work / name).read_text()[-3000:]
    for kind, options in exercise.analysis:
        summary.setdefault("analysis", {})
        spec = plugin.analysis_run_spec(work, kind, options)
        record = await manager.wait(manager.submit(spec).id)
        entry: dict[str, object] = {"status": record.status}
        if record.status == "completed":
            grids = plugin.analysis_collect(work, kind, options)
            if kind == "dos":
                spectrum = plugin.dos_result(work)
                entry["series"] = [s.label for s in spectrum.series]
                entry["points"] = len(spectrum.energies)
            elif kind == "orbitals":
                entry["grids"] = [g.name for g in grids]
                entry["files"] = sorted(f.name for f in work.glob("*.cub"))
        else:
            for name in ("dos.err", "orbitals.err", "bands.err"):
                if (work / name).exists():
                    entry[name] = (work / name).read_text()[-1500:]
        assert isinstance(summary["analysis"], dict)
        summary["analysis"][kind] = entry

    (work_root / "summary.json").write_text(json.dumps(summary, indent=2, default=str))
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("exercise")
    parser.add_argument(
        "--work", default=None, help="defaults to .scratch/course-runs/<id>"
    )
    parser.add_argument(
        "--keep", action="store_true", help="continue in an existing directory"
    )
    args = parser.parse_args()

    exercise = by_id(args.exercise)
    work_root = (
        Path(args.work)
        if args.work
        else ROOT / ".scratch" / "course-runs" / exercise.id
    )
    summary = asyncio.run(run(exercise, work_root, fresh=not args.keep))
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
