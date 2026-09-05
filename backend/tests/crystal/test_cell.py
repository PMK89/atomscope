import numpy as np
import pytest

from atomscope import crystal
from atomscope.model import Cell, Structure


def _frac(s: Structure) -> np.ndarray:
    return np.array(crystal.fractional_coordinates(s))


def test_cell_from_parameters_standard_orientation() -> None:
    m = np.array(crystal.cell_from_parameters((5.0, 6.0, 7.0, 90.0, 90.0, 120.0)))
    assert m[0, 1] == m[0, 2] == m[1, 2] == 0.0
    cell = Cell(vectors=crystal.cell_from_parameters((5.0, 6.0, 7.0, 90.0, 90.0, 120.0)))
    lengths, angles = cell.lengths_angles()
    assert np.allclose(lengths, (5, 6, 7)) and np.allclose(angles, (90, 90, 120))
    with pytest.raises(ValueError, match="positive"):
        crystal.cell_from_parameters((0.0, 1.0, 1.0, 90.0, 90.0, 90.0))


def test_set_cell_preserve_cartesian_vs_fractional(si_conventional: Structure) -> None:
    new = crystal.cell_from_parameters((6.0, 6.0, 6.0, 90.0, 90.0, 90.0))
    cart = crystal.set_cell(si_conventional, new, "cartesian")
    assert np.allclose(cart.positions(), si_conventional.positions())
    assert cart.cell is not None and np.allclose(cart.cell.vectors, new)
    frac = crystal.set_cell(si_conventional, new, "fractional")
    assert np.allclose(_frac(frac), _frac(si_conventional))
    assert np.allclose(frac.positions(), si_conventional.positions() * 6.0 / 5.43)
    # per-atom data survives
    assert [a.uid for a in frac.atoms] == [a.uid for a in si_conventional.atoms]
    assert frac.bonds == si_conventional.bonds


def test_set_cell_rejects_singular(nacl: Structure) -> None:
    with pytest.raises(ValueError, match="linearly dependent"):
        crystal.set_cell(nacl, ((1, 0, 0), (2, 0, 0), (0, 0, 1)))
    with pytest.raises(ValueError, match="linearly dependent"):
        crystal.set_cell(nacl, ((0, 0, 0), (0, 0, 0), (0, 0, 0)))


def test_set_cell_on_molecule_adds_cell(water: Structure) -> None:
    out = crystal.set_cell(water, ((10, 0, 0), (0, 10, 0), (0, 0, 10)), "fractional")
    assert out.cell is not None and out.cell.pbc == (True, True, True)
    assert np.allclose(out.positions(), water.positions())


def test_fractional_round_trip(nacl: Structure) -> None:
    f = crystal.fractional_coordinates(nacl)
    shifted = [(x + 0.25, y, z) for x, y, z in f]
    out = crystal.set_fractional_coordinates(nacl, shifted)
    assert np.allclose(_frac(out), shifted)
    with pytest.raises(ValueError, match="expected"):
        crystal.set_fractional_coordinates(nacl, shifted[:-1])


def test_wrap(nacl: Structure) -> None:
    moved = crystal.translate_atoms(nacl, (1.3, -0.7, 2.1), "fractional")
    assert (_frac(moved) > 1).any()
    wrapped = crystal.wrap_atoms(moved)
    f = _frac(wrapped)
    assert (f >= -1e-9).all() and (f < 1 - 1e-9).all()
    assert wrapped.n_atoms == nacl.n_atoms


def test_translate_cartesian_and_selection(nacl: Structure) -> None:
    out = crystal.translate_atoms(nacl, (1.0, 2.0, 3.0))
    assert np.allclose(out.positions() - nacl.positions(), (1.0, 2.0, 3.0))
    part = crystal.translate_atoms(nacl, (0.5, 0, 0), "fractional", indices=[0])
    delta = part.positions() - nacl.positions()
    assert np.allclose(delta[0], (2.82, 0, 0)) and np.allclose(delta[1:], 0)
    with pytest.raises(ValueError, match="out of range"):
        crystal.translate_atoms(nacl, (1, 0, 0), indices=[8])


