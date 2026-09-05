"""Lossless conversion between :class:`atomscope.model.Structure` and :class:`ase.Atoms`.

ASE natively represents symbols, positions, cell, pbc, constraints, initial charges and initial
magnetic moments. Everything else Atomscope needs (bonds, formal charges, labels, atom uids,
residues, total charge, multiplicity, named properties) is stored in ``atoms.info["atomscope"]``
as plain JSON-compatible data, which ASE copies along with the Atoms object and which
``ase.io`` writers such as extxyz/json preserve.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from ase import Atoms
from ase.data import atomic_numbers
from ase.constraints import FixAtoms as AseFixAtoms
from ase.constraints import FixBondLengths as AseFixBondLengths
from ase.constraints import FixCartesian as AseFixCartesian

from atomscope.model import (
    Atom,
    AtomicScalarProperty,
    AtomicVectorProperty,
    Bond,
    Cell,
    Constraint,
    FixAtoms,
    FixBondLength,
    FixCartesian,
    Provenance,
    Quantity,
    Residue,
    Structure,
    new_uid,
)
from atomscope.units import Unit

INFO_KEY = "atomscope"
_BOND_FIELDS = tuple(Bond.model_fields)
INITIAL_CHARGES_PROPERTY = "initial_charges"
INITIAL_MAGMOMS_PROPERTY = "initial_magmoms"


def _vec3(v: Any) -> tuple[float, float, float]:
    return (float(v[0]), float(v[1]), float(v[2]))


def to_atoms(structure: Structure) -> Atoms:
    """Build an ``ase.Atoms`` carrying all information of ``structure``."""
    atoms = Atoms(
        symbols=structure.symbols(),
        positions=structure.positions(),
    )
    if structure.cell is not None:
        atoms.set_cell(np.array(structure.cell.vectors))
        atoms.set_pbc(list(structure.cell.pbc))
    if INITIAL_CHARGES_PROPERTY in structure.atomic_scalars:
        atoms.set_initial_charges(structure.atomic_scalars[INITIAL_CHARGES_PROPERTY].values)
    if INITIAL_MAGMOMS_PROPERTY in structure.atomic_scalars:
        atoms.set_initial_magnetic_moments(
            structure.atomic_scalars[INITIAL_MAGMOMS_PROPERTY].values
        )
    atoms.set_constraint(_constraints_to_ase(structure.constraints))

    extra: dict[str, Any] = {
        "id": structure.id,
        "name": structure.name,
        "charge": structure.charge,
        "multiplicity": structure.multiplicity,
        "uids": [a.uid for a in structure.atoms],
        "labels": [a.label for a in structure.atoms],
        "formal_charges": [a.formal_charge for a in structure.atoms],
        # model_dump() per bond costs ~0.8 s for a 1e5-atom crystal; the fields are plain
        # scalars, so read them directly (still driven by the model's field list).
        "bonds": [{f: getattr(b, f) for f in _BOND_FIELDS} for b in structure.bonds],
        "residues": [r.model_dump() for r in structure.residues],
        "properties": {k: v.model_dump() for k, v in structure.properties.items()},
        "atomic_scalars": {k: v.model_dump() for k, v in structure.atomic_scalars.items()},
        "atomic_vectors": {k: v.model_dump() for k, v in structure.atomic_vectors.items()},
        "provenance": structure.provenance.model_dump(mode="json")
        if structure.provenance
        else None,
    }
    atoms.info[INFO_KEY] = extra
    return atoms


def from_atoms(atoms: Atoms, *, name: str | None = None) -> Structure:
    """Build a Structure from ``atoms``, restoring Atomscope data from ``atoms.info`` if present."""
    extra: dict[str, Any] = dict(atoms.info.get(INFO_KEY) or {})
    n = len(atoms)
    uids = extra.get("uids") or [None] * n
    labels = extra.get("labels") or [None] * n
    formal = extra.get("formal_charges") or [0] * n
    symbols = atoms.get_chemical_symbols()
    positions = atoms.get_positions()

    # Atom's own validators run once per atom, which dominates every large file read. The same
    # two invariants are checked here in bulk (once per array) and the models are then built
    # without re-validating; Atom itself is untouched, so every other code path still validates.
    if not np.isfinite(positions).all():
        msg = "position must be finite"
        raise ValueError(msg)
    unknown = sorted({s for s in set(symbols) if s == "X" or s not in atomic_numbers})
    if unknown:
        msg = f"unknown element symbol {unknown[0]!r}"
        raise ValueError(msg)
    if any(lab is not None and not isinstance(lab, str) for lab in labels):
        msg = "atom labels must be strings or None"
        raise ValueError(msg)
    atom_models = [
        Atom.model_construct(
            element=symbols[i],
            position=(p[0], p[1], p[2]),
            formal_charge=int(formal[i]),
            label=labels[i],
            uid=uids[i] or new_uid(),
        )
        for i, p in enumerate(positions.tolist())
    ]

    cell = None
    if atoms.cell.rank > 0 or any(atoms.pbc):
        c = np.array(atoms.cell)
        cell = Cell(
            vectors=(_vec3(c[0]), _vec3(c[1]), _vec3(c[2])),
            pbc=(bool(atoms.pbc[0]), bool(atoms.pbc[1]), bool(atoms.pbc[2])),
        )

    atomic_scalars = {
        k: AtomicScalarProperty.model_validate(v)
        for k, v in extra.get("atomic_scalars", {}).items()
    }
    if atoms.has("initial_charges") and INITIAL_CHARGES_PROPERTY not in atomic_scalars:
        atomic_scalars[INITIAL_CHARGES_PROPERTY] = AtomicScalarProperty(
            values=[float(x) for x in atoms.get_initial_charges()],
            unit=Unit.ELEMENTARY_CHARGE,
            description="initial (guess) charges",
        )
    if atoms.has("initial_magmoms") and INITIAL_MAGMOMS_PROPERTY not in atomic_scalars:
        atomic_scalars[INITIAL_MAGMOMS_PROPERTY] = AtomicScalarProperty(
            values=[float(x) for x in atoms.get_initial_magnetic_moments()],
            unit=Unit.BOHR_MAGNETON,
            description="initial magnetic moments",
        )
    atomic_vectors = {
        k: AtomicVectorProperty.model_validate(v)
        for k, v in extra.get("atomic_vectors", {}).items()
    }

    kwargs2: dict[str, Any] = {
        "name": name or extra.get("name") or "untitled",
        "atoms": atom_models,
        "bonds": [Bond.model_validate(b) for b in extra.get("bonds", [])],
        "cell": cell,
        "charge": float(extra.get("charge", 0.0)),
        "multiplicity": extra.get("multiplicity"),
        "atomic_scalars": atomic_scalars,
        "atomic_vectors": atomic_vectors,
        "properties": {
            k: Quantity.model_validate(v) for k, v in extra.get("properties", {}).items()
        },
        "constraints": _constraints_from_ase(atoms),
        "residues": [Residue.model_validate(r) for r in extra.get("residues", [])],
    }
    if extra.get("id"):
        kwargs2["id"] = extra["id"]
    if extra.get("provenance"):
        kwargs2["provenance"] = Provenance.model_validate(extra["provenance"])
    return Structure(**kwargs2)


def _constraints_to_ase(constraints: list[Constraint]) -> list[Any]:
    out: list[Any] = []
    fixed: list[int] = []
    pairs: list[tuple[int, int]] = []
    for c in constraints:
        if isinstance(c, FixAtoms):
            fixed.extend(c.indices)
        elif isinstance(c, FixCartesian):
            out.append(AseFixCartesian(c.index, mask=list(c.mask)))
        elif isinstance(c, FixBondLength):
            pairs.append((c.a, c.b))
    if fixed:
        out.append(AseFixAtoms(indices=sorted(set(fixed))))
    if pairs:
        out.append(AseFixBondLengths(pairs))
    return out


def _constraints_from_ase(atoms: Atoms) -> list[Constraint]:
    out: list[Constraint] = []
    for c in atoms.constraints:
        if isinstance(c, AseFixAtoms):
            out.append(FixAtoms(indices=[int(i) for i in c.index]))
        elif isinstance(c, AseFixCartesian):
            # ASE 3.26 stores the mask as given (True = fixed component).
            for idx in np.atleast_1d(c.index):
                m = tuple(bool(x) for x in c.mask)
                out.append(FixCartesian(index=int(idx), mask=(m[0], m[1], m[2])))
        elif isinstance(c, AseFixBondLengths):
            for a, b in c.pairs:
                out.append(FixBondLength(a=int(a), b=int(b)))
    return out
