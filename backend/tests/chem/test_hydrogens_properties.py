from pathlib import Path

import numpy as np
import pytest
from rdkit import Chem

from atomscope.chem import edits, hydrogens, properties
from atomscope.io.rdkit_io import from_smiles, structure_to_mol
from atomscope.io.registry import structure_from_string
from atomscope.model import (
    Atom,
    Bond,
    FixAngle,
    FixAtoms,
    FixBondLength,
    FixDihedral,
    IgnoreAtoms,
    Structure,
)
from atomscope.units import Unit


def n_h(s: Structure) -> int:
    return sum(1 for a in s.atoms if a.element == "H")


def test_remove_and_add_hydrogens_round_trip_ethanol() -> None:
    s = from_smiles("CCO")
    s.atomic_scalars["x"] = properties.AtomicScalarProperty(
        values=[float(i) for i in range(9)], unit=Unit.DIMENSIONLESS
    )
    s.constraints = [FixAtoms(indices=[0, 3])]
    bare = hydrogens.remove_hydrogens(s)
    assert bare.n_atoms == 3 and n_h(bare) == 0 and len(bare.bonds) == 2
    assert bare.atomic_scalars["x"].values == [0.0, 1.0, 2.0]
    assert bare.constraints == [FixAtoms(indices=[0])]
    assert [a.uid for a in bare.atoms] == [a.uid for a in s.atoms[:3]]
    full = hydrogens.add_hydrogens(bare)
    assert full.n_atoms == 9 and n_h(full) == 6
    assert [a.uid for a in full.atoms[:3]] == [a.uid for a in bare.atoms]
    assert len(full.bonds) == 8
    # new hydrogens sit at bonding distance from their heavy atom
    pos = full.positions()
    for b in full.bonds:
        assert 0.9 < np.linalg.norm(pos[b.a] - pos[b.b]) < 1.6


def test_add_hydrogens_to_selected_atoms_only() -> None:
    bare = hydrogens.remove_hydrogens(from_smiles("CCO"))
    part = hydrogens.add_hydrogens(bare, indices={2})
    assert part.n_atoms == 4 and part.atoms[3].element == "H"
    assert any(b.key() == (2, 3) for b in part.bonds)


def test_remove_hydrogens_of_selection() -> None:
    s = from_smiles("CCO")  # atoms: C C O then 6 H
    out = hydrogens.remove_hydrogens(s, indices={2})  # the O: strips its single H
    assert out.n_atoms == 8 and n_h(out) == 5


def test_benzene_hydrogens_use_kekule_structure() -> None:
    bare = hydrogens.remove_hydrogens(from_smiles("c1ccccc1"))
    assert all(b.aromatic for b in bare.bonds)
    full = hydrogens.add_hydrogens(bare)
    assert n_h(full) == 6


def test_ph_model_deprotonates_acetic_acid() -> None:
    acid = from_smiles("CC(=O)O")
    low = hydrogens.add_hydrogens(acid, ph=1.0)
    high = hydrogens.add_hydrogens(acid, ph=7.4)
    assert n_h(low) == 4
    assert n_h(high) == 3 and high.charge == -1.0
    assert any(a.formal_charge == -1 for a in high.atoms)


def test_perceive_bonds_and_orders() -> None:
    s = from_smiles("c1ccccc1")
    bare = s.model_copy(update={"bonds": []})
    out = hydrogens.perceive_bonds(bare)
    assert len(out.bonds) == 12
    ring = [b for b in out.bonds if s.atoms[b.a].element == "C" and s.atoms[b.b].element == "C"]
    assert sorted(b.order for b in ring) == [1, 1, 1, 2, 2, 2]
    assert all(b.aromatic for b in ring)
    single = hydrogens.perceive_bonds(bare, bond_orders=False)
    assert all(b.order == 1 for b in single.bonds)


def test_gasteiger_charges_sum_to_total_charge_and_water_dipole() -> None:
    water = from_smiles("O")
    res = properties.partial_charges(water, "gasteiger")
    assert abs(res.total_charge - water.charge) < 1e-3
    charges = res.structure.atomic_scalars["partial_charges"]
    assert charges.unit == "e" and len(charges.values) == 3
    assert 0.5 < res.dipole.magnitude.value < 3.0  # experimental 1.85 D; Gasteiger is rough
    assert res.structure.properties["dipole_moment"].unit == "debye"
    ion = from_smiles("[NH4+]")
    res2 = properties.partial_charges(ion, "gasteiger")
    assert abs(res2.total_charge - 1.0) < 1e-3
    for model in ("mmff94", "qeq", "eem"):
        r = properties.partial_charges(from_smiles("CCO"), model)  # type: ignore[arg-type]
        assert abs(r.total_charge) < 1e-2, model


def test_atom_types_and_the_two_readings_of_valence() -> None:
    phenol = from_smiles("c1ccccc1O")
    typing = properties.atom_types(phenol)
    assert typing.perception == "openbabel"
    by_element = dict(zip([a.element for a in phenol.atoms], typing.types, strict=True))
    assert by_element["C"] == "Car"  # aromatic carbon
    assert by_element["O"] == "O3"  # sp3 oxygen

    # Open Babel reads the bonds Atomscope perceived, so its two numbers must agree with ours.
    # The kekulized ring (1, 2, 1, 2, ...) has the same order sum per atom as the aromatic one.
    degree = [0] * len(phenol.atoms)
    order_sum = [0.0] * len(phenol.atoms)
    for b in phenol.bonds:
        for i in (b.a, b.b):
            degree[i] += 1
            order_sum[i] += b.order
    assert typing.degrees == degree
    assert typing.valences == pytest.approx(order_sum)

    with pytest.raises(ValueError, match="no atoms"):
        properties.atom_types(Structure(name="empty"))


