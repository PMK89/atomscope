from pathlib import Path

import numpy as np
import pytest
from ase.build import bulk, molecule

from atomscope.ase_bridge import from_atoms
from atomscope.io import read_structure, write_structure
from atomscope.io.rdkit_io import from_smiles
from atomscope.io.registry import (
    FormatError,
    detect_format,
    sniff_text,
    structure_from_string,
    structure_to_string,
)


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


def test_sniff_text_recognizes_what_a_user_pastes() -> None:
    assert sniff_text("3\n\nO 0 0 0\nH 0 0.8 0.6\nH 0 -0.8 0.6\n") == "xyz"
    assert sniff_text("CCO") == "smi"
    assert sniff_text("data_water\n_cell_length_a 5\n") == "cif"
    assert sniff_text("HETATM    1  O   HOH A   1       0.0   0.0   0.0\n") == "pdb"
    assert sniff_text("\n  Mrv  \n\n  1  0  0\nM  END\n") == "mol"
    with pytest.raises(FormatError):
        sniff_text("this is not a structure\nand neither is this\n")


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
    # "6" alone sniffs as xyz; saying it is SMILES reads it as benzene's ring-closure digit... no,
    # a bare digit is not valid SMILES, so the error must come from the reader, not the sniffer
    with pytest.raises(ValueError, match="invalid SMILES"):
        structure_from_string("6", "smi")


def test_unreadable_text_is_a_format_error() -> None:
    with pytest.raises(FormatError):
        structure_from_string("nothing chemical here at all\nsecond line\n")
