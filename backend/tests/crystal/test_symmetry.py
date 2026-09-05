import numpy as np
import pytest
from ase.build import bulk

from atomscope import crystal
from atomscope.ase_bridge.convert import from_atoms
from atomscope.model import Structure


def test_perceive_silicon(si_primitive: Structure) -> None:
    info = crystal.perceive_symmetry(si_primitive)
    assert (info.number, info.international) == (227, "Fd-3m")
    assert info.hall == "F 4d 2 3 -1d"
    assert info.point_group == "m-3m" and info.schoenflies == "Oh^7"
    assert info.lattice_type == "cubic"
    assert info.n_asymmetric == 1 and info.wyckoffs == ["b", "b"]
    assert info.n_operations == 48


def test_perceive_nacl_and_perovskite(nacl: Structure, perovskite: Structure) -> None:
    assert crystal.perceive_symmetry(nacl).international == "Fm-3m"
    assert crystal.perceive_symmetry(nacl).number == 225
    assert crystal.perceive_symmetry(perovskite).number == 221
    assert crystal.perceive_symmetry(perovskite).n_asymmetric == 3


def test_tolerance_matters(si_conventional: Structure) -> None:
    noisy = crystal.translate_atoms(si_conventional, (0.02, 0.0, 0.0), indices=[0])
    assert crystal.perceive_symmetry(noisy, symprec=1e-4).number < 227
    assert crystal.perceive_symmetry(noisy, symprec=0.1).number == 227


def test_symmetry_requires_cell(water: Structure) -> None:
    with pytest.raises(ValueError, match="no unit cell"):
        crystal.perceive_symmetry(water)
    with pytest.raises(ValueError, match="no atoms"):
        crystal.perceive_symmetry(Structure(cell={"vectors": np.eye(3).tolist()}))


def test_symmetrize_and_primitive(si_primitive: Structure, si_conventional: Structure) -> None:
    conv = crystal.symmetrize(si_primitive)
    assert conv.n_atoms == 8 and conv.cell is not None
    assert np.allclose(conv.cell.lengths_angles()[0], 5.43)
    assert crystal.symmetrize(conv).n_atoms == 8  # idempotent
    assert conv.id == si_primitive.id and conv.cell.pbc == (True, True, True)  # type: ignore[union-attr]
    prim = crystal.primitive_cell(si_conventional)
    assert prim.n_atoms == 2 and prim.cell is not None
    assert prim.cell.volume() == pytest.approx(5.43**3 / 4)
    std = crystal.primitive_standardized(si_conventional)
    assert std.n_atoms == 2 and crystal.perceive_symmetry(std).number == 227
    assert prim.bonds  # re-perceived (periodic minimum image)


def test_primitive_fcc_one_atom() -> None:
    cu = from_atoms(bulk("Cu", "fcc", a=3.6, cubic=True))
    assert cu.n_atoms == 4
    assert crystal.primitive_cell(cu).n_atoms == 1


def test_niggli(si_primitive: Structure) -> None:
    assert si_primitive.cell is not None
    m = np.array(si_primitive.cell.vectors)
    m[1] += 3 * m[0]  # skew the cell (same lattice)
    skewed = crystal.set_cell(si_primitive, tuple(map(tuple, m)), "cartesian")  # type: ignore[arg-type]
    reduced = crystal.niggli_reduce(skewed)
    assert reduced.cell is not None
    assert np.allclose(
        sorted(reduced.cell.lengths_angles()[0]), sorted(si_primitive.cell.lengths_angles()[0])
    )
    assert np.allclose(reduced.cell.lengths_angles()[1], 60.0)
    assert reduced.n_atoms == 2 and [a.uid for a in reduced.atoms] == [
        a.uid for a in si_primitive.atoms
    ]


def test_fill_and_reduce_round_trip(nacl: Structure, si_conventional: Structure) -> None:
    asym = crystal.asymmetric_unit(nacl)
    assert asym.n_atoms == 2 and sorted(asym.symbols()) == ["Cl", "Na"]
    filled = crystal.fill_unit_cell(asym, spacegroup=225)
    assert filled.n_atoms == 8 and crystal.perceive_symmetry(filled).number == 225
    # a complete cell is unchanged by filling with the perceived group
    assert crystal.fill_unit_cell(nacl).n_atoms == 8
    si_asym = crystal.asymmetric_unit(si_conventional)
    assert si_asym.n_atoms == 1
    assert crystal.fill_unit_cell(si_asym, spacegroup=227).n_atoms == 8
    with pytest.raises(ValueError, match="invalid"):
        crystal.fill_unit_cell(si_asym, spacegroup=300)
