import numpy as np
import pytest

from atomscope import crystal
from atomscope.model import Structure


def test_supercell(si_primitive: Structure, nacl: Structure) -> None:
    out = crystal.supercell(si_primitive, repeat=(2, 2, 2))
    assert out.n_atoms == 16 and out.cell is not None
    assert out.cell.volume() == pytest.approx(8 * si_primitive.cell.volume())  # type: ignore[union-attr]
    assert out.name == "Si 2x2x2" and out.id == si_primitive.id
    assert out.bonds
    m = crystal.supercell(nacl, matrix=((1, 1, 0), (-1, 1, 0), (0, 0, 1)))
    assert m.n_atoms == 16
    with pytest.raises(ValueError, match="either"):
        crystal.supercell(nacl)
    with pytest.raises(ValueError, match="integer"):
        crystal.supercell(nacl, matrix=((0.5, 0, 0), (0, 1, 0), (0, 0, 1)))


def test_slab(si_primitive: Structure, water: Structure) -> None:
    out = crystal.slab(si_primitive, (1, 1, 1), 3, vacuum=10.0)
    assert out.n_atoms == 6 and out.cell is not None
    assert out.cell.pbc == (True, True, False)
    lengths, _ = out.cell.lengths_angles()
    assert lengths[2] > 20.0
    z = out.positions()[:, 2]
    assert z.min() >= 10.0 - 1e-6 and z.max() <= lengths[2] - 10.0 + 1e-6
    assert out.name == "Si(111)"
    with pytest.raises(ValueError, match="no unit cell"):
        crystal.slab(water, (1, 0, 0), 1)
    with pytest.raises(ValueError, match="Miller"):
        crystal.slab(si_primitive, (0, 0, 0), 1)


def test_slab_fcc_copper() -> None:
    cu = crystal.bulk("Cu", "fcc", a=3.6)
    out = crystal.slab(cu, (1, 1, 1), 4, vacuum=8.0)
    assert out.n_atoms == 4 and out.cell is not None and out.cell.pbc == (True, True, False)


def test_bulk() -> None:
    si = crystal.bulk("Si", "diamond", a=5.43)
    assert si.n_atoms == 2 and crystal.perceive_symmetry(si).number == 227
    cubic = crystal.bulk("NaCl", "rocksalt", a=5.64, cubic=True)
    assert cubic.n_atoms == 8
    hcp = crystal.bulk("Mg", "hcp", a=3.21, c=5.21)
    assert hcp.n_atoms == 2 and crystal.perceive_symmetry(hcp).number == 194
    with pytest.raises(ValueError):
        crystal.bulk("Si", "nonsense")


def test_from_spacegroup() -> None:
    nacl = crystal.from_spacegroup(
        ["Na", "Cl"], [(0, 0, 0), (0.5, 0.5, 0.5)], 225, (5.64, 5.64, 5.64, 90, 90, 90)
    )
    assert nacl.n_atoms == 8 and nacl.name == "NaCl"
    assert crystal.perceive_symmetry(nacl).international == "Fm-3m"
    quartz = crystal.from_spacegroup(
        ["Si", "O"],
        [(0.4697, 0, 1 / 3), (0.4135, 0.2669, 0.1191)],
        152,
        (4.9134, 4.9134, 5.4052, 90, 90, 120),
        name="quartz",
    )
    assert quartz.n_atoms == 9 and quartz.formula() == "O6Si3"
    assert np.isclose(quartz.cell.volume(), 112.98, atol=0.1)  # type: ignore[union-attr]
    with pytest.raises(ValueError, match="same length"):
        crystal.from_spacegroup(["Na"], [(0, 0, 0), (0.5, 0.5, 0.5)], 225, (5, 5, 5, 90, 90, 90))
