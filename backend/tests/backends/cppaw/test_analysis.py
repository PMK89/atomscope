# ruff: noqa: E501
"""Golden tests for the CP-PAW analysis tools: control-file generators, .dos/.dat parsers,
orbital listing and default k-paths (no executable needed)."""

import os
from pathlib import Path

import pytest
from ase.build import bulk, molecule

from atomscope.ase_bridge import from_atoms
from atomscope.backends.cppaw.analysis import (
    ElectronicInfo,
    default_kpath,
    electronic_info,
    list_orbitals,
    orbital_label,
)
from atomscope.backends.cppaw.bands import parse_band_text, read_bands
from atomscope.backends.cppaw.deck import parse_deck
from atomscope.backends.cppaw.dos import dcntl_weights, integrate, parse_dos_text, read_dos
from atomscope.backends.cppaw.protocol import Eigenvalues, parse_protocol_text
from atomscope.backends.cppaw.tools import (
    BandOptions,
    CoopRequest,
    DosOptions,
    OrbitalProjection,
    OrbitalRequest,
    OrbitalWeight,
    band_file,
    band_sidecar,
    band_sidecar_text,
    bcntl_text,
    dcntl_text,
    dos_weights,
    orbital_cntl_text,
    path_segments,
)
from atomscope.model import OrbitalInfo, VolumetricGrid
from atomscope.model.spectrum import KPathPoint
from atomscope.units import Unit

FIX = Path(__file__).resolve().parents[2] / "fixtures" / "cppaw"


def test_protocol_homo_per_spin() -> None:
    data = parse_protocol_text((FIX / "h2o" / "case.prot").read_text())
    assert data.homo_band_index == 4
    assert data.homo_band_index_by_spin == {1: 4, 2: 4}
    si = parse_protocol_text((FIX / "si2" / "si2.prot").read_text())
    assert si.homo_band_index == 4 and si.homo_band_index_by_spin == {1: 4}


def test_dcntl_weights_follow_element_rule() -> None:
    h2o = from_atoms(molecule("H2O"))
    ids = [w[0] for w in dos_weights(h2o, DosOptions())]
    assert ids == ["total", "O", "O_s", "O_p", "H", "H_s"]
    per_atom = [w[0] for w in dos_weights(h2o, DosOptions(projection="atom", l_channels=False))]
    assert per_atom == ["total", "O_1", "H_2", "H_3"]
    assert dos_weights(h2o, DosOptions(projection="none")) == [("total", "total", [])]
    text = dcntl_text("case", h2o, DosOptions(broadening_ev=0.2, de_ev=0.05))
    deck = parse_deck(text).child("DCNTL")
    assert deck is not None
    assert deck.path("GENERIC").get("PREFIX") == "case_dos_"  # type: ignore[union-attr]
    assert deck.path("GRID").get("BROADENING[EV]") == 0.2  # type: ignore[union-attr]
    weights = deck.children_named("WEIGHT")
    assert weights[0].get("TYPE") == "TOTAL"
    h = next(w for w in weights if w.get("ID") == "H")
    assert [a.get("NAME") for a in h.children_named("ATOM")] == ["H_2", "H_3"]


def test_parse_dos_fixture_two_spins_and_integrals() -> None:
    blocks = parse_dos_text((FIX / "h2o_dos" / "case_dos_total.dos").read_text())
    assert len(blocks) == 2
    up, down = blocks
    assert up.energies == down.energies
    assert all(v >= 0 for v in up.dos) and all(v <= 0 for v in down.dos)
    # sentinel rows removed: the grid is strictly increasing
    assert all(b > a for a, b in zip(up.energies, up.energies[1:], strict=False))
    # water: 8 valence electrons, 4 per spin channel in the occupied DOS. The grid starts at
    # the lowest eigenvalue, so half of that state's broadened weight lies outside the printed
    # range: 3.5 states per spin within the file.
    assert abs(integrate(up.energies, up.occupied) - 3.5) < 0.1
    assert abs(integrate(down.energies, down.occupied) + 3.5) < 0.1
    # all 20 bands per spin in the full DOS (the highest one is cut at its band minimum)
    assert abs(integrate(up.energies, up.dos) - 20.0) < 0.5


