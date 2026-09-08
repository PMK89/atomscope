"""The contour/rubbersheet plane files, against real output from ``paw_wave.x``.

The fixtures are the real thing with the data truncated: the header is byte-for-byte what
CP-PAW wrote -- which is where every parsing trap lives -- followed by the first three x-blocks
of sixty, a genuine 3x60 grid. The full 60x60 file is 288 kB, too big to keep in the repository,
and it is verified end to end where the real binaries run.
"""

from pathlib import Path

import pytest

from atomscope.backends.cppaw.gnuplane import find_planes, read_plane

FIX = Path(__file__).resolve().parents[2] / "fixtures" / "cppaw" / "plane"


def test_the_grid_shape_is_read_from_the_data_not_assumed() -> None:
    """``MAKEGNU`` hardcodes 60x60, but a parameter in a Fortran source is not a promise about a
    file already on disk -- and this fixture is deliberately 3x60."""
    plane = read_plane(FIX / "water_c.gnu")
    assert (plane.nx, plane.ny) == (3, 60)
    assert len(plane.x) == 3
    assert len(plane.y) == 60
    assert [len(row) for row in plane.values] == [60, 60, 60]


def test_lengths_come_back_in_angstrom() -> None:
    """CP-PAW writes Bohr. The cut is 6 Å wide, so y spans ±3."""
    plane = read_plane(FIX / "water_c.gnu")
    assert plane.y[0] == pytest.approx(-3.0, abs=1e-3)
    assert plane.y[-1] == pytest.approx(3.0, abs=1e-3)
    # x is the outer loop, so the truncated fixture only reaches the first three columns
    assert plane.x[0] == pytest.approx(-3.0, abs=1e-3)
    assert plane.x[1] > plane.x[0]


def test_the_header_comment_is_not_mistaken_for_the_data() -> None:
    """There are two 'DATA SECTION' lines; the first says 'TO BE CHANGED BY THE USER'.

    Starting at that one would read the gnuplot preamble as numbers.
    """
    text = (FIX / "water_c.gnu").read_text()
    assert "DATA SECTION TO BE CHANGED BY THE USER" in text.upper()
    plane = read_plane(FIX / "water_c.gnu")
    # a preamble read as data would give a ragged grid or absurd coordinates
    assert plane.nx * plane.ny == 180
    assert all(abs(v) <= 3.001 for v in plane.x + plane.y)


def test_the_view_is_the_one_the_file_suggests() -> None:
    """The contour file asks for a flat view and the rubbersheet for 30/20 -- the writer's own
    defaults, and what the rubbersheet's sliders start from."""
    contour = read_plane(FIX / "water_c.gnu")
    sheet = read_plane(FIX / "water_r.gnu")
    assert (contour.view.rot_x, contour.view.rot_z) == (0.0, 0.0)
    assert (sheet.view.rot_x, sheet.view.rot_z) == (30.0, 20.0)
    assert sheet.view.scale == pytest.approx(1.8)
    assert sheet.view.scale_z == pytest.approx(1.0)


def test_both_files_of_a_pair_carry_the_same_field() -> None:
    """Which is why one of each pair is enough to draw either plot."""
    contour = read_plane(FIX / "water_c.gnu")
    sheet = read_plane(FIX / "water_r.gnu")
    assert contour.values == sheet.values
    assert contour.x == sheet.x and contour.y == sheet.y


def test_the_z_range_is_the_writers_own() -> None:
    """``zmin``/``zmax`` describe the whole 60x60 field, not the truncated fixture, so they are
    taken from the header rather than recomputed."""
    plane = read_plane(FIX / "water_c.gnu")
    assert plane.z_max > max(max(row) for row in plane.values)


def test_find_planes_prefers_the_contour_of_a_pair(tmp_path: Path) -> None:
    (tmp_path / "a_c.gnu").write_text("x")
    (tmp_path / "a_r.gnu").write_text("x")
    (tmp_path / "b_r.gnu").write_text("x")  # a rubbersheet with no contour beside it
    assert [p.name for p in find_planes(tmp_path)] == ["a_c.gnu", "b_r.gnu"]


def test_a_file_without_a_data_section_is_refused(tmp_path: Path) -> None:
    """A partially written file must not become a plausible-looking plot."""
    bad = tmp_path / "empty_c.gnu"
    bad.write_text("# DATA SECTION TO BE CHANGED BY THE USER\n xmin= -1.0\n")
    with pytest.raises(ValueError, match="no data section"):
        read_plane(bad)


def test_a_ragged_grid_is_refused(tmp_path: Path) -> None:
    bad = tmp_path / "ragged_c.gnu"
    rows = "\n".join(f" 0.0 {j}.0 1.0" for j in range(3)) + "\n 1.0 0.0 1.0\n"
    bad.write_text("# DATA SECTION\n" + rows)
    with pytest.raises(ValueError, match="rectangular"):
        read_plane(bad)


def test_fortran_d_exponents_are_numbers(tmp_path: Path) -> None:
    """Fortran list-directed output can write D exponents; Python's float does not take them."""
    f = tmp_path / "d_c.gnu"
    f.write_text("# DATA SECTION\n 0.0 0.0 1.5D-3\n 0.0 1.0 2.5D-3\n")
    plane = read_plane(f)
    assert plane.values == [[pytest.approx(1.5e-3), pytest.approx(2.5e-3)]]
