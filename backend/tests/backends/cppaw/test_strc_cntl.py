# ruff: noqa: E501, PLC0415
from pathlib import Path

import numpy as np
from ase.build import bulk, molecule
from ase.units import Bohr

from atomscope.ase_bridge import from_atoms
from atomscope.backends.cppaw.cntl import (
    analysis_files,
    build_cntl,
    cntl_text,
    force_stage_values,
    orbital_band_list,
)
from atomscope.backends.cppaw.deck import parse_deck
from atomscope.backends.cppaw.strc import (
    StrcOptions,
    atom_name,
    read_strc_geometry,
    species_name,
    strc_text,
)
from atomscope.model import FixAtoms, FixBondLength

FIX = Path(__file__).resolve().parents[2] / "fixtures" / "cppaw"


def test_names() -> None:
    assert species_name("O") == "O_" and species_name("Si") == "SI"
    assert atom_name("H", 1) == "H_2" and atom_name("Si", 11) == "SI12"


def test_molecule_strc() -> None:
    s = from_atoms(molecule("H2O"), name="water")
    s.charge = -1.0
    s.multiplicity = 2
    s.constraints = [FixAtoms(indices=[0]), FixBondLength(a=0, b=1)]
    text = strc_text(s, StrcOptions(box_margin=4.0))
    root = parse_deck(text)
    strc = root.child("STRUCTURE")
    assert strc.path("GENERIC").get("LUNIT[AA]") == 1.0
    assert strc.child("ISOLATE") is not None and strc.child("KPOINTS") is None
    occ = strc.child("OCCUPATIONS")
    assert occ.get("CHARGE") == -1.0 and occ.get("NSPIN") == 2 and occ.get("SPIN") == 0.5
    species = strc.children_named("SPECIES")
    assert [sp.get("NAME") for sp in species] == ["O_", "H_"]
    assert species[0].get("ID") == "O_.75_6.0" and species[1].get("NPRO") == [1, 1]
    atoms = strc.children_named("ATOM")
    assert [a.get("NAME") for a in atoms] == ["O_1", "H_2", "H_3"]
    cons = strc.child("CONSTRAINTS")
    assert cons.child("FREEZE").get("ATOM") == "O_1"
    assert cons.child("BOND").get("ATOM2") == "H_2"
    # box = extent + 2*margin
    t = strc.child("LATTICE").get("T")
    ext = s.positions().max(axis=0) - s.positions().min(axis=0)
    assert abs(t[4] - (ext[1] + 8.0)) < 1e-9 and t[1] == 0.0
    # round trip through the reader gives back Å positions
    geo = read_strc_geometry(text)
    np.testing.assert_allclose(geo.positions_ang, s.positions(), atol=1e-9)
    assert geo.charge == -1.0 and geo.nspin == 2


def test_periodic_strc_kpoints() -> None:
    s = from_atoms(bulk("Si"))
    text = strc_text(s, StrcOptions(kpoint_mode="density", kpoint_r=30.0))
    strc = parse_deck(text).child("STRUCTURE")
    assert strc.child("ISOLATE") is None and strc.child("KPOINTS").get("R") == 30.0
    text2 = strc_text(s, StrcOptions(kpoint_mode="grid", kpoint_div=(4, 4, 4)))
    assert parse_deck(text2).child("STRUCTURE").child("KPOINTS").get("DIV") == [4, 4, 4]
    geo = read_strc_geometry(text)
    np.testing.assert_allclose(geo.cell_ang, np.array(s.cell.vectors), atol=1e-9)


def test_read_fixture_decks_with_lunit() -> None:
    si2 = read_strc_geometry((FIX / "si2" / "si2.strc").read_text())
    # LUNIT=10.26 Bohr lattice units: SI2 at 0.25 -> 1.35734 Å
    assert abs(si2.positions_ang[1][0] - 0.25 * 10.26 * Bohr) < 1e-6
    assert abs(si2.cell_ang[0][1] - 0.5 * 10.26 * Bohr) < 1e-6
    h2o = read_strc_geometry((FIX / "h2o" / "case.strc").read_text())
    # LUNIT=1.8897261 (Bohr per Å) means coordinates were given in Å
    assert abs(h2o.positions_ang[1][1] - 0.763239) < 1e-5
    out = read_strc_geometry((FIX / "si2_rdyn" / "si2.strc_out").read_text())
    assert out.names == ["SI1", "SI2"] and abs(out.positions_ang[1][0] - 1.357) < 0.01


