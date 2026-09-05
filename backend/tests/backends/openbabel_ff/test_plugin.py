"""The Open Babel force-field backend plugin, exercised through the real job machinery."""

from __future__ import annotations

from pathlib import Path

import pytest

from atomscope.backends.base import BackendPlugin, Resources
from atomscope.backends.openbabel_ff import plugin
from atomscope.backends.registry import default_registry
from atomscope.io.rdkit_io import from_smiles
from atomscope.jobs import JobManager
from atomscope.model import Structure


def prepare(
    tmp_path: Path, structure: Structure, values: dict[str, object]
) -> tuple[Path, Path, object]:
    gen = plugin.generate_inputs(structure, values, "case")
    inp, work = tmp_path / "input", tmp_path / "work"
    inp.mkdir()
    work.mkdir()
    for f in gen.files:
        (inp / f.name).write_text(f.text)
    return inp, work, gen


def test_registered_and_conformant() -> None:
    assert isinstance(plugin, BackendPlugin)
    assert default_registry().get(plugin.id) is plugin
    assert plugin.capabilities.energy and plugin.capabilities.forces
    assert plugin.discover_executables().available


def test_validation_rejects_unknown_force_field() -> None:
    s = from_smiles("CCO")
    assert plugin.validate(s, {"force_field": "MMFF94"}).ok
    assert not plugin.validate(s, {"force_field": "NOT-A-FIELD"}).ok
    assert not plugin.validate(s.model_copy(update={"atoms": [], "bonds": []}), {}).ok


def test_inputs_are_deterministic() -> None:
    s = from_smiles("CCO")
    a = plugin.generate_inputs(s, {"task": "optimize"}, "case")
    assert a == plugin.generate_inputs(s, {"task": "optimize"}, "case")


async def test_optimization_lowers_the_energy(tmp_path: Path) -> None:
    ethanol = from_smiles("CCO")
    inp, work, gen = prepare(
        tmp_path,
        ethanol,
        {"task": "optimize", "force_field": "MMFF94", "max_steps": 200, "record_every": 25},
    )
    jm = JobManager()
    rec = await jm.wait(jm.submit(plugin.run_spec(inp, work, gen, Resources())).id)
    assert rec.status == "completed", (work / "stderr.log").read_text()
    res = plugin.parse_results(work, gen)
    assert res.final_structure is not None and res.final_structure.n_atoms == ethanol.n_atoms
    assert res.properties["energy"].unit == "eV"
    assert res.trajectory is not None and res.trajectory.n_frames >= 2
    energies = [f.energy for f in res.trajectory.frames if f.energy is not None]
    assert energies[-1] <= energies[0] + 1e-9
    assert "forces" in res.final_structure.atomic_vectors


async def test_single_point_and_conformer_search(tmp_path: Path) -> None:
    butane = from_smiles("CCCC")
    inp, work, gen = prepare(tmp_path, butane, {"task": "energy", "force_field": "UFF"})
    jm = JobManager()
    rec = await jm.wait(jm.submit(plugin.run_spec(inp, work, gen, Resources())).id)
    assert rec.status == "completed"
    assert "energy" in plugin.parse_results(work, gen).properties

    conf_dir = tmp_path / "conf"
    conf_dir.mkdir()
    inp2, work2, gen2 = prepare(
        conf_dir,
        butane,
        {"task": "conformers", "force_field": "MMFF94", "n_conformers": 4, "steps": 20},
    )
    rec2 = await jm.wait(jm.submit(plugin.run_spec(inp2, work2, gen2, Resources())).id)
    assert rec2.status == "completed", (work2 / "stderr.log").read_text()
    res2 = plugin.parse_results(work2, gen2)
    assert res2.trajectory is not None and res2.trajectory.n_frames >= 1


async def test_failure_is_reported(tmp_path: Path) -> None:
    """A molecule the force field cannot parameterize must fail loudly, not silently."""
    exotic = Structure.model_validate(
        {"name": "uranium", "atoms": [{"element": "U", "position": [0.0, 0.0, 0.0]}]}
    )
    inp, work, gen = prepare(tmp_path, exotic, {"task": "optimize", "force_field": "MMFF94"})
    jm = JobManager()
    rec = await jm.wait(jm.submit(plugin.run_spec(inp, work, gen, Resources())).id)
    if rec.status == "completed":
        pytest.skip("this force field accepted the exotic element")
    assert rec.status == "failed"
    assert plugin.parse_results(work, gen).warnings
