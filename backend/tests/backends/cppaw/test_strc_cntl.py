# ruff: noqa: E501, PLC0415
from pathlib import Path

import numpy as np
import pytest
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
    isolate_mode,
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


def test_isolate_is_reachable_for_a_cell_the_structure_brought() -> None:
    """The tutorial's molecules live in a face-centred cell of their own and still need !ISOLATE.

    `isolate` used to be applied only to structures we had boxed ourselves, which made the
    tutorial's own water setup -- ch. 2.5, an fcc cell of 12 Å with the electrostatic image
    interaction subtracted -- impossible to express. It is a three-way choice now.
    """
    from ase import Atoms

    water = from_atoms(
        Atoms(
            "OH2",
            positions=[(0.0, 0.0, 0.0), (1.05, 0.0, 0.0), (0.0, 1.05, 0.0)],
            cell=[(0.0, 6.0, 6.0), (6.0, 0.0, 6.0), (6.0, 6.0, 0.0)],
            pbc=True,
        ),
        name="water",
    )
    always = parse_deck(strc_text(water, StrcOptions(isolate="always", kpoint_mode="gamma"))).child(
        "STRUCTURE"
    )
    assert always.child("ISOLATE") is not None
    # the cell it brought is kept, not replaced by a box of ours
    assert always.child("LATTICE").get("T")[:3] == [0.0, 6.0, 6.0]
    assert always.child("KPOINTS").get("DIV") == [1, 1, 1]

    # auto leaves a periodic structure alone, which is what a solid needs
    auto = parse_deck(strc_text(water, StrcOptions(isolate="auto"))).child("STRUCTURE")
    assert auto.child("ISOLATE") is None
    # ...and still isolates a molecule with no cell of its own
    boxed = parse_deck(strc_text(from_atoms(molecule("H2O")), StrcOptions())).child("STRUCTURE")
    assert boxed.child("ISOLATE") is not None

    never = parse_deck(strc_text(water, StrcOptions(isolate="never"))).child("STRUCTURE")
    assert never.child("ISOLATE") is None


def test_isolate_reads_the_boolean_older_projects_saved() -> None:
    """True meant "isolate a molecule we boxed"; False meant never. Both keep their meaning."""
    assert isolate_mode(True) == "auto"
    assert isolate_mode(False) == "never"
    assert isolate_mode("always") == "always"
    assert StrcOptions.from_values({"isolate": True}).isolate == "auto"
    assert StrcOptions.from_values({"isolate": False}).isolate == "never"
    assert StrcOptions.from_values({}).isolate == "auto"
    # anything unrecognised falls back to the default rather than silently never isolating
    assert isolate_mode("nonsense") == "auto"


def test_centred_cube_rolls_a_grid_onto_its_molecule(tmp_path: Path) -> None:
    """A molecule at the origin of its cell has its density at the corners of the grid.

    CP-PAW writes grids over the cell from the cell's own origin, and the tutorial puts molecules
    at that origin, so this is the normal case rather than a corner case.
    """
    import numpy as np
    from ase import Atoms

    from atomscope.backends.cppaw.results import centred_cube
    from atomscope.model import VolumetricGrid, new_uid
    from atomscope.parsers.cube import read_cube, write_cube
    from atomscope.units import Unit

    structure = from_atoms(
        Atoms("He", positions=[(0.0, 0.0, 0.0)], cell=[6.0, 6.0, 6.0], pbc=True),
        name="one atom at the origin",
    )
    n = 13  # 12 intervals of 0.5 A, plus the repeated boundary plane paw_wave.x writes
    grid = VolumetricGrid(
        id=new_uid(),
        name="density",
        kind="electron_density",
        origin=(0.0, 0.0, 0.0),
        axes=((0.5, 0.0, 0.0), (0.0, 0.5, 0.0), (0.0, 0.0, 0.5)),
        shape=(n, n, n),
        unit=Unit.E_PER_BOHR3,
        data_ref="density.cub",
    )
    values = np.zeros((n, n, n))
    for corner in np.ndindex(2, 2, 2):  # the atom's density, split over all eight corners
        values[tuple(-1 if c else 0 for c in corner)] = 1.0
    cube = tmp_path / "density.cub"
    write_cube(cube, grid, values, structure)

    name, rolled = centred_cube(cube, read_cube(cube, kind="electron_density"), structure)
    assert name == "density_centred.cub"
    assert rolled is not None
    # the eight corner peaks are one peak in the middle now, and nothing else changed
    assert rolled[:-1, :-1, :-1].sum() == pytest.approx(1.0)
    peak = np.unravel_index(np.argmax(rolled), rolled.shape)
    assert peak == (6, 6, 6)

    # ...and it is still at the atom, one cell over: the field did not move, its labelling did
    back = read_cube(tmp_path / name, kind="electron_density")
    world = np.asarray(back.grid.origin) + np.asarray(peak, dtype=float) * 0.5
    assert np.allclose(np.mod(world, 6.0), 0.0, atol=1e-6)
    # the rewritten cube carries the real structure, not the periodic images CP-PAW lists
    assert back.structure.n_atoms == 1

    # a grid that is not one cell of this structure is left exactly as it is
    aperiodic = from_atoms(Atoms("He", positions=[(0.0, 0.0, 0.0)]), name="no cell")
    assert centred_cube(cube, read_cube(cube, kind="electron_density"), aperiodic) == (
        "density.cub",
        None,
    )


