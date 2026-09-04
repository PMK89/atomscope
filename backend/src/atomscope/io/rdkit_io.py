"""RDKit-backed readers/writers for chemistry-rich formats (bond orders, SMILES)."""

from __future__ import annotations

from pathlib import Path

from rdkit import Chem
from rdkit.Chem import AllChem

from atomscope.model import Atom, Bond, Structure

_ORDER_TO_INT = {
    Chem.BondType.SINGLE: 1,
    Chem.BondType.DOUBLE: 2,
    Chem.BondType.TRIPLE: 3,
    Chem.BondType.AROMATIC: 1,
}
_INT_TO_ORDER = {1: Chem.BondType.SINGLE, 2: Chem.BondType.DOUBLE, 3: Chem.BondType.TRIPLE}


def mol_to_structure(mol: Chem.Mol, name: str = "untitled") -> Structure:
    if mol.GetNumConformers() == 0:
        msg = "molecule has no 3D coordinates"
        raise ValueError(msg)
    conf = mol.GetConformer()
    atoms = []
    for a in mol.GetAtoms():
        p = conf.GetAtomPosition(a.GetIdx())
        atoms.append(
            Atom(
                element=a.GetSymbol(),
                position=(float(p.x), float(p.y), float(p.z)),
                formal_charge=int(a.GetFormalCharge()),
            )
        )
    bonds = [
        Bond(
            a=b.GetBeginAtomIdx(),
            b=b.GetEndAtomIdx(),
            order=_ORDER_TO_INT.get(b.GetBondType(), 1),  # type: ignore[arg-type]
            aromatic=bool(b.GetIsAromatic()),
        )
        for b in mol.GetBonds()
    ]
    charge = float(sum(a.GetFormalCharge() for a in mol.GetAtoms()))
    return Structure(name=name, atoms=atoms, bonds=bonds, charge=charge)


def structure_to_mol(structure: Structure) -> Chem.Mol:
    rw = Chem.RWMol()
    for a in structure.atoms:
        ra = Chem.Atom(a.element)
        ra.SetFormalCharge(a.formal_charge)
        ra.SetNoImplicit(True)
        rw.AddAtom(ra)
    for b in structure.bonds:
        rw.AddBond(b.a, b.b, _INT_TO_ORDER[b.order])
        if b.aromatic:
            rw.GetBondBetweenAtoms(b.a, b.b).SetIsAromatic(True)
    mol = rw.GetMol()
    conf = Chem.Conformer(structure.n_atoms)
    for i, a in enumerate(structure.atoms):
        conf.SetAtomPosition(i, a.position)
    mol.AddConformer(conf, assignId=True)
    mol.UpdatePropertyCache(strict=False)
    return mol


def from_smiles(smiles: str, *, add_hydrogens: bool = True, seed: int = 42) -> Structure:
    """Build a 3D structure from SMILES (ETKDG embedding + MMFF/UFF cleanup)."""
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        msg = f"invalid SMILES: {smiles!r}"
        raise ValueError(msg)
    if add_hydrogens:
        mol = Chem.AddHs(mol)
    params = AllChem.ETKDGv3()  # type: ignore[attr-defined]
    params.randomSeed = seed
    if AllChem.EmbedMolecule(mol, params) != 0:  # type: ignore[attr-defined]
        msg = f"could not embed {smiles!r} in 3D"
        raise ValueError(msg)
    if AllChem.MMFFHasAllMoleculeParams(mol):  # type: ignore[attr-defined]
        AllChem.MMFFOptimizeMolecule(mol)  # type: ignore[attr-defined]
    else:
        AllChem.UFFOptimizeMolecule(mol)  # type: ignore[attr-defined]
    return mol_to_structure(mol, name=smiles)


def read(path: Path, fmt: str) -> Structure:
    if fmt in ("mol", "sdf"):
        supplier = Chem.SDMolSupplier(str(path), removeHs=False, sanitize=True)
        mols = [m for m in supplier if m is not None]
        if not mols:
            msg = f"no molecule in {path.name}"
            raise ValueError(msg)
        return mol_to_structure(mols[0], name=path.stem)
    if fmt == "mol2":
        mol = Chem.MolFromMol2File(str(path), removeHs=False)
        if mol is None:
            msg = f"RDKit could not read {path.name}"
            raise ValueError(msg)
        return mol_to_structure(mol, name=path.stem)
    if fmt == "smi":
        first = path.read_text(encoding="utf-8").strip().splitlines()[0].split()[0]
        return from_smiles(first)
    msg = f"rdkit_io cannot read {fmt}"
    raise ValueError(msg)


def write(structure: Structure, path: Path, fmt: str) -> None:
    mol = structure_to_mol(structure)
    if fmt in ("mol", "sdf"):
        mol.SetProp("_Name", structure.name)
        with Chem.SDWriter(str(path)) as w:
            w.write(mol)
        return
    if fmt == "smi":
        path.write_text(Chem.MolToSmiles(Chem.RemoveHs(mol)) + "\n", encoding="utf-8")
        return
    msg = f"rdkit_io cannot write {fmt}"
    raise ValueError(msg)
