"""SMARTS substructure matching (Avogadro's Select SMARTS...)."""

from __future__ import annotations

import pytest

from atomscope.chem.smarts import SmartsError, match, matching_atoms
from atomscope.io.rdkit_io import from_smiles


def test_functional_group_selection() -> None:
    benzyl_alcohol = from_smiles("c1ccccc1CO")
    hydroxyl = matching_atoms(benzyl_alcohol, "[OX2H]")
    assert len(hydroxyl) == 1
    assert benzyl_alcohol.atoms[hydroxyl[0]].element == "O"
    # Avogadro's documented example: [OH] selects the hydroxyl oxygen and its hydrogen
    assert len(matching_atoms(benzyl_alcohol, "[OX2H1]")) == 1


def test_aromatic_ring_matching_and_unique_maps() -> None:
    toluene = from_smiles("Cc1ccccc1")
    ring = matching_atoms(toluene, "c1ccccc1")
    assert len(ring) == 6
    assert all(toluene.atoms[i].element == "C" for i in ring)
    # a benzene ring maps onto itself in 12 ways; only one of them is symmetry-unique
    assert len(match(toluene, "c1ccccc1")) == 1
    assert len(match(toluene, "c1ccccc1", unique=False)) == 12


def test_matches_are_returned_in_pattern_order() -> None:
    acid = from_smiles("CC(=O)O")
    (carbonyl,) = match(acid, "C=O")
    assert acid.atoms[carbonyl[0]].element == "C"
    assert acid.atoms[carbonyl[1]].element == "O"


def test_pattern_with_no_match_is_not_an_error() -> None:
    assert matching_atoms(from_smiles("CCO"), "[Fe]") == []


def test_invalid_patterns_are_rejected() -> None:
    ethanol = from_smiles("CCO")
    with pytest.raises(SmartsError, match="empty"):
        matching_atoms(ethanol, "   ")
    with pytest.raises(SmartsError, match="invalid"):
        matching_atoms(ethanol, "[C")
