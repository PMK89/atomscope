"""Sweeps: several calculations that differ in one way, read back as one curve."""

import json
from pathlib import Path

import pytest
from ase.build import bulk

from atomscope.ase_bridge import from_atoms
from atomscope.backends.registry import default_registry
from atomscope.calculations import CalculationService
from atomscope.calculations.service import CalculationError
from atomscope.calculations.sweeps import (
    SweepPoint,
    SweepPointSpec,
    SweepResult,
    SweepSpec,
    create_sweep,
    members,
    run_sweep,
    sweep_result,
)
from atomscope.jobs import JobManager
from atomscope.project import ProjectStore


def _service(tmp_path: Path) -> tuple[CalculationService, JobManager]:
    project = ProjectStore.create(tmp_path / "p", "sweeps")
    jm = JobManager()
    return CalculationService(project, default_registry(), jm), jm


async def test_a_value_sweep_runs_and_comes_back_as_a_curve(tmp_path: Path) -> None:
    svc, _ = _service(tmp_path)
    copper = from_atoms(bulk("Cu", cubic=True), name="cu")
    svc.project.save_structure(copper)

    spec = SweepSpec(
        name="steps",
        backend_id="ase_builtin",
        label="Relaxation steps",
        key="max_steps",
        base_values={"task": "relax"},
        points=[SweepPointSpec(x=n, values={"max_steps": int(n)}) for n in (1, 2, 3)],
    )
    made = create_sweep(svc, spec, copper)
    assert [c.sweep.x for c in made if c.sweep] == [1.0, 2.0, 3.0]
    assert [c.values["max_steps"] for c in made] == [1, 2, 3]
    # the name says which point it is, which is what a list of calculations has to show
    assert made[2].name.endswith("3")

    result = await run_sweep(svc, made[0].sweep.sweep_id)  # type: ignore[union-attr]
    assert result.label == "Relaxation steps" and result.key == "max_steps"
    assert [p.x for p in result.points] == [1.0, 2.0, 3.0]
    assert all(p.status == "completed" for p in result.points)
    assert all(p.energy_ev is not None for p in result.points)
    # relaxing further cannot raise the energy
    energies = [p.energy_ev for p in result.points]
    assert energies == sorted(energies, reverse=True) or energies[0] >= energies[-1]


async def test_the_structure_can_be_what_varies(tmp_path: Path) -> None:
    """A cell-size or volume sweep moves the lattice, which no schema value can express."""
    svc, _ = _service(tmp_path)
    base = from_atoms(bulk("Cu", cubic=True), name="cu")
    svc.project.save_structure(base)

    points = []
    for scale in (0.98, 1.0, 1.02):
        atoms = bulk("Cu", cubic=True)
        atoms.set_cell(atoms.cell * scale, scale_atoms=True)
        s = from_atoms(atoms, name=f"cu x{scale}")
        svc.project.save_structure(s)
        points.append(SweepPointSpec(x=atoms.get_volume(), structure=s))

    spec = SweepSpec(
        name="E(V)",
        backend_id="ase_builtin",
        label="Volume",
        unit="angstrom^3",
        base_values={"task": "single_point"},
        points=points,
    )
    made = create_sweep(svc, spec, base)
    sweep_id = made[0].sweep.sweep_id  # type: ignore[union-attr]
    # no schema key is varied: the structures are
    assert all(c.sweep is not None and c.sweep.key is None for c in made)
    assert len({c.structure_id for c in made}) == 3

    result = await run_sweep(svc, sweep_id)
    assert result.key is None and result.unit == "angstrom^3"
    assert [round(p.x, 3) for p in result.points] == sorted(round(p.x, 3) for p in result.points)
    energies = [p.energy_ev for p in result.points]
    assert all(e is not None for e in energies)
    # EMT copper is near its equilibrium volume, so the middle point is the lowest of the three
    assert energies[1] == pytest.approx(min(e for e in energies if e is not None))


async def test_an_unfinished_point_leaves_a_gap_rather_than_disappearing(tmp_path: Path) -> None:
    svc, _ = _service(tmp_path)
    copper = from_atoms(bulk("Cu", cubic=True), name="cu")
    spec = SweepSpec(
        name="steps",
        backend_id="ase_builtin",
        label="Relaxation steps",
        key="max_steps",
        base_values={"task": "relax"},
        points=[SweepPointSpec(x=n, values={"max_steps": int(n)}) for n in (1, 2)],
    )
    made = create_sweep(svc, spec, copper)
    result = sweep_result(svc, made[0].sweep.sweep_id)  # type: ignore[union-attr]
    assert [p.status for p in result.points] == ["draft", "draft"]
    assert [p.energy_ev for p in result.points] == [None, None]
    assert result.converged_from() is None

    with pytest.raises(KeyError):
        sweep_result(svc, "nothing-by-that-name")


