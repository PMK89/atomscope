"""Helpers shared by the crystal operations: Structure <-> Atoms plumbing."""

from __future__ import annotations

from ase import Atoms

from atomscope.ase_bridge.convert import INFO_KEY, from_atoms, to_atoms
from atomscope.chem.bonds import perceive_bonds
from atomscope.model import Structure


def require_cell(structure: Structure) -> Atoms:
    """Convert to ASE Atoms, raising ``ValueError`` when the structure has no cell."""
    if structure.cell is None:
        msg = "structure has no unit cell"
        raise ValueError(msg)
    return to_atoms(structure)


def same_atoms(structure: Structure, atoms: Atoms) -> Structure:
    """Rebuild ``structure`` from ``atoms`` after an operation that kept atom count and order.

    Uids, labels, bonds, properties and constraints are carried through ``atoms.info``.
    """
    return from_atoms(atoms, name=structure.name)


def new_atoms(structure: Structure, atoms: Atoms, name: str | None = None) -> Structure:
    """Rebuild after an operation that changed the set of atoms (supercell, fill, primitive...).

    Per-atom data of the input cannot be mapped onto the new atoms, so it is dropped and bonds
    are re-perceived from distances (periodic minimum image aware).
    """
    atoms.info.pop(INFO_KEY, None)
    atoms.set_constraint()
    out = from_atoms(atoms, name=name or structure.name)
    out.id = structure.id
    out.charge = structure.charge
    out.multiplicity = structure.multiplicity
    out.provenance = structure.provenance
    out.bonds = perceive_bonds(out)
    return out
