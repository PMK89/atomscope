# ruff: noqa: E501, PLC0415
from pathlib import Path

import pytest

from atomscope.backends.cppaw.deck import Block, DeckSyntaxError, format_deck, parse_deck

FIX = Path(__file__).resolve().parents[2] / "fixtures" / "cppaw"


def test_parse_si2_strc() -> None:
    root = parse_deck((FIX / "si2" / "si2.strc").read_text())
    strc = root.child("STRUCTURE")
    assert strc is not None
    assert strc.path("GENERIC").get("LUNIT") == 10.26
    lattice = strc.path("LATTICE").get("T")
    assert isinstance(lattice, list) and len(lattice) == 9
    atoms = strc.children_named("ATOM")
    assert [a.get("NAME") for a in atoms] == ["SI1", "SI2"]
    assert atoms[1].get("R") == [0.25, 0.25, 0.25]
    species = strc.child("SPECIES")
    assert species.get("NPRO") == [2, 2, 1]
    assert species.get("RAD/RCOV") == 1.4
    assert strc.path("OCCUPATIONS").get("EMPTY") == 2


def test_parse_h2o_strc_units_and_nesting() -> None:
    root = parse_deck((FIX / "h2o" / "case.strc").read_text())
    occ = root.path("STRUCTURE", "OCCUPATIONS")
    assert occ.get("CHARGE") == 0.0  # key is CHARGE[E]
    assert "CHARGE[E]" in occ.keys
    assert occ.get("NSPIN") == 2
    assert occ.child("ISOLATE") is not None
    sp = root.child("STRUCTURE").children_named("SPECIES")
    assert [s.get("NAME") for s in sp] == ["O_", "H_"]
    assert sp[0].path("AUGMENT", "POT").get("POW") == 3.0


def test_parse_cntl_and_disabled_block() -> None:
    root = parse_deck((FIX / "h2o" / "case.cntl").read_text())
    ctl = root.child("CONTROL")
    assert ctl.path("GENERIC").get("START") is True
    assert ctl.path("GENERIC").get("NSTEP") == 300
    assert ctl.child("RDYN") is None and ctl.child("RDYN_x") is not None
    assert ctl.path("ANALYSE", "DENSITY").get("FILE") == "case_total_density.wv"


def test_fortran_exponent_and_logicals() -> None:
    root = parse_deck("!A X=1.D-3 Y=2.5e2 Z=T W=.FALSE. !END !EOB")
    a = root.child("A")
    assert a.get("X") == 1e-3 and a.get("Y") == 250.0 and a.get("Z") is True and a.get("W") is False


def test_roundtrip_is_stable() -> None:
    text = (FIX / "si2" / "si2.strc").read_text()
    once = format_deck(parse_deck(text))
    assert format_deck(parse_deck(once)) == once
    assert once.endswith("!EOB\n")
    assert "!SPECIES NAME='SI'" in once


def test_errors() -> None:
    with pytest.raises(DeckSyntaxError):
        parse_deck("!A X=1")
    with pytest.raises(DeckSyntaxError):
        parse_deck("!A 1 !END")
    with pytest.raises(DeckSyntaxError):
        parse_deck("!END")


def test_programmatic_build() -> None:
    root = Block("__ROOT__")
    ctl = Block("CONTROL")
    root.children.append(ctl)
    ctl.ensure_child("GENERIC").set("NSTEP", 10)
    ctl.ensure_child("GENERIC").set("nstep", 20)  # case-insensitive overwrite
    assert format_deck(root) == "!CONTROL\n  !GENERIC NSTEP=20 !END\n!END\n!EOB\n"


def test_floats_are_fortran_friendly() -> None:
    root = Block("__ROOT__")
    g = Block("GENERIC")
    root.children.append(g)
    g.set("ETOL", 1e-5)
    g.set("DT", 5.0)
    g.set("BIG", 1.5e20)
    text = format_deck(root)
    assert "ETOL=1.0E-05" in text and "DT=5.0" in text and "BIG=1.5E+20" in text
    back = parse_deck(text).child("GENERIC")
    assert back.get("ETOL") == 1e-5 and back.get("BIG") == 1.5e20


def test_duplicate_keys_first_wins() -> None:
    root = parse_deck("!A X=1 X=2 y=3 Y=4 !END !EOB")
    a = root.child("A")
    assert a.get("X") == 1 and a.get("Y") == 3
    assert a.duplicate_keys == ["X", "Y"]
