# ruff: noqa: E501, PLC0415
from pathlib import Path

import pytest
from ase.build import bulk, molecule

from atomscope.ase_bridge import from_atoms
from atomscope.backends.ase_builtin import plugin
from atomscope.backends.base import BackendPlugin, Resources
from atomscope.backends.registry import default_registry
from atomscope.jobs import JobManager


def test_plugin_conforms_and_registers() -> None:
    assert isinstance(plugin, BackendPlugin)
    reg = default_registry()
    assert reg.get("ase_builtin") is plugin
    assert plugin.schema().spec("fmax").unit is not None


def test_validation_flags_unsupported_emt_elements() -> None:
    s = from_atoms(molecule("SH2"))
    rep = plugin.validate(s, {"calculator": "emt"})
    assert not rep.ok and "S" in rep.errors()[0].message
    assert plugin.validate(s, {"calculator": "lj"}).ok


def test_inputs_are_deterministic() -> None:
    s = from_atoms(bulk("Cu"))
    a = plugin.generate_inputs(s, {"task": "relax"}, "case")
    b = plugin.generate_inputs(s, {"task": "relax"}, "case")
    assert a == b and a.files[0].name == "case.json"


@pytest.mark.parametrize("task", ["single_point", "relax", "md"])
async def test_end_to_end_run(tmp_path: Path, task: str) -> None:
    atoms = bulk("Cu", cubic=True)
    atoms.positions[0] += [0.1, 0.0, 0.0]  # perturb so relaxation does something
    s = from_atoms(atoms, name="cu")
    values = {"calculator": "emt", "task": task, "max_steps": 5, "fmax": 0.01}
    gen = plugin.generate_inputs(s, values, "cu")
    inp, work = tmp_path / "input", tmp_path / "work"
    inp.mkdir()
    work.mkdir()
    for f in gen.files:
        (inp / f.name).write_text(f.text)
    spec = plugin.run_spec(inp, work, gen, Resources())
    jm = JobManager()
    rec = await jm.wait(jm.submit(spec).id)
    assert rec.status == "completed", (work / "stderr.log").read_text()
    res = plugin.parse_results(work, gen)
    assert res.final_structure is not None and res.final_structure.n_atoms == 4
    assert "energy" in res.properties and res.properties["energy"].unit == "eV"
    assert res.trajectory is not None and res.trajectory.n_frames >= 1
    assert "forces" in res.final_structure.atomic_vectors
    if task == "relax":
        assert res.trajectory.n_frames > 1
        assert res.trajectory.frames[-1].energy <= res.trajectory.frames[0].energy + 1e-8
    if task == "md":
        assert res.trajectory.frames[-1].temperature is not None
        # every frame carries a time, starting at zero and evenly spaced: a time series over the
        # trajectory (per-group temperature, an internal coordinate) needs the whole axis
        times = [f.time for f in res.trajectory.frames]
        assert times[0] == 0.0
        assert all(t is not None for t in times)
        assert times == sorted(times) and len(set(times)) == len(times)
        assert res.trajectory.frames[0].temperature is not None
    assert (work / "progress.log").read_text().startswith("initial energy")


@pytest.mark.cppaw
async def test_ase_bfgs_drives_cppaw(tmp_path: Path) -> None:
    """ASE BFGS relaxation with CP-PAW forces (~1-2 min)."""
    from atomscope.backends.cppaw import plugin as cppaw_plugin

    if not cppaw_plugin.discover_executables().available:
        pytest.skip("paw_fast.x not found")
    atoms = bulk("Si")
    atoms.positions[1] += [0.05, 0.0, 0.0]
    s = from_atoms(atoms, name="si2")
    values = {
        "calculator": "cppaw",
        "task": "relax",
        "max_steps": 3,
        "fmax": 0.02,
        "cppaw_kpoint_r": 8.0,
        "cppaw_empty_bands": 2,
        "cppaw_epwpsi": 25.0,
    }
    assert plugin.validate(s, values).ok
    gen = plugin.generate_inputs(s, values, "case")
    inp, work = tmp_path / "input", tmp_path / "work"
    inp.mkdir()
    work.mkdir()
    for f in gen.files:
        (inp / f.name).write_text(f.text)
    spec = plugin.run_spec(inp, work, gen, Resources())
    jm = JobManager()
    rec = await jm.wait(jm.submit(spec).id)
    assert rec.status == "completed", (work / "stderr.log").read_text()
    res = plugin.parse_results(work, gen)
    assert res.trajectory is not None and res.trajectory.n_frames >= 2
    energies = [f.energy for f in res.trajectory.frames]
    assert energies[-1] <= energies[0] + 1e-6
    assert "forces" in res.final_structure.atomic_vectors