def test_read_dos_fixture_directory() -> None:
    spec = read_dos(FIX / "h2o_dos", "case", homo_energy=-6.9)
    assert [s.id for s in spec.series] == [
        w for w in ("total", "O", "O_s", "O_p", "H", "H_s") for _ in range(2)
    ]
    assert {s.spin for s in spec.series} == {"up", "down"}
    assert spec.series[3].label == "O" and spec.series[3].spin == "down"
    assert spec.fermi_level is not None and abs(spec.fermi_level + 6.87) < 0.05
    assert spec.broadening == 0.2 and spec.homo_energy == -6.9
    assert len(spec.energies) == len(spec.series[0].dos) > 100


def test_bcntl_generation_and_path_breaks() -> None:
    si = from_atoms(bulk("Si"))
    path = default_kpath(si)
    labels = [p.label for p in path]
    assert labels[:5] == ["G", "X", "W", "K", "G"] and "," in labels
    segs = path_segments(path)
    assert len(segs) == len(path) - 3  # one break removes two segments
    text = bcntl_text("case", path, BandOptions(nk=8), nb=6, n_spins=2)
    deck = parse_deck(text).path("BCNTL", "BANDSTRUCTURE")
    assert deck is not None and deck.get("MODE") == "LINEARINTERPOLATION"
    lines = deck.children_named("LINE")
    assert len(lines) == 2 * len(segs)
    assert lines[0].get("TAPPEND") is False and lines[1].get("TAPPEND") is True
    assert lines[0].get("FILE") == "case_bands_s1.dat" and lines[-1].get("SPIN") == 2
    assert lines[0].get("XK2") == [0.5, 0.0, 0.5]
    diag = bcntl_text("case", path, BandOptions(mode="diagonalize"), nb=6, n_spins=1)
    assert "INPUTFILE" in diag and "MODE='DIAG'" in diag
    with pytest.raises(ValueError, match="periodic"):
        default_kpath(from_atoms(molecule("H2O")))


def test_read_bands_from_written_files(tmp_path: Path) -> None:
    path = [
        KPathPoint(label="G", xk=(0, 0, 0)),
        KPathPoint(label="X", xk=(0.5, 0, 0.5)),
        KPathPoint(label=",", xk=(0, 0, 0)),
        KPathPoint(label="L", xk=(0.5, 0.5, 0.5)),
        KPathPoint(label="G", xk=(0, 0, 0)),
    ]
    opts = BandOptions(nk=3)
    (tmp_path / band_sidecar("case")).write_text(band_sidecar_text(path, opts, 1))
    rows = [
        "   0.00000  -4.33744   7.70453",
        "   0.30000  -3.00000   6.00000",
        "   0.60000  -2.00000   5.00000",
        "   0.60000  -2.10000   5.10000",
        "   0.80000  -3.10000   6.10000",
        "   1.00000  -4.30000   7.70000",
    ]
    (tmp_path / band_file("case", 1)).write_text("\n".join(rows) + "\n")
    bs = read_bands(tmp_path, "case", homo_energy=7.7)
    assert bs.k_distance == [0.0, 0.3, 0.6, 0.6, 0.8, 1.0]
    assert [(lb.label, lb.distance) for lb in bs.labels] == [("G", 0.0), ("X|L", 0.6), ("G", 1.0)]
    assert bs.energies[0][0] == [-4.33744, 7.70453] and bs.homo_energy == 7.7
    xs, e = parse_band_text("#DATA FOR LINE BLOCK 1\n 0.0 1.0 2.0\n")
    assert xs == [0.0] and e == [[1.0, 2.0]]


def test_a_band_file_left_over_from_an_earlier_request_is_refused(tmp_path: Path) -> None:
    """paw_bands.x can fail (older builds reject MODE=DIAG) and leave the previous run's .dat in
    place; answering with it would show a band structure nobody asked for."""
    path = [KPathPoint(label="G", xk=(0, 0, 0)), KPathPoint(label="X", xk=(0.5, 0, 0.5))]
    stale = tmp_path / band_file("case", 1)
    stale.write_text("   0.00000  -4.0   7.0\n   0.50000  -3.0   6.0\n")
    os.utime(stale, (1_000_000, 1_000_000))
    (tmp_path / band_sidecar("case")).write_text(
        band_sidecar_text(path, BandOptions(nk=2, mode="diagonalize"), 1)
    )
    with pytest.raises(FileNotFoundError, match="predates"):
        read_bands(tmp_path, "case")


