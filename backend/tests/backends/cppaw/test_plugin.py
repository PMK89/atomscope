# ruff: noqa: E501, PLC0415
import json
from pathlib import Path

import pytest
from ase.build import bulk, molecule

from atomscope.ase_bridge import from_atoms
from atomscope.backends.base import BackendPlugin, Resources
from atomscope.backends.cppaw.plugin import CppawPlugin, plugin
from atomscope.backends.cppaw.settings import diagnose_output
from atomscope.backends.registry import default_registry
from atomscope.jobs import JobManager


def test_conformance_and_registration() -> None:
    assert isinstance(plugin, BackendPlugin)
    assert default_registry().get("cppaw") is plugin
    schema = plugin.schema()
    assert schema.spec("epwpsi").unit == "rydberg"
    assert all(p.backend_path for p in schema.parameters() if p.key != "force_steps")


def test_generate_inputs_and_validation() -> None:
    s = from_atoms(molecule("H2O"))
    gen = plugin.generate_inputs(s, {"task": "relax"}, "case")
    files = {f.name: f.text for f in gen.files}
    assert set(files) == {"case.cntl", "case.strc"}
    assert "!RDYN" in files["case.cntl"] and "!ISOLATE" in files["case.strc"]
    forces = {f.name for f in plugin.generate_inputs(s, {"task": "forces"}, "case").files}
    assert forces == {"case.strc", "case.stage1.cntl", "case.stage2.cntl"}
    rep = plugin.validate(s, {"task": "md", "start": "scratch", "write_spin_density": True})
    assert rep.ok and {i.key for i in rep.issues} == {"start", "write_spin_density"}
    assert not plugin.validate(
        from_atoms(molecule("H2O"))[:0]
        if False
        else s.model_copy(update={"atoms": [], "bonds": []}),
        {},
    ).ok


def test_discover_reports_executable_or_reason() -> None:
    rep = plugin.discover_executables()
    if rep.available:
        assert "paw_fast" in rep.executables
    else:
        assert rep.messages


@pytest.mark.cppaw
async def test_real_si2_run(tmp_path: Path) -> None:
    """Runs the si2 example through the driver (~15 s). Skipped when CP-PAW is unavailable."""
    p = CppawPlugin()
    if not p.discover_executables().available:
        pytest.skip("paw_fast.x not found")
    health = p.health_check()
    if not health.ok:
        pytest.skip(f"CP-PAW not healthy: {health.message}")
    s = from_atoms(bulk("Si", cubic=False), name="si2")
    values = {
        "task": "single_point",
        "kpoint_mode": "density",
        "kpoint_r": 10.0,
        "empty_bands": 2,
        "nstep": 60,
        "nwrite": 10,
        "epwpsi": 30.0,
        "cdual": 2.0,
        "write_density": True,
    }
    gen = p.generate_inputs(s, values, "case")
    inp, work = tmp_path / "input", tmp_path / "work"
    inp.mkdir()
    work.mkdir()
    (inp / "structure.json").write_text(s.model_dump_json())
    (inp / "values.json").write_text(json.dumps(values))
    for f in gen.files:
        (inp / f.name).write_text(f.text)
        (work / f.name).write_text(f.text)
    spec = p.run_spec(inp, work, gen, Resources())
    assert "LD_LIBRARY_PATH" in spec.env or health.library_path is None
    jm = JobManager()
    rec = await jm.wait(jm.submit(spec).id)
    assert rec.status == "completed", (work / "driver.log").read_text() + (
        work / "driver.err"
    ).read_text()
    res = p.parse_results(work, gen)
    assert res.final_structure is not None and "energy" in res.properties
    assert -8.0 * 27.2 < res.properties["energy"].value < -7.0 * 27.2  # about -7.9 H
    assert res.trajectory is not None
    if p.settings.find("paw_wave.x") is not None:
        assert res.grids and (work / "case_density.cub").exists()


def test_diagnose_output_recognizes_runtime_failure() -> None:
    assert "libgfortran" in (
        diagnose_output("Fortran runtime error: Missing comma between descriptors") or ""
    )
    assert "STOP IN STRCIN" in (diagnose_output("foo\n STOP IN STRCIN_SPECIES\n") or "")
    assert diagnose_output("all good") is None


def test_run_spec_probes_runtime(tmp_path: Path) -> None:
    p = CppawPlugin()
    if not p.discover_executables().available:
        pytest.skip("paw_fast.x not found")
    s = from_atoms(bulk("Si"))
    gen = p.generate_inputs(s, {}, "case")
    (tmp_path / "input").mkdir()
    (tmp_path / "work").mkdir()
    (tmp_path / "input" / "structure.json").write_text(s.model_dump_json())
    assert not p.settings.runtime_verified
    spec = p.run_spec(tmp_path / "input", tmp_path / "work", gen, Resources())
    assert p.settings.runtime_verified
    if p.settings.library_path:
        assert spec.env["LD_LIBRARY_PATH"] == p.settings.library_path
    assert p.restart_files(gen) == ["case.rstrt"]


