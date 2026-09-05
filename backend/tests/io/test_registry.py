from pathlib import Path

import numpy as np
import pytest
from ase.build import bulk, molecule

from atomscope.ase_bridge import from_atoms
from atomscope.io import read_structure, write_structure
from atomscope.io.poscar import MissingSpeciesError
from atomscope.io.rdkit_io import from_smiles
from atomscope.io.registry import (
    FormatError,
    detect_format,
    sniff_text,
    structure_from_string,
    structure_to_string,
)
from atomscope.model import Atom, Bond, Structure


@pytest.mark.parametrize(
    "fmt,ext", [("xyz", "xyz"), ("extxyz", "extxyz"), ("pdb", "pdb"), ("json", "json")]
)
def test_molecule_roundtrip(tmp_path: Path, fmt: str, ext: str) -> None:
    s = from_atoms(molecule("CH3OH"), name="methanol")
    p = tmp_path / f"m.{ext}"
    write_structure(s, p, fmt)
    back = read_structure(p)
    assert back.symbols() == s.symbols()
    np.testing.assert_allclose(back.positions(), s.positions(), atol=1e-3)
    assert len(back.bonds) == 5  # perceived: 3 C-H, C-O, O-H


@pytest.mark.parametrize(
    "fmt,ext", [("cif", "cif"), ("vasp", "vasp"), ("extxyz", "extxyz"), ("xsf", "xsf")]
)
def test_periodic_roundtrip(tmp_path: Path, fmt: str, ext: str) -> None:
    s = from_atoms(bulk("NaCl", "rocksalt", a=5.64), name="nacl")
    p = tmp_path / f"c.{ext}"
    write_structure(s, p, fmt)
    back = read_structure(p)
    assert back.cell is not None and s.cell is not None
    # CIF stores lengths/angles, so vector orientation may change; compare invariants.
    np.testing.assert_allclose(back.cell.lengths_angles(), s.cell.lengths_angles(), atol=1e-3)
    assert abs(back.cell.volume() - s.cell.volume()) < 1e-3
    assert back.is_periodic()
    assert sorted(back.symbols()) == sorted(s.symbols())


def test_poscar_name_detection(tmp_path: Path) -> None:
    p = tmp_path / "POSCAR"
    write_structure(from_atoms(bulk("Cu")), p, "vasp")
    assert detect_format(p).name == "vasp"
    assert read_structure(p).symbols() == ["Cu"]


def test_sdf_roundtrip_keeps_bond_orders(tmp_path: Path) -> None:
    s = from_smiles("C=O")  # formaldehyde
    assert any(b.order == 2 for b in s.bonds)
    p = tmp_path / "f.sdf"
    write_structure(s, p)
    back = read_structure(p)
    assert sorted(b.order for b in back.bonds) == sorted(b.order for b in s.bonds)
    assert back.formula() == "CH2O"


def test_smiles_builder_charge_and_hydrogens() -> None:
    s = from_smiles("[NH4+]")
    assert s.formula() == "H4N"
    assert s.charge == 1.0
    with pytest.raises(ValueError, match="invalid SMILES"):
        from_smiles("C(")


def test_cml_via_openbabel(tmp_path: Path) -> None:
    s = from_smiles("CCO")
    p = tmp_path / "e.cml"
    write_structure(s, p)
    back = read_structure(p)
    assert back.formula() == "C2H6O"
    assert len(back.bonds) == 8


def test_unknown_extension_raises(tmp_path: Path) -> None:
    p = tmp_path / "x.unknownfmt"
    p.write_text("garbage")
    with pytest.raises(FormatError):
        read_structure(p)


def test_string_export() -> None:
    text = structure_to_string(from_atoms(molecule("H2")), "xyz")
    assert text.splitlines()[0].strip() == "2"


def test_string_export_covers_the_writers_that_are_not_plain_text_streams() -> None:
    """CIF is written as bytes by ASE and PDB is called `proteindatabank` there; both are text."""
    water = from_atoms(molecule("H2O"))
    assert "data_" in structure_to_string(water, "cif")
    assert "\nATOM      1" in structure_to_string(water, "pdb")
    # and the formats of the other two libraries still go through their own writers
    assert "<molecule" in structure_to_string(water, "cml")


def test_sniff_text_recognizes_what_a_user_pastes() -> None:
    assert sniff_text("3\n\nO 0 0 0\nH 0 0.8 0.6\nH 0 -0.8 0.6\n") == "xyz"
    assert sniff_text("CCO") == "smi"
    assert sniff_text("data_water\n_cell_length_a 5\n") == "cif"
    assert sniff_text("HETATM    1  O   HOH A   1       0.0   0.0   0.0\n") == "pdb"
    assert sniff_text("\n  Mrv  \n\n  1  0  0\nM  END\n") == "mol"
    with pytest.raises(FormatError):
        sniff_text("this is not a structure\nand neither is this\n")