def test_orbital_labels_and_listing() -> None:
    assert [orbital_label(b, 4) for b in (2, 3, 4, 5, 6)] == [
        "HOMO-2",
        "HOMO-1",
        "HOMO",
        "LUMO",
        "LUMO+1",
    ]
    assert orbital_label(3, None) == "band 3"
    info = ElectronicInfo(
        eigenvalues=[
            Eigenvalues(kpoint=1, spin=1, energies_ev=[-10.0, -5.0, 1.0]),
            Eigenvalues(kpoint=1, spin=2, energies_ev=[-9.0, -4.0, 2.0]),
        ],
        homo_by_spin={1: 2, 2: 1},
    )
    grid = VolumetricGrid(
        id="g1",
        name="orbital",
        kind="orbital",
        origin=(0, 0, 0),
        axes=((1, 0, 0), (0, 1, 0), (0, 0, 1)),
        shape=(1, 1, 1),
        unit=Unit.E_PER_BOHR3,
        inline_values=[0.0],
        orbital=OrbitalInfo(index=1, spin="down", kpoint=1),
    )
    entries = list_orbitals(info, [grid])
    assert [(o.spin, o.band, o.occupation, o.label) for o in entries] == [
        (1, 1, 1.0, "HOMO-1"),
        (1, 2, 1.0, "HOMO"),
        (1, 3, 0.0, "LUMO"),
        (2, 1, 1.0, "HOMO"),
        (2, 2, 0.0, "LUMO"),
        (2, 3, 0.0, "LUMO+1"),
    ]
    assert entries[4].grid_id == "g1" and entries[1].grid_id is None
    assert info.homo_energy == -5.0
    si = electronic_info(FIX / "si2", "si2")
    assert si.n_bands == 6 and si.n_kpoints == 8 and si.n_spins == 1
    assert len(list_orbitals(si, [])) == 48


def test_orbital_restart_cntl() -> None:
    values = {"epwpsi": 30.0, "write_density": True, "orbital_bands": "1 2", "grid_spacing": 0.3}
    text = orbital_cntl_text(
        "case", values, [OrbitalRequest(band=3), OrbitalRequest(band=4, kpoint=2, spin=2)]
    )
    ctl = parse_deck(text).child("CONTROL")
    assert ctl is not None
    files = {f.get("ID"): f.get("NAME") for f in ctl.path("FILES").children_named("FILE")}  # type: ignore[union-attr]
    assert files == {"STRC": "case.strc", "RESTART_IN": "case.rstrt"}
    gen = ctl.path("GENERIC")
    assert gen is not None and gen.get("START") is False and gen.get("NSTEP") == 1
    ana = ctl.path("ANALYSE")
    assert ana is not None and not ana.children_named("DENSITY")
    waves = ana.children_named("WAVE")
    assert [(w.get("FILE"), w.get("B"), w.get("K"), w.get("S"), w.get("DR")) for w in waves] == [
        ("case_orb_b3k1s1.wv", 3, 1, 1, 0.3),
        ("case_orb_b4k2s2.wv", 4, 2, 2, 0.3),
    ]
    assert ctl.path("PSIDYN", "AUTO") is None


