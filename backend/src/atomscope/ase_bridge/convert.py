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
from ase.constraints import FixAtoms as AseFixAtoms
from ase.constraints import FixBondLengths as AseFixBondLengths
from ase.constraints import FixCartesian as AseFixCartesian
from ase.constraints import FixInternals as AseFixInternals
from pydantic import TypeAdapter

from atomscope.model import (
    Atom,
    AtomicScalarProperty,
    AtomicVectorProperty,
    Bond,
    Cell,
    Constraint,
    FixAngle,
    FixAtoms,
    FixBondLength,
    FixCartesian,
    FixDihedral,
    Provenance,
    Quantity,
    Residue,
    Structure,
    SurfaceInfo,
)
from atomscope.units import Unit

INFO_KEY = "atomscope"
#: ASE's own key for the named adsorption sites of a slab (`ase.build.add_adsorbate`).
ADSORBATE_KEY = "adsorbate_info"
_CONSTRAINT_ADAPTER: TypeAdapter[Constraint] = TypeAdapter(Constraint)
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
        # ASE cannot express every constraint kind (an ignored atom has no ASE meaning), so the
        # list travels verbatim as well and is what a round trip reads back
        "constraints": [c.model_dump(mode="json") for c in structure.constraints],
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
    if structure.surface is not None:
        # ASE's own key, not ours: `ase.build.add_adsorbate` reads exactly this, so a structure
        # that has been through a project file still knows where its sites are
        info: dict[str, Any] = {
            "cell": np.array(structure.surface.cell, dtype=float),
            "sites": {k: tuple(v) for k, v in structure.surface.sites.items()},
        }
        if structure.surface.top_layer_atom_index is not None:
            info["top layer atom index"] = structure.surface.top_layer_atom_index
        atoms.info[ADSORBATE_KEY] = info
    return atoms


def _pdb_labels(atoms: Atoms, n: int) -> list[str | None]:
    """PDB atom names (``CA``, ``OD1``) from ASE's reader, which keeps them in an array."""
    if not atoms.has("atomtypes"):
        return [None] * n
    return [str(t).strip() or None for t in atoms.arrays["atomtypes"]]


def _pdb_residues(atoms: Atoms) -> list[Residue]:
    """Residues from ASE's PDB arrays. Consecutive atoms of one residue form one entry, so a
    residue number reused by a second chain does not merge the two."""
    if not (atoms.has("residuenames") and atoms.has("residuenumbers")):
        return []
    names = [str(x).strip() for x in atoms.arrays["residuenames"]]
    numbers = [int(x) for x in atoms.arrays["residuenumbers"]]
    residues: list[Residue] = []
    for i, (name, number) in enumerate(zip(names, numbers, strict=True)):
        if residues and residues[-1].name == name and residues[-1].number == number:
            residues[-1].atom_indices.append(i)
        else:
            residues.append(Residue(name=name, number=number, atom_indices=[i]))
    return residues


def _per_atom(value: Any, n: int, fallback: list[Any]) -> list[Any]:  # noqa: ANN401
    """Per-atom data from ``info``, or ``fallback`` when it does not fit the atoms present.

    ``ase.Atoms.extend`` (which is what ``slab += adsorbate`` and `add_adsorbate` do) copies
    neither ``info`` nor the other object's per-atom data, so the combined object carries the
    *first* one's lists against a longer set of atoms. Reading them positionally then walked off
    the end with an ``IndexError``. Per-atom data that cannot belong to these atoms is dropped,
    which is what `crystal._common.new_atoms` does deliberately for the same reason.
    """
    return list(value) if isinstance(value, (list, tuple)) and len(value) == n else fallback