POSCAR_5 = """silicon
1.0
5.43 0.00 0.00
0.00 5.43 0.00
0.00 0.00 5.43
Si
2
Direct
0.00 0.00 0.00
0.25 0.25 0.25
"""
# VASP 4: the species line is gone, and the elements lived in the POTCAR beside the file
POSCAR_4 = POSCAR_5.replace("Si\n2\n", "2\n", 1)
POSCAR_4_NAMED = POSCAR_4.replace("silicon\n", "Si\n", 1)


def test_a_pasted_poscar_is_recognized_before_an_xyz() -> None:
    assert sniff_text(POSCAR_5) == "vasp"
    assert sniff_text(POSCAR_4) == "vasp"
    # a comment line that is a bare number is what an xyz starts with; the lattice decides
    assert sniff_text(POSCAR_5.replace("silicon", "2", 1)) == "vasp"
    assert sniff_text("2\nwater\nO 0 0 0\nH 0 0.96 0\n") == "xyz"
    # an xyz written with atomic numbers: four tokens a line, so not a lattice
    numbers = "5\n2\n8 0.0 0.0 0.0\n1 0.0 0.9 0.0\n1 0.9 0.0 0.0\n6 2.0 0.0 0.0\n8 3.0 0 0\n"
    assert sniff_text(numbers) == "xyz"


def test_a_poscar_that_names_its_species_reads_without_help() -> None:
    s = structure_from_string(POSCAR_5)
    assert s.symbols() == ["Si", "Si"]
    assert s.cell is not None
    # VASP 4 whose comment line happens to be the species: the same, from the comment
    assert structure_from_string(POSCAR_4_NAMED).symbols() == ["Si", "Si"]


def test_a_poscar_without_species_asks_rather_than_guessing() -> None:
    # ASE would send this one looking for a POTCAR beside a file that does not exist
    with pytest.raises(MissingSpeciesError) as caught:
        structure_from_string(POSCAR_4)
    assert caught.value.counts == [2]

    assert structure_from_string(POSCAR_4, species=["Ge"]).symbols() == ["Ge", "Ge"]
    # and the answer has to fit the counts, and be elements
    with pytest.raises(ValueError, match="1 species, but 2"):
        structure_from_string(POSCAR_4, species=["Ge", "Si"])
    with pytest.raises(ValueError, match="not an element symbol: Xx"):
        structure_from_string(POSCAR_4, species=["Xx"])


def test_two_species_keep_their_order_and_counts() -> None:
    text = POSCAR_4.replace("2\nDirect", "1 1\nDirect", 1)
    assert structure_from_string(text, species=["Ga", "As"]).symbols() == ["Ga", "As"]


def test_read_pasted_xyz_perceives_bonds() -> None:
    s = structure_from_string("3\nwater\nO 0 0 0\nH 0 0.76 0.59\nH 0 -0.76 0.59\n")
    assert s.symbols() == ["O", "H", "H"]
    assert len(s.bonds) == 2
    assert s.provenance is not None and s.provenance.source == "text"


def test_read_pasted_molfile_keeps_bond_orders() -> None:
    ethene = from_smiles("C=C")
    molblock = structure_to_string(ethene, "mol")
    back = structure_from_string(molblock)
    assert back.symbols() == ethene.symbols()
    assert sorted(b.order for b in back.bonds) == sorted(b.order for b in ethene.bonds)
    assert 2 in [b.order for b in back.bonds]


def test_a_named_format_wins_over_the_sniffer() -> None:
    # "6" on its own sniffs as XYZ; named as SMILES it reaches the SMILES reader, which rejects it
    with pytest.raises(ValueError, match="invalid SMILES"):
        structure_from_string("6", "smi")


def test_unreadable_text_is_a_format_error() -> None:
    with pytest.raises(FormatError):
        structure_from_string("nothing chemical here at all\nsecond line\n")


def test_aromatic_rings_come_back_kekulized() -> None:
    # an aromatic bond has no order of its own; a renderer drawing multiple bonds needs one
    benzene = from_smiles("c1ccccc1")
    ring = [b for b in benzene.bonds if b.aromatic]
    assert len(ring) == 6
    assert sorted(b.order for b in ring) == [1, 1, 1, 2, 2, 2]
    assert all(b.aromatic for b in ring)


def test_a_molfile_rdkit_will_not_sanitize_still_round_trips() -> None:
    # five bonds on a carbon: RDKit refuses to sanitize it, but the coordinates and bond orders
    # are all a viewer needs, so the reader falls back to the unsanitized parse
    atoms = [Atom(element="C", position=(0.0, 0.0, 0.0))] + [
        Atom(element="H", position=(1.0 * i, 0.5 * i, 0.2 * i)) for i in range(1, 6)
    ]
    hypervalent = Structure(
        name="hypervalent",
        atoms=atoms,
        bonds=[Bond(a=0, b=i, order=1) for i in range(1, 6)],
    )
    back = structure_from_string(structure_to_string(hypervalent, "mol"))
    assert back.symbols() == hypervalent.symbols()
    assert len(back.bonds) == 5