def test_orb_weights_and_coops_are_written_as_the_cheat_sheet_spells_them() -> None:
    """App. A.4 of the tutorial: `!ORB` inside a `!WEIGHT`, and `!COOP` with `!ORB1`/`!ORB2`.

    `NNZ` is what makes a hybrid mean anything -- an sp3 lobe has to point somewhere -- and it is
    what ch. 4.7.4 (local coordinate systems) is about.
    """
    h2o = from_atoms(molecule("H2O"))
    opts = DosOptions(
        projection="none",
        orbital_weights=[
            OrbitalWeight(
                id="o-sp3",
                label="O sp3 toward H",
                orbitals=[OrbitalProjection(atom=0, type="SP3", toward=1)],
            )
        ],
        coops=[
            CoopRequest(
                id="o-h",
                label="O sp3 - H s",
                first=OrbitalProjection(atom=0, type="SP3", toward=1),
                second=OrbitalProjection(atom=1, type="S", toward=0),
            )
        ],
    )
    deck = parse_deck(dcntl_text("case", h2o, opts)).child("DCNTL")
    assert deck is not None

    weights = deck.children_named("WEIGHT")
    assert [w.get("ID") for w in weights] == ["total", "o-sp3"]
    orb = weights[1].children_named("ORB")[0]
    assert orb.get("ATOM") == "O_1" and orb.get("TYPE") == "SP3" and orb.get("NNZ") == "H_2"

    coop = deck.children_named("COOP")[0]
    assert coop.get("ID") == "o-h" and coop.get("LEGEND") == "O sp3 - H s"
    one, two = coop.children_named("ORB1")[0], coop.children_named("ORB2")[0]
    assert (one.get("ATOM"), one.get("TYPE"), one.get("NNZ")) == ("O_1", "SP3", "H_2")
    assert (two.get("ATOM"), two.get("TYPE"), two.get("NNZ")) == ("H_2", "S", "O_1")

    # both kinds write PREFIX//ID.dos, so reading a .dcntl back has to say which is which
    prefix, entries, broadening = dcntl_weights(dcntl_text("case", h2o, opts))
    assert prefix == "case_dos_"
    assert [(e.id, e.legend, e.kind) for e in entries] == [
        ("total", "total", "dos"),
        ("o-sp3", "O sp3 toward H", "dos"),
        ("o-h", "O sp3 - H s", "coop"),
    ]
    # neither the total nor a hand-built orbital partitions anything, so neither may be stacked
    assert all(e.group is None and e.channel is None for e in entries)
    assert broadening == 0.1


def test_an_orbital_projection_has_to_name_atoms_that_exist() -> None:
    h2o = from_atoms(molecule("H2O"))

    def weight(atom: int, toward: int | None) -> DosOptions:
        return DosOptions(
            projection="none",
            orbital_weights=[
                OrbitalWeight(
                    id="w", orbitals=[OrbitalProjection(atom=atom, type="SP3", toward=toward)]
                )
            ],
        )

    with pytest.raises(ValueError, match="outside a structure of 3 atoms"):
        dcntl_text("case", h2o, weight(7, None))
    with pytest.raises(ValueError, match="outside a structure of 3 atoms"):
        dcntl_text("case", h2o, weight(0, 9))
    # an orbital pointing at its own atom has no axis to build
    with pytest.raises(ValueError, match="cannot point at its own atom"):
        dcntl_text("case", h2o, weight(1, 1))
    # ...and an id that would escape the file name is refused before it reaches the deck
    with pytest.raises(ValueError, match="String should match"):
        OrbitalWeight(id="../evil", orbitals=[OrbitalProjection(atom=0, type="S")])


def test_weights_say_what_each_one_decomposes() -> None:
    """A stacked DOS may only stack weights that partition the total, and the ``.dcntl`` says
    which those are: the ``TYPE`` on each ``!ATOM``. Water with l channels has every shape at
    once -- the total, whole atoms, their s and p channels, a hand-built sp3 orbital and a COOP.
    """
    h2o = from_atoms(molecule("H2O"))
    opts = DosOptions(
        projection="atom",
        l_channels=True,
        orbital_weights=[
            OrbitalWeight(
                id="o-sp3",
                label="O sp3 toward H",
                orbitals=[OrbitalProjection(atom=0, type="SP3", toward=1)],
            )
        ],
        coops=[
            CoopRequest(
                id="o-h",
                label="O sp3 - H s",
                first=OrbitalProjection(atom=0, type="SP3", toward=1),
                second=OrbitalProjection(atom=1, type="S", toward=0),
            )
        ],
    )
    _, entries, _ = dcntl_weights(dcntl_text("case", h2o, opts))
    by_id = {e.id: e for e in entries}

    assert by_id["total"].group is None  # the outline, not part of the stack
    assert (by_id["O_1"].group, by_id["O_1"].channel) == ("O_1", None)  # its own group
    assert (by_id["O_1_s"].group, by_id["O_1_s"].channel) == ("O_1", "s")
    assert (by_id["O_1_p"].group, by_id["O_1_p"].channel) == ("O_1", "p")
    assert (by_id["H_2_s"].group, by_id["H_2_s"].channel) == ("H_2", "s")
    # a hand-built orbital overlaps whatever else was asked for: it partitions nothing
    assert by_id["o-sp3"].group is None
    assert by_id["o-h"].kind == "coop" and by_id["o-h"].group is None

    # the channels of each group are a partition of it, and the groups a partition of the total
    channels = [e for e in entries if e.channel is not None]
    assert {e.group for e in channels} == {"O_1", "H_2", "H_3"}
