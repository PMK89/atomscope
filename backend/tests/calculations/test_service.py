# ruff: noqa: E501, PLC0415
from pathlib import Path

import pytest
from ase.build import bulk

from atomscope.ase_bridge import from_atoms
from atomscope.backends.registry import default_registry
from atomscope.calculations import CalculationService
from atomscope.calculations.service import CalculationError
from atomscope.jobs import JobManager
from atomscope.project import ProjectStore


async def test_full_lifecycle(tmp_path: Path) -> None:
    project = ProjectStore.create(tmp_path / "p", "demo")
    s = from_atoms(bulk("Cu", cubic=True), name="cu")
    project.save_structure(s)
    jm = JobManager()
    svc = CalculationService(project, default_registry(), jm)
    calc = svc.create(
        name="cu relax",
        backend_id="ase_builtin",
        structure=s,
        values={"task": "relax", "max_steps": 3},
    )
    assert calc.status == "draft" and calc.values["calculator"] == "emt"
    gen = svc.generate(calc.id)
    assert (project.calculation_dir(calc.id) / "input" / "case.json").exists()
    assert svc.get(calc.id).status == "ready" and gen.root_name == "case"
    calc = svc.run(calc.id)
    assert calc.job is not None
    await jm.wait(calc.job.id)
    calc = svc.get(calc.id)
    assert calc.status == "completed"
    assert calc.results is not None and "energy" in calc.results.properties
    assert calc.result_structure_id in project.manifest.structure_ids
    # persisted and reloadable
    reopened = CalculationService(
        ProjectStore.open(tmp_path / "p"), default_registry(), JobManager()
    )
    again = reopened.get(calc.id)
    assert again.status == "completed" and again.results is not None
    assert (project.calculation_dir(calc.id) / "results" / "results.json").exists()


def test_invalid_values_block_generation(tmp_path: Path) -> None:
    project = ProjectStore.create(tmp_path / "p", "demo")
    s = from_atoms(bulk("Cu"))
    svc = CalculationService(project, default_registry(), JobManager())
    calc = svc.create(
        name="bad", backend_id="ase_builtin", structure=s, values={"max_steps": 0, "task": "relax"}
    )
    with pytest.raises(CalculationError, match="max_steps"):
        svc.generate(calc.id)
    svc.update_values(calc.id, {"task": "single_point"})
    assert svc.validate(calc.id).ok


async def test_completed_calculation_is_immutable_and_forkable(tmp_path: Path) -> None:
    project = ProjectStore.create(tmp_path / "p", "demo")
    s = from_atoms(bulk("Cu", cubic=True), name="cu")
    jm = JobManager()
    svc = CalculationService(project, default_registry(), jm)
    calc = svc.create(
        name="cu", backend_id="ase_builtin", structure=s, values={"task": "single_point"}
    )
    svc.run(calc.id)
    await jm.wait(svc.get(calc.id).job.id)
    assert svc.get(calc.id).status == "completed"
    with pytest.raises(CalculationError, match="fork"):
        svc.update_values(calc.id, {"task": "relax"})
    with pytest.raises(CalculationError, match="fork"):
        svc.run(calc.id)
    child = svc.fork(calc.id, {"task": "relax", "max_steps": 2}, name="cu relax")
    assert child.parent_calculation_id == calc.id and child.values["task"] == "relax"
    assert child.values["calculator"] == "emt" and child.status == "draft"
    assert svc.input_structure(child) == svc.input_structure(calc)
    with pytest.raises(CalculationError, match="restart"):
        svc.fork(calc.id, restart_from_parent=True)  # ASE plugin has no restart files


def test_reconcile_marks_orphaned_running_calculations(tmp_path: Path) -> None:
    project = ProjectStore.create(tmp_path / "p", "demo")
    s = from_atoms(bulk("Cu"))
    svc = CalculationService(project, default_registry(), JobManager())
    calc = svc.create(name="orphan", backend_id="ase_builtin", structure=s, values={})
    svc.generate(calc.id)
    calc = svc.get(calc.id)
    calc.status = "running"
    svc.save(calc)
    again = CalculationService(ProjectStore.open(tmp_path / "p"), default_registry(), JobManager())
    assert again.get(calc.id).status == "failed"


def test_close_detaches_listener(tmp_path: Path) -> None:
    project = ProjectStore.create(tmp_path / "p", "demo")
    jm = JobManager()
    svc = CalculationService(project, default_registry(), jm)
    assert svc._on_job_event in jm._listeners
    svc.close()
    assert svc._on_job_event not in jm._listeners


def test_restart_fork_sets_restart_start_for_cppaw(tmp_path: Path) -> None:
    from atomscope.backends.cppaw import plugin as cppaw_plugin

    project = ProjectStore.create(tmp_path / "p", "demo")
    s = from_atoms(bulk("Si"))
    svc = CalculationService(project, default_registry(), JobManager())
    calc = svc.create(name="si", backend_id="cppaw", structure=s, values={"task": "single_point"})
    svc.generate(calc.id)
    (project.calculation_dir(calc.id) / "work" / "case.rstrt").write_bytes(b"fake restart")
    child = svc.fork(calc.id, {"task": "relax"}, restart_from_parent=True)
    assert child.values["start"] == "restart" and child.values["task"] == "relax"
    assert (project.calculation_dir(child.id) / "work" / "case.rstrt").exists()
    assert (
        cppaw_plugin.restart_values({"start": "restart_new_structure"})["start"]
        == "restart_new_structure"
    )
    gen = svc.generate(child.id)
    cntl = next(f.text for f in gen.files if f.name == "case.cntl")
    assert "START=F" in cntl


async def test_collecting_results_twice_replaces_the_result_structure(tmp_path: Path) -> None:
    """Re-collecting is what you do after the parser improves; it must not leave a second copy."""
    project = ProjectStore.create(tmp_path / "p", "demo")
    s = from_atoms(bulk("Cu", cubic=True), name="cu")
    project.save_structure(s)
    jm = JobManager()
    svc = CalculationService(project, default_registry(), jm)
    calc = svc.create(
        name="cu", backend_id="ase_builtin", structure=s, values={"task": "relax", "max_steps": 2}
    )
    calc = svc.run(calc.id)
    assert calc.job is not None
    await jm.wait(calc.job.id)
    svc.collect_results(calc.id)
    after_one = list(project.manifest.structure_ids)
    result_id = svc.get(calc.id).result_structure_id
    assert result_id == f"{calc.id}-final"

    svc.collect_results(calc.id)
    assert list(project.manifest.structure_ids) == after_one
    assert svc.get(calc.id).result_structure_id == result_id
