from pathlib import Path

import ase.io
import numpy as np
import pytest
from ase import units
from ase.build import bulk, molecule
from ase.calculators.emt import EMT
from ase.md.velocitydistribution import MaxwellBoltzmannDistribution
from ase.md.verlet import VelocityVerlet

from atomscope.io.registry import FormatError
from atomscope.io.trajectory_io import read_trajectory, trajectory_to_extxyz, trajectory_to_images
from atomscope.model import Frame, Trajectory


def _md_extxyz(path: Path, steps: int = 4) -> None:
    atoms = bulk("Cu", cubic=True)
    atoms.calc = EMT()
    MaxwellBoltzmannDistribution(atoms, temperature_K=300, rng=np.random.default_rng(0))
    dyn = VelocityVerlet(atoms, 2 * units.fs)
    images = []
    for i in range(steps):
        dyn.run(1)
        a = atoms.copy()
        a.calc = EMT()
        a.get_forces()
        a.info["time"] = 2.0 * (i + 1)
        a.info["temperature"] = atoms.get_temperature()
        images.append(a)
    ase.io.write(str(path), images, format="extxyz")


def test_read_md_extxyz(tmp_path: Path) -> None:
    p = tmp_path / "md.xyz"
    _md_extxyz(p)
    traj, structure = read_trajectory(p)
    assert traj.n_frames == 4 and traj.symbols == ["Cu"] * 4 and traj.kind == "md"
    f = traj.frames[1]
    assert f.energy is not None and f.forces is not None and len(f.forces) == 4
    assert f.time == pytest.approx(4.0) and f.temperature is not None and f.cell is not None
    assert structure.n_atoms == 4 and structure.cell is not None
    assert structure.provenance is not None and structure.provenance.source == str(p)


def test_read_ase_traj_and_errors(tmp_path: Path) -> None:
    p = tmp_path / "opt.traj"
    a = molecule("H2O")
    ase.io.write(str(p), [a, a])
    traj, structure = read_trajectory(p)
    assert traj.n_frames == 2 and traj.kind == "generic" and len(structure.bonds) == 2
    bad = tmp_path / "mixed.xyz"
    ase.io.write(str(bad), [molecule("H2O"), molecule("NH3")], format="extxyz")
    with pytest.raises(FormatError):
        read_trajectory(bad)
    with pytest.raises(FormatError):
        read_trajectory(tmp_path / "garbage.xyz")


def test_extxyz_round_trip(tmp_path: Path) -> None:
    traj = Trajectory(
        id="t",
        name="synthetic",
        symbols=["H", "H"],
        frames=[
            Frame(
                positions=[(0, 0, 0), (0.7 + 0.01 * i, 0, 0)],
                energy=-1.0 - i,
                forces=[(0.1, 0, 0), (-0.1, 0, 0)],
                time=float(i),
                step=i,
            )
            for i in range(3)
        ],
    )
    assert len(trajectory_to_images(traj)) == 3
    text = trajectory_to_extxyz(traj)
    assert text.startswith("2\n") and "energy=-1.0" in text
    p = tmp_path / "rt.xyz"
    p.write_text(text)
    back, _ = read_trajectory(p)
    assert back.n_frames == 3
    assert back.frames[2].energy == pytest.approx(-3.0)
    assert back.frames[2].positions[1][0] == pytest.approx(0.72)
    assert back.frames[2].forces is not None and back.frames[2].forces[0][0] == pytest.approx(0.1)
    assert back.frames[1].time == pytest.approx(1.0) and back.frames[1].step == 1
