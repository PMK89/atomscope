"""Atoms, bonds, cells and the Structure container."""

from __future__ import annotations

import math
import os
from typing import Literal

import numpy as np
from ase.data import atomic_numbers, chemical_symbols
from pydantic import Field, field_validator, model_validator

from atomscope.model.common import Mat3, Provenance, Quantity, StrictModel, Vec3
from atomscope.model.constraints import Constraint
from atomscope.units import Unit

BondOrder = Literal[1, 2, 3]


def new_uid() -> str:
    """Short random identifier used for atoms and structures: 48 random bits as 12 hex digits.

    ``uuid.uuid4().hex[:12]`` produced the same 48 bits but built a UUID object first, which
    cost 0.23 s of the 0.93 s spent reading a 1e5-atom file (docs/performance.md).
    """
    return os.urandom(6).hex()


class Atom(StrictModel):
    """One atom. Positions are Cartesian in Å."""

    element: str = Field(description="chemical symbol, e.g. 'C'")
    position: Vec3
    formal_charge: int = 0
    label: str | None = None
    uid: str = Field(default_factory=new_uid, description="stable id surviving re-indexing")

    @field_validator("element")
    @classmethod
    def _valid_element(cls, v: str) -> str:
        if v not in atomic_numbers or v == "X":
            msg = f"unknown element symbol {v!r}"
            raise ValueError(msg)
        return v

    @field_validator("position")
    @classmethod
    def _finite(cls, v: Vec3) -> Vec3:
        if not all(math.isfinite(x) for x in v):
            msg = "position must be finite"
            raise ValueError(msg)
        return v

    @property
    def atomic_number(self) -> int:
        return int(atomic_numbers[self.element])


class Bond(StrictModel):
    """A bond between two atom indices of the owning structure."""

    a: int = Field(ge=0)
    b: int = Field(ge=0)
    order: BondOrder = 1
    aromatic: bool = False

    @model_validator(mode="after")
    def _distinct(self) -> Bond:
        if self.a == self.b:
            msg = "bond endpoints must differ"
            raise ValueError(msg)
        return self

    def key(self) -> tuple[int, int]:
        return (self.a, self.b) if self.a < self.b else (self.b, self.a)


class Cell(StrictModel):
    """Periodic cell: three lattice vectors (Å) and periodicity flags."""

    vectors: Mat3
    pbc: tuple[bool, bool, bool] = (True, True, True)

    @field_validator("vectors")
    @classmethod
    def _finite(cls, v: Mat3) -> Mat3:
        if not all(math.isfinite(x) for row in v for x in row):
            msg = "cell vectors must be finite"
            raise ValueError(msg)
        return v

    def volume(self) -> float:
        return float(abs(np.linalg.det(np.array(self.vectors))))

    def lengths_angles(self) -> tuple[Vec3, Vec3]:
        m = np.array(self.vectors)
        lengths = np.linalg.norm(m, axis=1)

        def ang(i: int, j: int) -> float:
            c = float(np.dot(m[i], m[j]) / (lengths[i] * lengths[j]))
            return math.degrees(math.acos(max(-1.0, min(1.0, c))))

        return (
            (float(lengths[0]), float(lengths[1]), float(lengths[2])),
            (ang(1, 2), ang(0, 2), ang(0, 1)),
        )


class AtomicScalarProperty(StrictModel):
    """One float per atom (partial charges, magnetic moments, ...)."""

    values: list[float]
    unit: Unit
    description: str = ""


class AtomicVectorProperty(StrictModel):
    """One 3-vector per atom (forces, velocities, magnetic moment vectors, ...)."""

    values: list[Vec3]
    unit: Unit
    description: str = ""


class Residue(StrictModel):
    """Residue/chain information for biomolecules."""

    name: str
    number: int
    chain: str = ""
    atom_indices: list[int]


def _raise_bond_error(bonds: list[Bond], n: int) -> None:
    """Find the offending bond and raise; only reached when the vectorised check fails."""
    seen: set[tuple[int, int]] = set()
    for bond in bonds:
        if bond.a >= n or bond.b >= n:
            msg = f"bond ({bond.a},{bond.b}) references atom outside 0..{n - 1}"
            raise ValueError(msg)
        k = bond.key()
        if k in seen:
            msg = f"duplicate bond {k}"
            raise ValueError(msg)
        seen.add(k)