def test_cntl_tasks() -> None:
    single = parse_deck(cntl_text("case", {"task": "single_point"})).child("CONTROL")
    assert single.path("GENERIC").get("START") is True and single.child("RDYN") is None
    assert single.path("PSIDYN", "AUTO") is not None
    stage1 = parse_deck(cntl_text("case", {"task": "forces", "nstep": 100})).child("CONTROL")
    assert stage1.child("RDYN") is None and stage1.path("GENERIC").get("START") is True
    forces = parse_deck(
        cntl_text("case", force_stage_values({"task": "forces", "nstep": 100, "force_steps": 5}))
    ).child("CONTROL")
    assert forces.path("RDYN").get("FRIC") == 1.0 and forces.path("GENERIC").get("NWRITE") == 1
    assert forces.path("GENERIC").get("NSTEP") == 5 and forces.path("GENERIC").get("START") is False
    assert forces.path("PSIDYN", "AUTO") is None
    relax = parse_deck(
        cntl_text("case", {"task": "relax", "start": "restart_new_structure"})
    ).child("CONTROL")
    assert relax.path("RDYN", "AUTO") is not None and relax.path("GENERIC").get("NEWSTRC") is True
    assert relax.path("GENERIC").get("START") is False
    md = parse_deck(cntl_text("case", {"task": "md", "temperature": 500.0})).child("CONTROL")
    assert md.path("RDYN", "THERMOSTAT").get("T") == 500.0
    assert md.path("PSIDYN", "THERMOSTAT") is not None and md.path("PSIDYN", "AUTO") is None
    metal = parse_deck(
        cntl_text("case", {"occupations": "mermin", "electron_temperature": 0.0})
    ).child("CONTROL")
    assert (
        metal.child("MERMIN").get("TETRA+") is True
        and metal.path("PSIDYN").get("SAFEORTHO") is False
    )


def test_analysis_blocks() -> None:
    v = {
        "write_density": True,
        "spin_polarized": True,
        "write_spin_density": True,
        "orbital_bands": "3, 4",
    }
    files = analysis_files("case", v)
    assert files == [
        ("electron_density", "case_density.wv"),
        ("spin_density", "case_spin.wv"),
        ("orbital:3", "case_b3.wv"),
        ("orbital:4", "case_b4.wv"),
    ]
    ana = build_cntl("case", v).child("CONTROL").child("ANALYSE")
    assert len(ana.children_named("DENSITY")) == 2 and len(ana.children_named("WAVE")) == 2
    assert ana.children_named("WAVE")[1].get("B") == 4
    assert orbital_band_list("1 x 2 -3") == [1, 2]
    assert analysis_files("case", {"write_spin_density": True}) == []


def test_generation_is_deterministic() -> None:
    s = from_atoms(molecule("CH4"))
    assert strc_text(s, StrcOptions()) == strc_text(s, StrcOptions())
    assert cntl_text("case", {}) == cntl_text("case", {})


def test_setup_ids_split_at_first_underscore() -> None:
    from atomscope.backends.cppaw.strc import setup_id

    assert setup_id("O", ".75_6.0") == "O_.75_6.0"
    assert setup_id("Si", ".75_6.0") == "SI_.75_6.0"
    assert setup_id("H", "NDLSS_V0") == "H_NDLSS_V0"


def test_wcntl_uses_full_cell_vectors() -> None:
    from atomscope.backends.cppaw.cntl import wcntl_text

    text = wcntl_text(
        "case",
        "w.wv",
        "w.cub",
        (0.0, 0.0, 0.0),
        ((0.0, 5.0, 5.0), (5.0, 0.0, 5.0), (5.0, 5.0, 0.0)),
    )
    vb = parse_deck(text).path("WCNTL", "VIEWBOX")
    assert vb.get("T") == [0.0, 5.0, 5.0, 5.0, 0.0, 5.0, 5.0, 5.0, 0.0]
    files = parse_deck(text).path("WCNTL", "FILES").children_named("FILE")
    assert {f.get("ID") for f in files} == {"STRC", "WAVE", "CUBE", "WAVEDX"}


def test_occupation_states_roundtrip() -> None:
    from atomscope.backends.cppaw.strc import OccupationState, parse_occupation_states

    states = parse_occupation_states("5 1 1.0\n5 2 0.0 # AFM\n\n6 1 0.5 2")
    assert states[1] == OccupationState(5, 2, 0.0, None) and states[2].kpoint == 2
    s = from_atoms(molecule("O2"))
    text = strc_text(s, StrcOptions(spin_polarized=True, occupation_states="5 1 1.0\n5 2 0.0"))
    occ = parse_deck(text).path("STRUCTURE", "OCCUPATIONS")
    blocks = occ.children_named("STATE")
    assert [(b.get("B"), b.get("S"), b.get("F")) for b in blocks] == [(5, 1, 1.0), (5, 2, 0.0)]
    geo = read_strc_geometry(text)
    assert geo.states == states[:2]
    import pytest

    with pytest.raises(ValueError, match="band spin occupation"):
        parse_occupation_states("1 2")
    with pytest.raises(ValueError, match="invalid"):
        parse_occupation_states("0 1 1.0")
