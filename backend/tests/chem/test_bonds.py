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


def test_molecular_and_periodic_paths_agree() -> None:
    """The KD-tree path (no cell) and ASE's neighbour list (large cell) must find the same bonds."""
    atoms = molecule("CH3CH2OCH3")
    free = perceive_bonds(from_atoms(atoms))
    boxed = atoms.copy()
    boxed.set_cell([100.0, 100.0, 100.0])
    boxed.set_pbc(True)
    boxed.center()
    assert [(b.a, b.b) for b in free] == [(b.a, b.b) for b in perceive_bonds(from_atoms(boxed))]
    assert free != []


def test_bonds_are_sorted_and_unique() -> None:
    bonds = perceive_bonds(from_atoms(molecule("C6H6")))
    keys = [(b.a, b.b) for b in bonds]
    assert all(a < b for a, b in keys)
    assert keys == sorted(keys)
    assert len(set(keys)) == len(keys)