def _check_bonds(bonds: list[Bond], n: int) -> None:
    """Every bond index inside 0..n-1 and no unordered pair twice.

    Vectorised because this runs on every construction *and* every attribute assignment
    (``validate_assignment``): a 1e5-atom crystal has ~6e5 bonds and the element-wise loop cost
    around half a second each time. Bond endpoints are non-negative by field constraint.
    """
    if not bonds:
        return
    a = np.fromiter((b.a for b in bonds), dtype=np.int64, count=len(bonds))
    b = np.fromiter((b.b for b in bonds), dtype=np.int64, count=len(bonds))
    hi = np.maximum(a, b)
    if int(hi.max()) >= n:
        _raise_bond_error(bonds, n)
    keys = np.minimum(a, b) * n + hi
    if np.unique(keys).size != keys.size:
        _raise_bond_error(bonds, n)


class Structure(StrictModel):
    """The central editable object: atoms, bonds, cell and attached properties."""

    id: str = Field(default_factory=new_uid)
    name: str = "untitled"
    atoms: list[Atom] = Field(default_factory=list)
    bonds: list[Bond] = Field(default_factory=list)
    cell: Cell | None = None
    charge: float = Field(default=0.0, description="total charge in e")
    multiplicity: int | None = Field(default=None, ge=1, description="2S+1; None = unspecified")
    atomic_scalars: dict[str, AtomicScalarProperty] = Field(default_factory=dict)
    atomic_vectors: dict[str, AtomicVectorProperty] = Field(default_factory=dict)
    properties: dict[str, Quantity] = Field(default_factory=dict)
    constraints: list[Constraint] = Field(default_factory=list)
    residues: list[Residue] = Field(default_factory=list)
    provenance: Provenance | None = None

    @model_validator(mode="after")
    def _consistent(self) -> Structure:
        n = len(self.atoms)
        _check_bonds(self.bonds, n)
        lengths = {k: len(v.values) for k, v in self.atomic_scalars.items()}
        lengths.update({k: len(v.values) for k, v in self.atomic_vectors.items()})
        for name, count in lengths.items():
            if count != n:
                msg = f"atomic property {name!r} has {count} values for {n} atoms"
                raise ValueError(msg)
        for res in self.residues:
            if any(i >= n or i < 0 for i in res.atom_indices):
                msg = f"residue {res.name}{res.number} references atom outside range"
                raise ValueError(msg)
        for c in self.constraints:
            for i in c.referenced_atoms():
                if i >= n or i < 0:
                    msg = f"constraint {c.kind} references atom {i} outside range"
                    raise ValueError(msg)
        uids = [a.uid for a in self.atoms]
        if len(set(uids)) != len(uids):
            msg = "atom uids must be unique"
            raise ValueError(msg)
        return self

    # ---- convenience ---------------------------------------------------------------------
    @property
    def n_atoms(self) -> int:
        return len(self.atoms)

    def positions(self) -> np.ndarray:
        """(N,3) float64 array of positions in Å."""
        if not self.atoms:
            return np.zeros((0, 3))
        return np.array([a.position for a in self.atoms], dtype=float)

    def symbols(self) -> list[str]:
        return [a.element for a in self.atoms]

    def numbers(self) -> np.ndarray:
        return np.array([atomic_numbers[a.element] for a in self.atoms], dtype=int)

    def formula(self) -> str:
        """Hill-order chemical formula (C, H first, then alphabetical)."""
        counts: dict[str, int] = {}
        for s in self.symbols():
            counts[s] = counts.get(s, 0) + 1
        order = sorted(counts)
        if "C" in counts:
            order = (
                ["C"]
                + (["H"] if "H" in counts else [])
                + sorted(s for s in counts if s not in ("C", "H"))
            )
        return "".join(f"{s}{counts[s] if counts[s] > 1 else ''}" for s in order)

    def is_periodic(self) -> bool:
        return self.cell is not None and any(self.cell.pbc)


__all__ = [
    "Atom",
    "AtomicScalarProperty",
    "AtomicVectorProperty",
    "Bond",
    "BondOrder",
    "Cell",
    "Residue",
    "Structure",
    "chemical_symbols",
    "new_uid",
]