def test_rotate_to_standard_orientation(si_primitive: Structure) -> None:
    assert si_primitive.cell is not None
    rotated = crystal.rotate_to_standard_orientation(si_primitive)
    assert rotated.cell is not None
    m = np.array(rotated.cell.vectors)
    assert np.allclose([m[0, 1], m[0, 2], m[1, 2]], 0.0)
    assert np.allclose(rotated.cell.lengths_angles(), si_primitive.cell.lengths_angles())
    d0 = np.linalg.norm(si_primitive.positions()[1] - si_primitive.positions()[0])
    d1 = np.linalg.norm(rotated.positions()[1] - rotated.positions()[0])
    assert d0 == pytest.approx(d1)


def test_scale_to_volume(si_conventional: Structure) -> None:
    out = crystal.scale_to_volume(si_conventional, 200.0)
    assert out.cell is not None and out.cell.volume() == pytest.approx(200.0)
    assert np.allclose(_frac(out), _frac(si_conventional))
    with pytest.raises(ValueError, match="positive"):
        crystal.scale_to_volume(si_conventional, -1.0)


def test_add_and_remove_cell(water: Structure) -> None:
    boxed = crystal.add_cell(water, padding=5.0)
    assert boxed.cell is not None and boxed.cell.pbc == (True, True, True)
    lengths, _ = boxed.cell.lengths_angles()
    assert lengths[0] == pytest.approx(1.52 + 10.0) and lengths[2] == pytest.approx(10.0)
    f = _frac(boxed)
    assert (f > 0).all() and (f < 1).all()
    assert boxed.n_atoms == 3 and boxed.bonds == water.bonds
    assert crystal.add_cell(boxed) == boxed
    bare = crystal.remove_cell(boxed)
    assert bare.cell is None and np.allclose(bare.positions(), boxed.positions())
    with pytest.raises(ValueError, match="no unit cell"):
        crystal.wrap_atoms(water)


@pytest.mark.parametrize(
    ("cellpar", "expected"),
    [
        ((4, 4, 4, 90, 90, 90), "cubic"),
        ((4, 4, 6, 90, 90, 90), "tetragonal"),
        ((4.0, 4.003, 4.006, 90, 90, 90), "orthorhombic"),
        ((4, 5, 6, 90, 90, 90), "orthorhombic"),
        ((4, 4, 6, 90, 90, 120), "hexagonal"),
        ((4, 4, 4, 70, 70, 70), "rhombohedral"),
        ((4, 5, 6, 90, 100, 90), "monoclinic"),
        ((4, 5, 6, 80, 100, 95), "triclinic"),
    ],
)
def test_lattice_type_from_parameters(
    cellpar: tuple[float, float, float, float, float, float], expected: str
) -> None:
    cell = Cell(vectors=crystal.cell_from_parameters(cellpar))
    assert crystal.lattice_type_from_parameters(cell) == expected


def test_lattice_type_from_spacegroup() -> None:
    assert crystal.lattice_type_from_spacegroup(1, "P1") == "triclinic"
    assert crystal.lattice_type_from_spacegroup(14, "P2_1/c") == "monoclinic"
    assert crystal.lattice_type_from_spacegroup(62, "Pnma") == "orthorhombic"
    assert crystal.lattice_type_from_spacegroup(139, "I4/mmm") == "tetragonal"
    assert crystal.lattice_type_from_spacegroup(167, "R-3c") == "rhombohedral"
    assert crystal.lattice_type_from_spacegroup(164, "P-3m1") == "hexagonal"
    assert crystal.lattice_type_from_spacegroup(194, "P6_3/mmc") == "hexagonal"
    assert crystal.lattice_type_from_spacegroup(227, "Fd-3m") == "cubic"
    with pytest.raises(ValueError, match="invalid"):
        crystal.lattice_type_from_spacegroup(231, "?")
