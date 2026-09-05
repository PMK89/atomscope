"""Hydrogen handling and bond perception via Open Babel (the authoritative valence model).

The frontend Draw tool keeps a tiny valence table for latency-free drawing; everything the user
asks for explicitly (Build > Add Hydrogens, pH models, bond-order perception) goes through here.
"""

from __future__ import annotations

from atomscope.chem.obmol import OB_LOCK, from_obmol, to_obmol
from atomscope.model import (
    AtomicScalarProperty,
    AtomicVectorProperty,
    Bond,
    FixAtoms,
    FixBondLength,
    FixCartesian,
    Residue,
    Structure,
)
from atomscope.model.constraints import Constraint


def remove_atoms(structure: Structure, indices: set[int]) -> Structure:
    """Copy of ``structure`` without ``indices``; bonds, per-atom data, constraints and residues
    are re-indexed (constraints touching a removed atom are dropped)."""
    keep = [i for i in range(structure.n_atoms) if i not in indices]
    new_index = {old: new for new, old in enumerate(keep)}
    bonds = [
        Bond(a=new_index[b.a], b=new_index[b.b], order=b.order, aromatic=b.aromatic)
        for b in structure.bonds
        if b.a in new_index and b.b in new_index
    ]
    scalars = {
        k: AtomicScalarProperty(
            values=[v.values[i] for i in keep], unit=v.unit, description=v.description
        )
        for k, v in structure.atomic_scalars.items()
    }
    vectors = {
        k: AtomicVectorProperty(
            values=[v.values[i] for i in keep], unit=v.unit, description=v.description
        )
        for k, v in structure.atomic_vectors.items()
    }
    constraints: list[Constraint] = []
    for c in structure.constraints:
        if any(i not in new_index for i in c.referenced_atoms()):
            if isinstance(c, FixAtoms):
                kept = [new_index[i] for i in c.indices if i in new_index]
                if kept:
                    constraints.append(FixAtoms(indices=kept))
            continue
        if isinstance(c, FixAtoms):
            constraints.append(FixAtoms(indices=[new_index[i] for i in c.indices]))
        elif isinstance(c, FixCartesian):
            constraints.append(FixCartesian(index=new_index[c.index], mask=c.mask))
        elif isinstance(c, FixBondLength):
            constraints.append(FixBondLength(a=new_index[c.a], b=new_index[c.b]))
    residues = []
    for r in structure.residues:
        atoms = [new_index[i] for i in r.atom_indices if i in new_index]
        if atoms:
            residues.append(
                Residue(name=r.name, number=r.number, chain=r.chain, atom_indices=atoms)
            )
    return structure.model_copy(
        update={
            "atoms": [structure.atoms[i] for i in keep],
            "bonds": bonds,
            "atomic_scalars": scalars,
            "atomic_vectors": vectors,
            "constraints": constraints,
            "residues": residues,
        }
    )


def neighbors(structure: Structure) -> list[list[int]]:
    nb: list[list[int]] = [[] for _ in structure.atoms]
    for b in structure.bonds:
        nb[b.a].append(b.b)
        nb[b.b].append(b.a)
    return nb


def hydrogens_of(structure: Structure, indices: set[int] | None = None) -> set[int]:
    """Hydrogen atoms: all, or those in ``indices`` plus those bonded to atoms in ``indices``."""
    nb = neighbors(structure)
    is_h = [a.element == "H" for a in structure.atoms]
    if indices is None:
        return {i for i, h in enumerate(is_h) if h}
    out = {i for i in indices if i < structure.n_atoms and is_h[i]}
    for i in indices:
        if i < structure.n_atoms and not is_h[i]:
            out.update(j for j in nb[i] if is_h[j])
    return out


def remove_hydrogens(structure: Structure, indices: set[int] | None = None) -> Structure:
    return remove_atoms(structure, hydrogens_of(structure, indices))


def add_hydrogens(
    structure: Structure, indices: set[int] | None = None, ph: float | None = None
) -> Structure:
    """Saturate atoms with hydrogens (typical valences). With ``ph`` the molecule is first
    stripped of hydrogens and re-protonated with Open Babel's pH model (whole molecule only)."""
    base = remove_hydrogens(structure) if ph is not None else structure
    with OB_LOCK:
        mol = to_obmol(base, implicit_hydrogens=True)
        if ph is not None:
            mol.AddHydrogens(False, True, float(ph))
        elif indices is None:
            mol.AddHydrogens()
        else:
            for i in sorted(indices):
                if 0 <= i < base.n_atoms:
                    mol.AddHydrogens(mol.GetAtom(i + 1))
        return from_obmol(mol, base)


def perceive_bonds(structure: Structure, *, bond_orders: bool = True) -> Structure:
    """Replace the bond list with Open Babel's ConnectTheDots (+ PerceiveBondOrders)."""
    bare = structure.model_copy(update={"bonds": []})
    with OB_LOCK:
        mol = to_obmol(bare)
        mol.ConnectTheDots()
        if bond_orders:
            mol.PerceiveBondOrders()
        return from_obmol(mol, bare)
