import pytest
from ase.build import bulk
from ase.spacegroup import crystal

from atomscope.ase_bridge.convert import from_atoms
from atomscope.model import Atom, Structure


@pytest.fixture
def si_primitive() -> Structure:
    return from_atoms(bulk("Si", "diamond", a=5.43), name="Si")


@pytest.fixture
def si_conventional() -> Structure:
    return from_atoms(bulk("Si", "diamond", a=5.43, cubic=True), name="Si")


@pytest.fixture
def nacl() -> Structure:
    atoms = crystal(
        ["Na", "Cl"], [(0, 0, 0), (0.5, 0.5, 0.5)], spacegroup=225, cellpar=[5.64] * 3 + [90] * 3
    )
    return from_atoms(atoms, name="NaCl")


@pytest.fixture
def perovskite() -> Structure:
    atoms = crystal(
        ["Sr", "Ti", "O"],
        [(0, 0, 0), (0.5, 0.5, 0.5), (0.5, 0.5, 0)],
        spacegroup=221,
        cellpar=[3.905] * 3 + [90] * 3,
    )
    return from_atoms(atoms, name="SrTiO3")


@pytest.fixture
def water() -> Structure:
    return Structure(
        name="water",
        atoms=[
            Atom(element="O", position=(0.0, 0.0, 0.0)),
            Atom(element="H", position=(0.76, 0.59, 0.0)),
            Atom(element="H", position=(-0.76, 0.59, 0.0)),
        ],
    )
