"""The protocol as text and as geometries, against the fixtures."""

from pathlib import Path

import pytest
from ase.units import Hartree

from atomscope.backends.cppaw.protocol import parse_protocol
from atomscope.backends.cppaw.protocol_view import (
    protocol_structures,
    read_protocol_text,
    symbol_of,
)

FIX = Path(__file__).resolve().parents[2] / "fixtures" / "cppaw"


def test_the_default_window_is_the_end() -> None:
    """Where a run reports its failure, and its converged numbers."""
    path = FIX / "si2_rdyn" / "si2.prot"
    whole = path.read_text().splitlines()
    page = read_protocol_text(path, limit=20)
    assert page.total_lines == len(whole)
    assert page.offset == len(whole) - 20
    assert page.text.splitlines() == whole[-20:]
    assert page.name == "si2.prot"


def test_paging_from_the_front_and_off_the_end() -> None:
    path = FIX / "si2_rdyn" / "si2.prot"
    whole = path.read_text().splitlines()
    first = read_protocol_text(path, offset=0, limit=10)
    assert first.offset == 0
    assert first.text.splitlines() == whole[:10]
    # a client paging past the end is clamped to the last line rather than refused: it must not
    # be possible to page a log into an error
    far = read_protocol_text(path, offset=10**9, limit=10)
    assert far.offset == len(whole) - 1
    assert far.text.splitlines() == whole[-1:]
    before = read_protocol_text(path, offset=-5, limit=3)
    assert before.offset == 0


def test_run_starts_marks_each_appended_run() -> None:
    page = read_protocol_text(FIX / "si2_rdyn" / "si2.prot", offset=0, limit=1)
    lines = (FIX / "si2_rdyn" / "si2.prot").read_text().splitlines()
    assert page.run_starts == [i for i, ln in enumerate(lines) if ln.startswith("PROGRAM STARTED")]


def test_missing_protocol_is_not_found() -> None:
    with pytest.raises(FileNotFoundError):
        read_protocol_text(FIX / "si2_rdyn" / "nothing-here.prot")


@pytest.mark.parametrize(
    ("name", "symbol"),
    [("O_1", "O"), ("H_2", "H"), ("SI1", "Si"), ("SI12", "Si"), ("FE1", "Fe"), ("AL_3", "Al")],
)
def test_the_element_is_recoverable_from_the_atom_name(name: str, symbol: str) -> None:
    """``strc.atom_name`` pads the symbol to two characters with ``_`` and appends an index."""
    assert symbol_of(name) == symbol


def test_geometries_carry_forces_energies_and_the_cell() -> None:
    traj = protocol_structures(FIX / "si2_rdyn", "si2")
    assert traj is not None
    assert traj.kind == "protocol"
    assert traj.symbols == ["Si", "Si"]
    assert traj.n_frames >= 2
    # every frame has the same atom count, or the trajectory model would have refused it
    assert all(len(f.positions) == 2 for f in traj.frames)
    assert traj.frames[-1].cell is not None
    # the starting geometry is reported before there is an energy for it, so it has none while
    # the last frame -- the converged one -- does
    assert traj.frames[0].energy is None
    assert traj.frames[-1].energy is not None


def test_energies_are_aligned_at_the_end_not_the_start() -> None:
    """The final frame must carry the final energy: a one-frame shift would be invisible."""
    prot = parse_protocol(FIX / "si2_rdyn" / "si2.prot")
    traj = protocol_structures(FIX / "si2_rdyn", "si2")
    assert traj is not None
    assert prot.energy_reports[-1].total_h is not None
    assert traj.frames[-1].energy == pytest.approx(prot.energy_reports[-1].total_h * Hartree)


def test_a_missing_protocol_raises_rather_than_reporting_no_geometry(tmp_path: Path) -> None:
    """The route turns this into a 404 naming the file, which says more than "no geometry"."""
    with pytest.raises(FileNotFoundError):
        protocol_structures(FIX / "si2_rdyn", "does-not-exist")
    # a protocol that exists but reports no atom list is the case that yields nothing
    (tmp_path / "case.prot").write_text("PROGRAM STARTED\nnothing useful here\n")
    assert protocol_structures(tmp_path, "case") is None


def test_given_symbols_win_when_they_fit() -> None:
    """The calculation's own structure has the element names as the user wrote them."""
    traj = protocol_structures(FIX / "si2_rdyn", "si2", symbols=["Ge", "Ge"])
    assert traj is not None
    assert traj.symbols == ["Ge", "Ge"]
    # ...and a list of the wrong length is ignored rather than corrupting the frames
    traj = protocol_structures(FIX / "si2_rdyn", "si2", symbols=["Ge"])
    assert traj is not None
    assert traj.symbols == ["Si", "Si"]