def test_masses_can_be_set_per_element_and_the_old_single_key_still_works() -> None:
    """Ch. 4 sets M=5 on carbon and oxygen and M=2 on hydrogen: Car-Parrinello masses, not real
    ones. `hydrogen_mass` was the only way to say that, and it could only say it about hydrogen.
    """
    from atomscope.backends.cppaw.strc import parse_masses

    assert parse_masses("C: 5; O: 5; H: 2") == {"C": 5.0, "O": 5.0, "H": 2.0}
    # the older key is the same statement about one element
    assert parse_masses("", 2.0) == {"H": 2.0}
    # ...and the text wins where both name hydrogen, because it is the more specific instruction
    assert parse_masses("H: 3", 2.0) == {"H": 3.0}
    # nonsense is dropped rather than written into a deck
    assert parse_masses("C: ; : 5; O: -1; junk") == {}

    water = from_atoms(molecule("H2O"), name="water")
    strc = parse_deck(strc_text(water, StrcOptions(atom_masses="O: 5; H: 2"))).child("STRUCTURE")
    masses = {sp.get("NAME"): sp.get("M") for sp in strc.children_named("SPECIES")}
    assert masses == {"O_": 5.0, "H_": 2.0}
    # no masses given, none written: CP-PAW's own defaults are the physical ones
    plain = parse_deck(strc_text(water, StrcOptions())).child("STRUCTURE")
    assert all(sp.get("M") is None for sp in plain.children_named("SPECIES"))


def test_orbital_potentials_break_the_symmetry_of_an_antiferromagnet() -> None:
    """Ch. 7.3: NiO's two nickel atoms are equivalent, so nothing makes a spin-polarized run
    prefer the antiferromagnetic ordering that is its ground state. `!ORBPOT` pushes one nickel's
    d shell up and the other's down; the exercise then removes it and continues, because a result
    must not depend on the nudge that found it.
    """
    from ase import Atoms

    from atomscope.backends.cppaw.strc import parse_orbital_potentials

    got = parse_orbital_potentials("1 +0.1 D 1 2.0\n2 -0.1 d 1 2.\n# a comment\n\n")
    assert [(p.atom, p.value, p.shell, p.spin, p.radius) for p in got] == [
        (0, 0.1, "D", 1, 2.0),
        (1, -0.1, "D", 1, 2.0),
    ]
    # spin and radius have defaults, as the deck does
    default = parse_orbital_potentials("3 -0.2 P")[0]
    assert (default.atom, default.value, default.shell, default.spin, default.radius) == (
        2,
        -0.2,
        "P",
        1,
        2.0,
    )

    for bad in ("0 0.1 D", "1 0.1 G", "1 0.1 D 3", "1 0.1 D 1 0", "1 0.1"):
        with pytest.raises(ValueError, match="orbital potential"):
            parse_orbital_potentials(bad)

    a = 4.17
    nio = from_atoms(
        Atoms(
            "Ni2O2",
            positions=[
                (0.0, 0.0, 0.0),
                (a, a, a),
                (0.5 * a, 0.5 * a, 0.5 * a),
                (1.5 * a, 1.5 * a, 1.5 * a),
            ],
            cell=[(a, 0.5 * a, 0.5 * a), (0.5 * a, a, 0.5 * a), (0.5 * a, 0.5 * a, a)],
            pbc=True,
        ),
        name="NiO",
    )
    text = strc_text(
        nio,
        StrcOptions(
            spin_polarized=True,
            orbital_potentials="1 +0.1 D 1 2.0\n2 -0.1 D 1 2.0",
            kpoint_mode="density",
            kpoint_r=20.0,
        ),
    )
    strc = parse_deck(text).child("STRUCTURE")
    pots = strc.child("ORBPOT").children_named("POT")
    # two-letter symbols take no underscore, which is the course's own NI1/NI2
    assert [p.get("ATOM") for p in pots] == ["NI1", "NI2"]
    assert [p.get("VALUE") for p in pots] == [0.1, -0.1]
    assert [(p.get("TYPE"), p.get("S"), p.get("RC")) for p in pots] == [("D", 1, 2.0)] * 2
    # no potentials asked for, no block: this is not something to write by default
    assert parse_deck(strc_text(nio, StrcOptions())).child("STRUCTURE").child("ORBPOT") is None

    with pytest.raises(ValueError, match="past the end of the structure"):
        strc_text(nio, StrcOptions(orbital_potentials="9 0.1 D"))

    # ...and it has to survive the trip through the schema values, which is the path the
    # application uses and the one where this went missing while the test above still passed
    from_values = StrcOptions.from_values(
        {"orbital_potentials": "1 +0.1 D 1 2.0\n2 -0.1 D 1 2.0", "spin_polarized": True}
    )
    assert len(parse_orbital_potentials(from_values.orbital_potentials)) == 2
    assert "ORBPOT" in strc_text(nio, from_values)