def test_runner_requires_program_finished(tmp_path: Path) -> None:
    from atomscope.backends.cppaw.runner import ROOT_RE, protocol_finished

    prot = tmp_path / "case.prot"
    assert not protocol_finished(prot)
    prot.write_text("PROGRAM STARTED\n...\nPROGRAM FINISHED\nPROGRAM STARTED\nincomplete\n")
    assert not protocol_finished(prot)
    prot.write_text("PROGRAM STARTED\nPROGRAM FINISHED\n")
    assert protocol_finished(prot)
    assert ROOT_RE.match("case") and not ROOT_RE.match("../case") and not ROOT_RE.match("a/b")


@pytest.mark.cppaw
async def test_real_forces_task_through_driver(tmp_path: Path) -> None:
    """Two-stage force evaluation via the driver: electrons first, then damped atomic steps."""
    p = CppawPlugin()
    if not p.discover_executables().available:
        pytest.skip("paw_fast.x not found")
    atoms = bulk("Si")
    atoms.positions[1] += [0.05, 0.0, 0.0]
    s = from_atoms(atoms, name="si2")
    values = {
        "task": "forces",
        "kpoint_r": 8.0,
        "empty_bands": 2,
        "nstep": 400,
        "force_steps": 3,
        "epwpsi": 25.0,
    }
    gen = p.generate_inputs(s, values, "case")
    inp, work = tmp_path / "input", tmp_path / "work"
    inp.mkdir()
    work.mkdir()
    (inp / "structure.json").write_text(s.model_dump_json())
    (inp / "values.json").write_text(json.dumps(values))
    for f in gen.files:
        (inp / f.name).write_text(f.text)
        (work / f.name).write_text(f.text)
    spec = p.run_spec(inp, work, gen, Resources())
    assert "--stages" in spec.argv
    jm = JobManager()
    rec = await jm.wait(jm.submit(spec).id)
    assert rec.status == "completed", (work / "driver.log").read_text()
    res = p.parse_results(work, gen)
    forces = res.final_structure.atomic_vectors["forces"].values
    assert abs(forces[0][0]) > 0.3 and abs(forces[0][0] + forces[1][0]) < 0.05
    assert res.converged is True and res.complete is True
    # the reported geometry is the input geometry (forces at the requested positions)
    assert abs(res.final_structure.atoms[1].position[0] - s.atoms[1].position[0]) < 1e-9


def test_occupation_state_validation() -> None:
    s = from_atoms(molecule("O2"))
    rep = plugin.validate(s, {"occupation_states": "5 2 1.0", "spin_polarized": False})
    assert not rep.ok and "spin-polarized" in rep.errors()[0].message
    assert plugin.validate(s, {"occupation_states": "5 2 1.0", "spin_polarized": True}).ok
    assert not plugin.validate(s, {"occupation_states": "garbage"}).ok


@pytest.mark.cppaw
async def test_real_parallel_run(tmp_path: Path) -> None:
    """si2 on 2 MPI ranks through ppaw_fast.x (skipped when the parallel binary is missing)."""
    from atomscope.backends.cppaw import settings as cppaw_settings

    p = CppawPlugin()
    if p.settings.find(cppaw_settings.PARALLEL_EXE) is None or not p.settings.mpirun:
        pytest.skip("ppaw_fast.x or mpirun not available")
    s = from_atoms(bulk("Si"), name="si2")
    values = {
        "task": "single_point",
        "kpoint_r": 8.0,
        "empty_bands": 2,
        "nstep": 300,
        "epwpsi": 25.0,
    }
    gen = p.generate_inputs(s, values, "case")
    inp, work = tmp_path / "input", tmp_path / "work"
    inp.mkdir()
    work.mkdir()
    (inp / "structure.json").write_text(s.model_dump_json())
    (inp / "values.json").write_text(json.dumps(values))
    for f in gen.files:
        (inp / f.name).write_text(f.text)
        (work / f.name).write_text(f.text)
    spec = p.run_spec(inp, work, gen, Resources(cores=2, mpi=True))
    assert "--mpirun" in spec.argv and spec.env.get("OMP_NUM_THREADS") == "1"
    jm = JobManager()
    rec = await jm.wait(jm.submit(spec).id)
    logs = "".join(
        (work / n).read_text()
        for n in ("driver.log", "driver.err", "case.out")
        if (work / n).exists()
    )
    assert rec.status == "completed", logs[-3000:]
    res = p.parse_results(work, gen)
    assert -8.0 * 27.2 < res.properties["energy"].value < -7.0 * 27.2
