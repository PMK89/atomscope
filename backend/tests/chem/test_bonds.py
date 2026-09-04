from ase.build import bulk, molecule

from atomscope.ase_bridge import from_atoms
from atomscope.chem.bonds import perceive_bonds


def test_water_has_two_oh_bonds() -> None:
    s = from_atoms(molecule("H2O"))
    bonds = perceive_bonds(s)
    assert sorted((b.a, b.b) for b in bonds) == [(0, 1), (0, 2)]


def test_benzene_ring_and_ch_bonds() -> None:
    s = from_atoms(molecule("C6H6"))
    bonds = perceive_bonds(s)
    assert len(bonds) == 12  # 6 C-C + 6 C-H


def test_periodic_silicon_four_neighbors() -> None:
    s = from_atoms(bulk("Si"))
    bonds = perceive_bonds(s)
    # 2-atom diamond cell: each atom bonded to the other via 4 images -> recorded once
    assert len(bonds) == 1
    assert perceive_bonds(from_atoms(bulk("Si").repeat((2, 2, 2)))) != []
