"""Carbon nanostructures via ``ase.build``: single-wall nanotubes and graphene nanoribbons."""

from __future__ import annotations

from typing import Literal

from ase.build import graphene_nanoribbon, nanotube

from atomscope.ase_bridge import from_atoms
from atomscope.chem.bonds import perceive_bonds
from atomscope.model import Provenance, Structure


def _finish(structure: Structure, *, periodic: bool, source: str, notes: str) -> Structure:
    if not periodic:
        structure.cell = None
    structure.bonds = perceive_bonds(structure)
    structure.provenance = Provenance(source=source, software="ASE", notes=notes)
    return structure


def build_nanotube(
    n: int,
    m: int,
    *,
    length: int = 1,
    bond: float = 1.42,
    symbol: str = "C",
    periodic: bool = True,
) -> Structure:
    """(n, m) tube with ``length`` translational unit cells along z."""
    if n < 1 or m < 0 or m > n:
        raise ValueError("need n >= 1 and 0 <= m <= n")
    if length < 1:
        raise ValueError("length must be at least 1")
    atoms = nanotube(n, m, length=length, bond=bond, symbol=symbol)
    s = from_atoms(atoms, name=f"({n},{m}) nanotube")
    return _finish(
        s, periodic=periodic, source="build.nanotube", notes=f"n={n} m={m} length={length}"
    )


def build_graphene_ribbon(
    n: int,
    m: int,
    *,
    kind: Literal["armchair", "zigzag"] = "armchair",
    saturated: bool = True,
    bond: float = 1.42,
    periodic: bool = True,
) -> Structure:
    """Graphene nanoribbon: ``n`` dimer lines wide, ``m`` unit cells long (ASE convention)."""
    if n < 1 or m < 1:
        raise ValueError("n and m must be at least 1")
    atoms = graphene_nanoribbon(n, m, type=kind, saturated=saturated, C_C=bond, vacuum=6.0)
    s = from_atoms(atoms, name=f"{kind} graphene nanoribbon {n}x{m}")
    return _finish(
        s,
        periodic=periodic,
        source="build.graphene",
        notes=f"{kind} n={n} m={m} saturated={saturated}",
    )
