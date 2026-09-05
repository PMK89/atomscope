"""Derived molecular properties: partial charges, dipole moment, aromaticity/rings, identifiers."""

from __future__ import annotations

from typing import Literal

import numpy as np
from openbabel import openbabel as ob
from pydantic import Field
from rdkit import Chem

from atomscope.chem.obmol import OB_LOCK, kekulized_orders, to_obmol
from atomscope.io.rdkit_io import structure_to_mol
from atomscope.model import AtomicScalarProperty, Quantity, Structure
from atomscope.model.common import StrictModel, Vec3
from atomscope.units import Unit, convert

ChargeModel = Literal["gasteiger", "mmff94", "qeq", "eem", "qtpie"]
CHARGE_MODELS: tuple[ChargeModel, ...] = ("gasteiger", "mmff94", "qeq", "eem", "qtpie")
PARTIAL_CHARGES = "partial_charges"
DIPOLE = "dipole_moment"


class Dipole(StrictModel):
    vector: Vec3 = Field(description="Debye")
    magnitude: Quantity


class ChargesResult(StrictModel):
    structure: Structure = Field(description="input with atomic_scalars['partial_charges']")
    model: str
    total_charge: float
    dipole: Dipole


class AromaticityResult(StrictModel):
    structure: Structure = Field(description="input with aromatic flags on bonds")
    ring_count: int
    aromatic_ring_count: int
    aromatic_atoms: list[int]


class AtomTyping(StrictModel):
    """Open Babel's own reading of each atom, from the bonds Atomscope perceived.

    ``types`` is what Avogadro's atom properties table showed in its Type column
    (``OBAtom::GetType()``, propmodel.cpp:936). ``degrees`` and ``valences`` are the two things
    "valence" can mean -- the number of bonds and the sum of their orders -- and are here so a
    caller can check them against its own bond list; Avogadro showed the first
    (``GetValence()`` in Open Babel 2).
    """

    types: list[str] = Field(description="Open Babel internal atom types, e.g. 'Car', 'O3'")
    degrees: list[int] = Field(description="number of bonds at each atom")
    valences: list[float] = Field(description="sum of bond orders at each atom, kekulized")
    perception: str = "openbabel"


class Identifiers(StrictModel):
    smiles: str
    inchi: str
    inchikey: str


def available_charge_models() -> list[str]:
    with OB_LOCK:
        return [m for m in CHARGE_MODELS if ob.OBChargeModel.FindType(m) is not None]


def dipole_from_charges(structure: Structure, charges: list[float]) -> Dipole:
    """Point-charge dipole Σ q_i r_i about the centre of charge-weighted geometry, in Debye."""
    pos = structure.positions()
    q = np.asarray(charges, dtype=float)
    mu = (q[:, None] * pos).sum(axis=0)  # e·Å
    to_debye = convert(1.0, Unit.E_ANGSTROM, Unit.DEBYE)
    v = mu * to_debye
    return Dipole(
        vector=(float(v[0]), float(v[1]), float(v[2])),
        magnitude=Quantity(value=float(np.linalg.norm(v)), unit=Unit.DEBYE),
    )


def atom_types(structure: Structure) -> AtomTyping:
    """Type every atom with Open Babel.

    A type is a function of the current graph, not a measurement, so it is computed on demand
    rather than stored on the structure: an element edited after the fact would leave a stored
    type not stale but wrong.
    """
    if structure.n_atoms == 0:
        msg = "structure has no atoms"
        raise ValueError(msg)
    with OB_LOCK:
        mol = to_obmol(structure)
        atoms = [mol.GetAtom(i + 1) for i in range(structure.n_atoms)]
        return AtomTyping(
            types=[a.GetType() for a in atoms],
            degrees=[a.GetExplicitDegree() for a in atoms],
            valences=[float(a.GetExplicitValence()) for a in atoms],
        )


def partial_charges(structure: Structure, model: ChargeModel = "gasteiger") -> ChargesResult:
    if structure.n_atoms == 0:
        raise ValueError("structure has no atoms")
    with OB_LOCK:
        cm = ob.OBChargeModel.FindType(model)
        if cm is None:
            msg = f"charge model {model!r} is not available"
            raise ValueError(msg)
        mol = to_obmol(structure)
        # Open Babel's Gasteiger seeds the iteration from the stored partial charges, not from
        # formal charges; without this an ammonium ion comes out neutral.
        for oa in ob.OBMolAtomIter(mol):
            oa.SetPartialCharge(float(oa.GetFormalCharge()))
        if not cm.ComputeCharges(mol):
            msg = f"{model} charges could not be computed for {structure.formula()}"
            raise ValueError(msg)
        charges = [float(c) for c in cm.GetPartialCharges()]
    if len(charges) != structure.n_atoms or not all(np.isfinite(charges)):
        msg = f"{model} returned invalid charges"
        raise ValueError(msg)
    dipole = dipole_from_charges(structure, charges)
    out = structure.model_copy(
        update={
            "atomic_scalars": {
                **structure.atomic_scalars,
                PARTIAL_CHARGES: AtomicScalarProperty(
                    values=charges, unit=Unit.ELEMENTARY_CHARGE, description=f"{model} charges"
                ),
            },
            "properties": {**structure.properties, DIPOLE: dipole.magnitude},
        }
    )
    return ChargesResult(
        structure=out, model=model, total_charge=float(sum(charges)), dipole=dipole
    )


def aromaticity(structure: Structure) -> AromaticityResult:
    """Ring (SSSR) and aromaticity perception with Open Babel; flags are copied onto bonds."""
    with OB_LOCK:
        mol = to_obmol(structure)
        rings = mol.GetSSSR()
        ring_count = len(rings)
        aromatic_rings = sum(1 for r in rings if r.IsAromatic())
        arom_bonds = {
            (b.GetBeginAtomIdx() - 1, b.GetEndAtomIdx() - 1)
            for b in ob.OBMolBondIter(mol)
            if b.IsAromatic()
        }
        arom_atoms = sorted(a.GetIdx() - 1 for a in ob.OBMolAtomIter(mol) if a.IsAromatic())
    bonds = [
        b.model_copy(update={"aromatic": (b.a, b.b) in arom_bonds or (b.b, b.a) in arom_bonds})
        for b in structure.bonds
    ]
    return AromaticityResult(
        structure=structure.model_copy(update={"bonds": bonds}),
        ring_count=ring_count,
        aromatic_ring_count=aromatic_rings,
        aromatic_atoms=arom_atoms,
    )


def identifiers(structure: Structure) -> Identifiers:
    """Canonical SMILES (without explicit H) and InChI/InChIKey via RDKit."""
    # Kekulé orders in, RDKit's own aromaticity model out (aromatic flags alone do not survive
    # sanitization when the stored orders are all single).
    kek = structure.model_copy(
        update={
            "bonds": [
                b.model_copy(update={"order": o, "aromatic": False})
                for b, o in zip(structure.bonds, kekulized_orders(structure), strict=True)
            ]
        }
    )
    mol = structure_to_mol(kek)
    try:
        Chem.SanitizeMol(mol)
    except Exception as exc:  # noqa: BLE001 - RDKit raises several exception types
        msg = f"RDKit could not sanitize the structure: {exc}"
        raise ValueError(msg) from exc
    heavy = Chem.RemoveHs(mol, sanitize=False)
    inchi = Chem.MolToInchi(mol)
    return Identifiers(
        smiles=Chem.MolToSmiles(heavy),
        inchi=inchi,
        inchikey=Chem.InchiToInchiKey(inchi) if inchi else "",
    )