def from_atoms(atoms: Atoms, *, name: str | None = None) -> Structure:
    """Build a Structure from ``atoms``, restoring Atomscope data from ``atoms.info`` if present."""
    extra: dict[str, Any] = dict(atoms.info.get(INFO_KEY) or {})
    n = len(atoms)
    uids = _per_atom(extra.get("uids"), n, [None] * n)
    labels = _per_atom(extra.get("labels"), n, _pdb_labels(atoms, n))
    formal = _per_atom(extra.get("formal_charges"), n, [0] * n)
    symbols = atoms.get_chemical_symbols()
    positions = atoms.get_positions()

    # One tolist() instead of three float() calls per atom; the models themselves are still
    # validated one by one, which measurement showed to be the irreducible part of the cost
    # (model_construct is no faster -- see docs/performance.md).
    atom_models = []
    for i, p in enumerate(positions.tolist()):
        kwargs: dict[str, Any] = {
            "element": symbols[i],
            "position": (p[0], p[1], p[2]),
            "formal_charge": int(formal[i]),
            "label": labels[i],
        }
        if uids[i]:
            kwargs["uid"] = uids[i]
        atom_models.append(Atom(**kwargs))

    cell = None
    if atoms.cell.rank > 0 or any(atoms.pbc):
        c = np.array(atoms.cell)
        cell = Cell(
            vectors=(_vec3(c[0]), _vec3(c[1]), _vec3(c[2])),
            pbc=(bool(atoms.pbc[0]), bool(atoms.pbc[1]), bool(atoms.pbc[2])),
        )

    # the same length rule as the per-atom lists: a property of twelve atoms says nothing about
    # fourteen, and Structure's own validator would refuse the whole conversion
    atomic_scalars = {
        k: AtomicScalarProperty.model_validate(v)
        for k, v in extra.get("atomic_scalars", {}).items()
        if len(v.get("values", ())) == n
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
        if len(v.get("values", ())) == n
    }

    kwargs2: dict[str, Any] = {
        "name": name or extra.get("name") or "untitled",
        "atoms": atom_models,
        # a bond of the atoms that were there, kept only while both ends still are
        "bonds": [
            Bond.model_validate(b)
            for b in extra.get("bonds", [])
            if b.get("a", n) < n and b.get("b", n) < n
        ],
        "cell": cell,
        "charge": float(extra.get("charge", 0.0)),
        "multiplicity": extra.get("multiplicity"),
        "atomic_scalars": atomic_scalars,
        "atomic_vectors": atomic_vectors,
        "properties": {
            k: Quantity.model_validate(v) for k, v in extra.get("properties", {}).items()
        },
        # a document written by Atomscope carries its constraints losslessly; anything else
        # (a POSCAR, someone else's .traj) only has what ASE could express
        "constraints": [
            _CONSTRAINT_ADAPTER.validate_python(c) for c in extra.get("constraints", [])
        ]
        or _constraints_from_ase(atoms),
        "residues": [
            Residue.model_validate(r)
            for r in extra.get("residues", [])
            if all(i < n for i in r.get("atom_indices", (n,)))
        ]
        or _pdb_residues(atoms),
    }
    if extra.get("id"):
        kwargs2["id"] = extra["id"]
    if extra.get("provenance"):
        kwargs2["provenance"] = Provenance.model_validate(extra["provenance"])
    surface = _surface_from_ase(atoms)
    if surface is not None:
        kwargs2["surface"] = surface
    return Structure(**kwargs2)


def _surface_from_ase(atoms: Atoms) -> SurfaceInfo | None:
    """Read ASE's ``adsorbate_info`` back, if the Atoms has one.

    Anything `ase.build`'s named surface builders produced has it; anything else has not, and a
    dict without a cell is not usable, so it is dropped rather than guessed at.
    """
    info = atoms.info.get(ADSORBATE_KEY)
    if not isinstance(info, dict) or info.get("cell") is None:
        return None
    cell = np.asarray(info["cell"], dtype=float)
    if cell.shape != (2, 2):
        return None
    sites = {
        str(name): (float(pos[0]), float(pos[1])) for name, pos in (info.get("sites") or {}).items()
    }
    top = info.get("top layer atom index")
    return SurfaceInfo(
        cell=((cell[0][0], cell[0][1]), (cell[1][0], cell[1][1])),
        sites=sites,
        top_layer_atom_index=int(top) if top is not None else None,
    )


def _constraints_to_ase(constraints: list[Constraint]) -> list[Any]:
    """The subset ASE understands. ``IgnoreAtoms`` has no ASE counterpart and is left out."""
    out: list[Any] = []
    fixed: list[int] = []
    pairs: list[tuple[int, int]] = []
    # ASE's FixInternals holds a target value (None = whatever the geometry has now)
    bonds: list[list[Any]] = []
    angles: list[list[Any]] = []
    dihedrals: list[list[Any]] = []
    for c in constraints:
        if isinstance(c, FixAtoms):
            fixed.extend(c.indices)
        elif isinstance(c, FixCartesian):
            out.append(AseFixCartesian(c.index, mask=list(c.mask)))
        elif isinstance(c, FixBondLength):
            if c.value is None:
                pairs.append((c.a, c.b))
            else:
                bonds.append([c.value, [c.a, c.b]])
        elif isinstance(c, FixAngle):
            angles.append([c.value, [c.a, c.b, c.c]])
        elif isinstance(c, FixDihedral):
            dihedrals.append([c.value, [c.a, c.b, c.c, c.d]])
    if fixed:
        out.append(AseFixAtoms(indices=sorted(set(fixed))))
    if pairs:
        out.append(AseFixBondLengths(pairs))
    if bonds or angles or dihedrals:
        out.append(
            AseFixInternals(
                bonds=bonds or None,
                angles_deg=angles or None,
                dihedrals_deg=dihedrals or None,
            )
        )
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
        elif isinstance(c, AseFixInternals):
            out.extend(_internals_from_ase(c))
    return out


def _internals_from_ase(c: AseFixInternals) -> list[Constraint]:
    """Bond, angle and dihedral targets out of an ASE ``FixInternals``."""
    out: list[Constraint] = []
    for value, idx in c.bonds or []:
        out.append(FixBondLength(a=int(idx[0]), b=int(idx[1]), value=_target(value)))
    for value, idx in c.angles or []:
        out.append(
            FixAngle(a=int(idx[0]), b=int(idx[1]), c=int(idx[2]), value=_target(value)),
        )
    for value, idx in c.dihedrals or []:
        out.append(
            FixDihedral(
                a=int(idx[0]),
                b=int(idx[1]),
                c=int(idx[2]),
                d=int(idx[3]),
                value=_target(value),
            )
        )
    return out


def _target(value: Any) -> float | None:
    return None if value is None else float(value)
