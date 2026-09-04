"""Open Babel fallback reader/writer (long tail of formats, e.g. CML)."""

from __future__ import annotations

from pathlib import Path

from openbabel import openbabel as ob

from atomscope.model import Atom, Bond, Structure

_ELEMENT_TABLE = ob.OBElementTable() if hasattr(ob, "OBElementTable") else None


def _symbol(z: int) -> str:
    if _ELEMENT_TABLE is not None:
        return str(_ELEMENT_TABLE.GetSymbol(z))
    return str(ob.GetSymbol(z))


def read(path: Path, fmt: str) -> Structure:
    conv = ob.OBConversion()
    if not conv.SetInFormat(fmt):
        msg = f"Open Babel does not know format {fmt}"
        raise ValueError(msg)
    mol = ob.OBMol()
    if not conv.ReadFile(mol, str(path)):
        msg = f"Open Babel could not read {path.name}"
        raise ValueError(msg)
    atoms = [
        Atom(
            element=_symbol(a.GetAtomicNum()),
            position=(a.GetX(), a.GetY(), a.GetZ()),
            formal_charge=a.GetFormalCharge(),
        )
        for a in ob.OBMolAtomIter(mol)
    ]
    bonds = [
        Bond(
            a=b.GetBeginAtomIdx() - 1,
            b=b.GetEndAtomIdx() - 1,
            order=min(3, max(1, b.GetBondOrder())),
            aromatic=bool(b.IsAromatic()),
        )
        for b in ob.OBMolBondIter(mol)
    ]
    return Structure(name=path.stem, atoms=atoms, bonds=bonds, charge=float(mol.GetTotalCharge()))


def write(structure: Structure, path: Path, fmt: str) -> None:
    conv = ob.OBConversion()
    if not conv.SetOutFormat(fmt):
        msg = f"Open Babel does not know format {fmt}"
        raise ValueError(msg)
    mol = ob.OBMol()
    for a in structure.atoms:
        oa = mol.NewAtom()
        oa.SetAtomicNum(a.atomic_number)
        oa.SetVector(*a.position)
        oa.SetFormalCharge(a.formal_charge)
    for b in structure.bonds:
        mol.AddBond(b.a + 1, b.b + 1, b.order)
    mol.SetTitle(structure.name)
    if not conv.WriteFile(mol, str(path)):
        msg = f"Open Babel could not write {path.name}"
        raise ValueError(msg)
