"""Multi-frame file IO (extxyz, ASE .traj, XDATCAR, ...) to and from ``Trajectory``."""

from __future__ import annotations

import io as _io
from pathlib import Path
from typing import Any

import ase.io
import numpy as np
from ase import Atoms
from ase.calculators.singlepoint import SinglePointCalculator

from atomscope.ase_bridge.convert import from_atoms
from atomscope.chem.bonds import perceive_bonds
from atomscope.io.registry import FormatError
from atomscope.model import Frame, Provenance, Structure, Trajectory, new_uid
from atomscope.model.common import Vec3

_SCALARS = ("energy", "time", "temperature", "step")


def _v3(v: Any) -> Vec3:
    return (float(v[0]), float(v[1]), float(v[2]))


def _scalar(atoms: Atoms, key: str) -> float | None:
    results = getattr(atoms.calc, "results", None) or {}
    value = results.get(key, atoms.info.get(key))
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _frame(atoms: Atoms) -> Frame:
    results = getattr(atoms.calc, "results", None) or {}
    forces = results.get("forces")
    if forces is None and atoms.has("forces"):
        forces = atoms.get_array("forces")
    step = _scalar(atoms, "step")
    # tolist() converts the whole array in C instead of calling float() three times per atom
    return Frame(
        positions=[(p[0], p[1], p[2]) for p in atoms.get_positions().tolist()],
        cell=(_v3(atoms.cell[0]), _v3(atoms.cell[1]), _v3(atoms.cell[2]))
        if atoms.cell.rank > 0
        else None,
        energy=_scalar(atoms, "energy"),
        forces=[(f[0], f[1], f[2]) for f in np.asarray(forces).tolist()]
        if forces is not None
        else None,
        time=_scalar(atoms, "time"),
        temperature=_scalar(atoms, "temperature"),
        step=int(step) if step is not None else None,
    )


def read_trajectory(path: Path, fmt: str | None = None) -> tuple[Trajectory, Structure]:
    """Read every frame of ``path``; return the trajectory and the first frame as a Structure."""
    try:
        images = ase.io.read(str(path), index=":", format=fmt)
    except Exception as exc:
        msg = f"ASE could not read {path.name} as a trajectory: {exc}"
        raise FormatError(msg) from exc
    if not isinstance(images, list):
        images = [images]
    if not images:
        msg = f"{path.name} contains no frames"
        raise FormatError(msg)
    first = images[0]
    symbols = list(first.get_chemical_symbols())
    for i, atoms in enumerate(images):
        if list(atoms.get_chemical_symbols()) != symbols:
            msg = f"frame {i} of {path.name} has a different composition than frame 0"
            raise FormatError(msg)
    structure = from_atoms(first, name=path.stem)
    if not structure.bonds and structure.n_atoms > 1:
        structure.bonds = perceive_bonds(structure)
    structure.provenance = Provenance(source=str(path), notes="first trajectory frame")
    frames = [_frame(a) for a in images]
    kind = (
        "md" if any(f.temperature is not None or f.time is not None for f in frames) else "generic"
    )
    trajectory = Trajectory(
        id=new_uid(),
        name=path.stem,
        structure_id=structure.id,
        symbols=symbols,
        frames=frames,
        kind=kind,
        provenance=Provenance(source=str(path), notes=f"{len(frames)} frames read with ASE"),
    )
    return trajectory, structure


def trajectory_to_images(trajectory: Trajectory) -> list[Atoms]:
    """One ``Atoms`` per frame with energy/forces on a single-point calculator."""
    images: list[Atoms] = []
    for frame in trajectory.frames:
        atoms = Atoms(symbols=trajectory.symbols, positions=np.asarray(frame.positions))
        if frame.cell is not None:
            atoms.set_cell(np.asarray(frame.cell))
            atoms.set_pbc(True)
        for key in _SCALARS[1:]:
            value = getattr(frame, key)
            if value is not None:
                atoms.info[key] = value
        if frame.energy is not None or frame.forces is not None:
            results: dict[str, Any] = {}
            if frame.energy is not None:
                results["energy"] = frame.energy
            if frame.forces is not None:
                results["forces"] = np.asarray(frame.forces)
            atoms.calc = SinglePointCalculator(atoms, **results)
        images.append(atoms)
    return images


def trajectory_to_extxyz(trajectory: Trajectory) -> str:
    buf = _io.StringIO()
    ase.io.write(buf, trajectory_to_images(trajectory), format="extxyz")
    return buf.getvalue()


def write_trajectory_extxyz(trajectory: Trajectory, path: Path) -> None:
    path.write_text(trajectory_to_extxyz(trajectory), encoding="utf-8")


__all__ = [
    "read_trajectory",
    "trajectory_to_extxyz",
    "trajectory_to_images",
    "write_trajectory_extxyz",
]