def test_aromaticity_and_rings() -> None:
    res = properties.aromaticity(from_smiles("c1ccccc1"))
    assert res.ring_count == 1 and res.aromatic_ring_count == 1
    assert len(res.aromatic_atoms) == 6
    assert sum(1 for b in res.structure.bonds if b.aromatic) == 6
    res2 = properties.aromaticity(from_smiles("C1CCCCC1"))
    assert res2.ring_count == 1 and res2.aromatic_ring_count == 0
    assert properties.aromaticity(from_smiles("CCO")).ring_count == 0


def test_identifiers() -> None:
    ids = properties.identifiers(from_smiles("CCO"))
    assert ids.smiles == "CCO"
    assert ids.inchi == "InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3"
    assert ids.inchikey.startswith("LFQSCWFLJHTTHZ")
    assert properties.identifiers(from_smiles("c1ccccc1")).smiles == "c1ccccc1"


def test_h_to_methyl_methane_becomes_ethane() -> None:
    methane = from_smiles("C")
    h = next(i for i, a in enumerate(methane.atoms) if a.element == "H")
    ethane = edits.h_to_methyl(methane, {h})
    assert ethane.formula() == "C2H6" and len(ethane.bonds) == 7
    pos = ethane.positions()
    assert np.linalg.norm(pos[h] - pos[0]) == pytest.approx(1.52, abs=0.05)
    for b in ethane.bonds[-3:]:
        assert np.linalg.norm(pos[b.a] - pos[b.b]) == pytest.approx(1.09, abs=1e-6)
    # every H-C-H angle on the new carbon is tetrahedral
    hs = [b.b for b in ethane.bonds[-3:]]
    for i in range(3):
        for j in range(i + 1, 3):
            u, v = pos[hs[i]] - pos[h], pos[hs[j]] - pos[h]
            ang = np.degrees(np.arccos(np.dot(u, v) / np.linalg.norm(u) / np.linalg.norm(v)))
            assert ang == pytest.approx(109.5, abs=0.5)
    # minimum distance between the two methyl groups' hydrogens is healthy (staggered)
    old_h = [i for i in range(1, 5) if i != h]
    d = min(np.linalg.norm(pos[a] - pos[b]) for a in old_h for b in hs)
    assert d > 2.3


def cip(s: Structure, idx: int) -> str:
    mol = structure_to_mol(s)
    Chem.SanitizeMol(mol)
    Chem.AssignStereochemistryFrom3D(mol)
    return str(mol.GetAtomWithIdx(idx).GetPropsAsDict().get("_CIPCode", "?"))


def test_invert_chirality_of_selected_centre_flips_cip_label() -> None:
    s = from_smiles("C[C@H](N)O")  # chiral carbon at index 1
    before = cip(s, 1)
    assert before in ("R", "S")
    out = edits.invert_chirality(s, {1})
    assert cip(out, 1) != before
    assert out.n_atoms == s.n_atoms and out.bonds == s.bonds
    # only the two smallest substituents (OH group and H) moved
    moved = [
        i
        for i, (a, b) in enumerate(zip(s.atoms, out.atoms, strict=True))
        if a.position != b.position
    ]
    assert 1 not in moved and 0 not in moved and 2 not in moved


def test_invert_chirality_without_selection_mirrors_everything() -> None:
    s = from_smiles("C[C@H](N)O")
    out = edits.invert_chirality(s)
    assert cip(out, 1) != cip(s, 1)
    assert np.allclose(out.positions()[:, 0], -s.positions()[:, 0])


def test_remove_atoms_keeps_ring_structure_valid() -> None:
    s = Structure(
        atoms=[Atom(element="C", position=(float(i), 0, 0)) for i in range(4)],
        bonds=[Bond(a=0, b=1), Bond(a=1, b=2), Bond(a=2, b=3)],
    )
    out = hydrogens.remove_atoms(s, {1})
    assert out.n_atoms == 3 and [b.key() for b in out.bonds] == [(1, 2)]


def test_removing_atoms_reindexes_or_drops_every_constraint_kind() -> None:
    s = from_smiles("CCO")  # C C O then six hydrogens
    s.constraints = [
        FixAtoms(indices=[0, 3]),
        IgnoreAtoms(indices=[3, 4]),
        FixBondLength(a=0, b=1, value=1.5),
        FixAngle(a=0, b=1, c=2),
        FixDihedral(a=3, b=0, c=1, d=2, value=60.0),
    ]
    out = hydrogens.remove_atoms(s, {3})
    # atom 3 is gone: the constraints naming it lose it, and later atoms shift down by one
    assert out.constraints == [
        FixAtoms(indices=[0]),
        IgnoreAtoms(indices=[3]),
        FixBondLength(a=0, b=1, value=1.5),
        FixAngle(a=0, b=1, c=2),
    ]


def test_added_hydrogens_join_the_residue_of_their_heavy_atom() -> None:
    """A PDB structure keeps its residues through Add hydrogens, or the ribbons vanish with them."""
    text = (Path(__file__).resolve().parents[1] / "fixtures" / "bio" / "1crn.pdb").read_text()
    s = structure_from_string(text, "pdb")
    assert len(s.residues) == 46

    full = hydrogens.add_hydrogens(s)
    assert full.n_atoms > s.n_atoms
    assert len(full.residues) == 46
    covered = {i for r in full.residues for i in r.atom_indices}
    assert covered == set(range(full.n_atoms))
    # every hydrogen sits in the residue of the atom it is bonded to
    residue_of = {i: r for r, res in enumerate(full.residues) for i in res.atom_indices}
    for b in full.bonds:
        if full.atoms[b.a].element == "H" or full.atoms[b.b].element == "H":
            assert residue_of[b.a] == residue_of[b.b]
