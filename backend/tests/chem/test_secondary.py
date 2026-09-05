"""Secondary structure against 1CRN's own HELIX/SHEET records and against built peptides."""

from pathlib import Path

import pytest

from atomscope.build.peptide import PRESETS, build_peptide
from atomscope.chem import secondary
from atomscope.io import read_structure

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "bio" / "1crn.pdb"
# from the entry's own records: HELIX 7-19 and 23-30, SHEET 1-4 paired with 32-35
HELICES = [range(7, 20), range(23, 31)]
STRANDS = [range(1, 5), range(32, 36)]


@pytest.fixture(scope="module")
def crambin() -> secondary.SecondaryStructure:
    return secondary.analyse(read_structure(FIXTURE))


def test_backbone_is_found_for_every_residue(crambin: secondary.SecondaryStructure) -> None:
    assert len(crambin.residues) == 46
    assert crambin.chains == [list(range(46))]  # one chain, in sequence order
    # every assignment names four distinct backbone atoms
    for a in crambin.residues:
        b = a.backbone
        assert len({b.n, b.ca, b.c, b.o}) == 4


def test_helices_match_the_pdb_records(crambin: secondary.SecondaryStructure) -> None:
    kinds = {a.residue + 1: a.kind for a in crambin.residues}
    for helix in HELICES:
        found = sum(kinds[r] == "helix" for r in helix)
        # DSSP ends a helix one or two residues before the record does (the last turn is a T)
        assert found >= len(helix) - 3, f"{helix}: only {found} helical"
    # nothing outside the records is called a helix
    helical = {r for r, kind in kinds.items() if kind == "helix"}
    assert helical <= {r for helix in HELICES for r in helix} | {42, 43, 44}


def test_the_two_strands_pair_into_a_sheet(crambin: secondary.SecondaryStructure) -> None:
    kinds = {a.residue + 1: a.kind for a in crambin.residues}
    for strand in STRANDS:
        assert sum(kinds[r] == "sheet" for r in strand) >= 2, f"{strand} not found"
    # the sheet is antiparallel: the N-terminal strand hydrogen bonds to the C-terminal one
    pairs = {(d, a) for d, a, _ in crambin.hbonds}
    assert any(d + 1 in STRANDS[0] and a + 1 in STRANDS[1] for d, a in pairs)
    assert any(d + 1 in STRANDS[1] and a + 1 in STRANDS[0] for d, a in pairs)


def test_hydrogen_bonds_are_backbone_only_and_bound(crambin: secondary.SecondaryStructure) -> None:
    assert crambin.hbonds
    for donor, acceptor, energy in crambin.hbonds:
        assert energy < secondary.HBOND_ENERGY
        assert abs(donor - acceptor) >= secondary.MIN_SEPARATION
    # proline donates nothing: it has no amide hydrogen (1CRN has prolines at 5, 19, 22, 41)
    assert not any(donor + 1 in (5, 19, 22, 41) for donor, _, _ in crambin.hbonds)


@pytest.mark.parametrize(
    "preset,expected",
    [("alpha_helix", "H"), ("helix_3_10", "G"), ("straight", "-"), ("beta_sheet", "-")],
)
def test_built_conformations_are_recognized(preset: str, expected: str) -> None:
    phi, psi = PRESETS[preset]
    structure = build_peptide("AAAAAAAAAA", phi=phi, psi=psi)
    codes = [a.code for a in secondary.analyse(structure).residues]
    assert len(codes) == 10
    middle = codes[2:8]
    assert all(c == expected for c in middle), "".join(codes)


def test_a_molecule_without_residues_is_not_a_protein() -> None:
    from atomscope.io.rdkit_io import from_smiles

    result = secondary.analyse(from_smiles("CCO"))
    assert result.residues == [] and result.chains == [] and result.hbonds == []
