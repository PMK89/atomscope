"""Structure <-> Open Babel ``OBMol`` conversion shared by the chemistry services.

Open Babel plugins (force fields, charge models) are process-wide singletons, so every call
into them must hold :data:`OB_LOCK`; FastAPI runs synchronous routes in a thread pool.

Aromatic bonds are stored in the data model as ``order=1, aromatic=True`` (RDKit convention).
Open Babel needs Kekulé orders for implicit-hydrogen counts and force-field typing, so bonds are
kekulized through RDKit before the OBMol is built; when RDKit cannot sanitize the input the stored
orders are used unchanged.
"""

from __future__ import annotations

import threading

import numpy as np
from openbabel import openbabel as ob
from rdkit import Chem

from atomscope.model import Atom, Bond, Structure
from atomscope.model.common import Vec3

OB_LOCK = threading.RLock()

_RD_ORDER = {1: Chem.BondType.SINGLE, 2: Chem.BondType.DOUBLE, 3: Chem.BondType.TRIPLE}
_INT_ORDER = {Chem.BondType.SINGLE: 1, Chem.BondType.DOUBLE: 2, Chem.BondType.TRIPLE: 3}


def kekulized_orders(structure: Structure) -> list[int]:
    """Bond orders with aromatic bonds resolved to a Kekulé structure (falls back to stored)."""
    stored: list[int] = [b.order for b in structure.bonds]
    if not any(b.aromatic for b in structure.bonds):
        return stored
    rw = Chem.RWMol()
    for a in structure.atoms:
        ra = Chem.Atom(a.element)
        ra.SetFormalCharge(a.formal_charge)
        ra.SetNoImplicit(True)
        rw.AddAtom(ra)
    for b in structure.bonds:
        rw.AddBond(b.a, b.b, Chem.BondType.AROMATIC if b.aromatic else _RD_ORDER[b.order])
        if b.aromatic:
            rw.GetBondBetweenAtoms(b.a, b.b).SetIsAromatic(True)
            rw.GetAtomWithIdx(b.a).SetIsAromatic(True)
            rw.GetAtomWithIdx(b.b).SetIsAromatic(True)
    mol = rw.GetMol()
    try:
        Chem.SanitizeMol(mol)
        Chem.Kekulize(mol, clearAromaticFlags=True)
    except Exception:  # noqa: BLE001 - RDKit raises several unrelated exception types
        return stored
    return [_INT_ORDER.get(mol.GetBondWithIdx(i).GetBondType(), 1) for i in range(len(stored))]


def to_obmol(structure: Structure, *, implicit_hydrogens: bool = False) -> ob.OBMol:
    """Build an OBMol (atoms, kekulized bonds, formal and total charge).

    ``implicit_hydrogens`` assigns typical implicit-hydrogen counts so that ``AddHydrogens``
    knows how many to add; leave it off for force-field or charge evaluation of complete
    molecules.
    """
    mol = ob.OBMol()
    mol.BeginModify()
    for a in structure.atoms:
        oa = mol.NewAtom()
        oa.SetAtomicNum(a.atomic_number)
        oa.SetVector(*a.position)
        oa.SetFormalCharge(a.formal_charge)
    for b, order in zip(structure.bonds, kekulized_orders(structure), strict=True):
        mol.AddBond(b.a + 1, b.b + 1, order)
    mol.EndModify()
    mol.SetDimension(3)
    mol.SetTotalCharge(int(round(structure.charge)))
    if structure.multiplicity is not None:
        mol.SetTotalSpinMultiplicity(structure.multiplicity)
    if implicit_hydrogens:
        for oa in ob.OBMolAtomIter(mol):
            ob.OBAtomAssignTypicalImplicitHydrogens(oa)
    mol.SetTitle(structure.name)
    return mol


def positions_from_obmol(mol: ob.OBMol) -> np.ndarray:
    return np.array([(a.GetX(), a.GetY(), a.GetZ()) for a in ob.OBMolAtomIter(mol)], dtype=float)


def with_positions(structure: Structure, positions: np.ndarray) -> Structure:
    """Copy of ``structure`` with new Cartesian positions (same atoms, bonds and metadata)."""
    atoms = [
        a.model_copy(update={"position": (float(p[0]), float(p[1]), float(p[2]))})
        for a, p in zip(structure.atoms, positions, strict=True)
    ]
    return structure.model_copy(update={"atoms": atoms})


def from_obmol(mol: ob.OBMol, template: Structure) -> Structure:
    """Rebuild a Structure from an OBMol derived from ``template``.

    The first ``len(template.atoms)`` OB atoms are assumed to be the template atoms in order
    (their uids and labels are kept); additional atoms are new. Per-atom data, constraints and
    residues are dropped when the atom count changed, because they can no longer be aligned.
    """
    atoms: list[Atom] = []
    for i, oa in enumerate(ob.OBMolAtomIter(mol)):
        pos: Vec3 = (oa.GetX(), oa.GetY(), oa.GetZ())
        if i < len(template.atoms):
            t = template.atoms[i]
            atoms.append(
                t.model_copy(
                    update={
                        "element": ob.GetSymbol(oa.GetAtomicNum()),
                        "position": pos,
                        "formal_charge": oa.GetFormalCharge(),
                    }
                )
            )
        else:
            atoms.append(
                Atom(
                    element=ob.GetSymbol(oa.GetAtomicNum()),
                    position=pos,
                    formal_charge=oa.GetFormalCharge(),
                )
            )
    bonds = [
        Bond(
            a=b.GetBeginAtomIdx() - 1,
            b=b.GetEndAtomIdx() - 1,
            order=min(3, max(1, b.GetBondOrder())),
            aromatic=bool(b.IsAromatic()),
        )
        for b in ob.OBMolBondIter(mol)
    ]
    bonds.sort(key=lambda b: b.key())
    same_count = len(atoms) == len(template.atoms)
    return Structure(
        id=template.id,
        name=template.name,
        atoms=atoms,
        bonds=bonds,
        cell=template.cell,
        charge=float(mol.GetTotalCharge()),
        multiplicity=template.multiplicity,
        atomic_scalars=template.atomic_scalars if same_count else {},
        atomic_vectors=template.atomic_vectors if same_count else {},
        properties=template.properties,
        constraints=template.constraints if same_count else [],
        residues=template.residues if same_count else [],
        provenance=template.provenance,
    )