async def test_running_a_sweep_twice_does_not_run_it_twice(tmp_path: Path) -> None:
    svc, _ = _service(tmp_path)
    copper = from_atoms(bulk("Cu", cubic=True), name="cu")
    spec = SweepSpec(
        name="steps",
        backend_id="ase_builtin",
        label="Relaxation steps",
        key="max_steps",
        base_values={"task": "relax"},
        points=[SweepPointSpec(x=n, values={"max_steps": int(n)}) for n in (1, 2)],
    )
    made = create_sweep(svc, spec, copper)
    sweep_id = made[0].sweep.sweep_id  # type: ignore[union-attr]
    first = await run_sweep(svc, sweep_id)
    jobs = [svc.get(p.calculation_id).job for p in first.points]
    again = await run_sweep(svc, sweep_id)
    # a completed calculation is immutable: the same jobs, not new ones
    assert [svc.get(p.calculation_id).job for p in again.points] == jobs


def test_converged_from_finds_where_the_curve_settles() -> None:
    def curve(*energies: float) -> SweepResult:
        return SweepResult(
            sweep_id="s",
            label="Cutoff",
            unit="rydberg",
            key="epwpsi",
            points=[
                SweepPoint(x=float(i), calculation_id=f"c{i}", status="completed", energy_ev=e)
                for i, e in enumerate(energies)
            ],
        )

    # settles from the third point: the last three are within a millihartree of the end
    assert curve(-10.0, -10.05, -10.1000, -10.1005, -10.1002).converged_from() == 2.0
    # a tighter tolerance than the points are converged to pushes the answer to the end
    assert curve(-10.0, -10.05, -10.1000, -10.1005, -10.1002).converged_from(1e-4) == 4.0
    # never settles
    assert curve(-10.0, -10.1, -10.2, -10.3).converged_from() == 3.0
    assert curve(-10.0).converged_from() is None


def test_a_project_written_before_sweeps_existed_still_loads(tmp_path: Path) -> None:
    """`sweep` is a new optional field; older projects have no such key."""
    svc, _ = _service(tmp_path)
    copper = from_atoms(bulk("Cu", cubic=True), name="cu")
    calc = svc.create(
        name="cu", backend_id="ase_builtin", structure=copper, values={"task": "single_point"}
    )
    path = svc.project.calculation_dir(calc.id) / "calculation.json"
    stored = json.loads(path.read_text())
    del stored["sweep"]
    path.write_text(json.dumps(stored))

    reopened = CalculationService(
        ProjectStore.open(svc.project.root), default_registry(), JobManager()
    )
    assert reopened.get(calc.id).sweep is None
    assert members(reopened, "anything") == []


async def test_a_restart_sweep_needs_a_backend_that_has_restart_files(tmp_path: Path) -> None:
    """The tutorial's ch. 8.2 converges once and then varies the parameter from that restart file.

    Not only faster -- every point starts from the same electronic state, so the curve shows the
    parameter rather than N independent convergences. A backend with nothing to restart from has
    to say so rather than quietly run N convergences instead.
    """
    svc, jm = _service(tmp_path)
    copper = from_atoms(bulk("Cu", cubic=True), name="cu")
    svc.project.save_structure(copper)
    reference = svc.create(
        name="reference",
        backend_id="ase_builtin",
        structure=copper,
        values={"task": "single_point"},
    )
    reference = svc.run(reference.id)
    assert reference.job is not None
    await jm.wait(reference.job.id)
    svc.collect_results(reference.id)

    spec = SweepSpec(
        name="steps",
        backend_id="ase_builtin",
        label="Relaxation steps",
        key="max_steps",
        base_values={"task": "relax"},
        restart_from=reference.id,
        points=[SweepPointSpec(x=n, values={"max_steps": int(n)}) for n in (1, 2)],
    )
    before = {c.id for c in svc.list()}
    with pytest.raises(CalculationError, match="no restart files"):
        create_sweep(svc, spec, copper)
    # ...and nothing half-made is left behind for the next attempt to trip over
    assert [c for c in svc.list() if c.sweep is not None] == []
    assert {c.id for c in svc.list()} == before
