"""Crystal builders: supercell, surface slab, bulk lattices and space-group + Wyckoff basis."""

from __future__ import annotations

from typing import Any

import numpy as np
from ase.build import bulk as ase_bulk
from ase.build import make_supercell, surface
from ase.spacegroup import crystal as ase_crystal

from atomscope.crystal._common import new_atoms, require_cell
from atomscope.model import Structure
from atomscope.model.common import Mat3, Vec3


def supercell(
    structure: Structure, repeat: tuple[int, int, int] | None = None, matrix: Mat3 | None = None
) -> Structure:
    """Build a supercell from diagonal repeats or a full integer transformation matrix."""
    atoms = require_cell(structure)
    if matrix is not None:
        p = np.array(matrix, dtype=float)
    elif repeat is not None:
        p = np.diag(repeat).astype(float)
    else:
        msg = "give either repeat counts or a transformation matrix"
        raise ValueError(msg)
    if not np.allclose(p, np.round(p)) or abs(np.linalg.det(p)) < 0.5:
        msg = "supercell matrix must be integer with non-zero determinant"
        raise ValueError(msg)
    out = make_supercell(atoms, np.round(p).astype(int), wrap=True)
    reps = "x".join(str(int(x)) for x in repeat) if repeat is not None else "supercell"
    return new_atoms(structure, out, name=f"{structure.name} {reps}")


def slab(
    structure: Structure, miller: tuple[int, int, int], layers: int, vacuum: float = 10.0
) -> Structure:
    """Cut a surface slab with the given Miller indices; ``vacuum`` (Å) is added on both sides."""
    atoms = require_cell(structure)
    if not all(atoms.pbc):
        msg = "slab construction needs a fully periodic bulk cell"
        raise ValueError(msg)
    if layers < 1:
        msg = "layers must be >= 1"
        raise ValueError(msg)
    if not any(miller):
        msg = "Miller indices must not all be zero"
        raise ValueError(msg)
    out = surface(atoms, miller, layers, vacuum=vacuum if vacuum > 0 else None, periodic=False)
    hkl = "".join(str(i) for i in miller)
    return new_atoms(structure, out, name=f"{structure.name}({hkl})")


def bulk(
    symbol: str,
    crystalstructure: str,
    a: float | None = None,
    c: float | None = None,
    *,
    cubic: bool = False,
    orthorhombic: bool = False,
) -> Structure:
    """Bulk lattice via ``ase.build.bulk`` (sc, fcc, bcc, hcp, diamond, zincblende, rocksalt...)."""
    kwargs: dict[str, Any] = {"cubic": cubic, "orthorhombic": orthorhombic}
    if a is not None:
        kwargs["a"] = a
    if c is not None:
        kwargs["c"] = c
    try:
        atoms = ase_bulk(symbol, crystalstructure, **kwargs)
    except (ValueError, KeyError, RuntimeError) as exc:
        raise ValueError(str(exc)) from exc
    return new_atoms(Structure(name=f"{symbol} {crystalstructure}"), atoms, name=None)


def from_spacegroup(
    symbols: list[str],
    basis: list[Vec3],
    spacegroup: int,
    cellpar: tuple[float, float, float, float, float, float],
    name: str | None = None,
) -> Structure:
    """Build a crystal from Wyckoff basis positions (fractional) and cell parameters."""
    if len(symbols) != len(basis):
        msg = "symbols and basis must have the same length"
        raise ValueError(msg)
    if not 1 <= spacegroup <= 230:
        msg = f"invalid space group number {spacegroup}"
        raise ValueError(msg)
    try:
        atoms = ase_crystal(
            symbols=symbols, basis=basis, spacegroup=spacegroup, cellpar=list(cellpar)
        )
    except (ValueError, KeyError) as exc:
        raise ValueError(str(exc)) from exc
    return new_atoms(Structure(name=name or "".join(symbols)), atoms, name=None)
