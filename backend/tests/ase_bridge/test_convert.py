import numpy as np
import pytest
from ase import Atoms
from ase.build import bulk, molecule

from atomscope.ase_bridge import from_atoms, to_atoms
from atomscope.model import (
    Atom,
    AtomicScalarProperty,
    AtomicVectorProperty,
    Bond,
    Cell,
    FixAtoms,
    FixBondLength,
    FixCartesian,
    Quantity,
    Structure,
)
from atomscope.units import Unit


def rich_structure() -> Structure:
    return Structure(
        name="rich",
        atoms=[
            Atom(element="O", position=(0.0, 0.0, 0.1173), label="O1"),
            Atom(element="H", position=(0.0, 0.7572, -0.4692), formal_charge=1),
            Atom(element="H", position=(0.0, -0.7572, -0.4692)),
        ],
        bonds=[Bond(a=0, b=1), Bond(a=0, b=2, order=1)],
        cell=Cell(vectors=((8, 0, 0), (0, 8, 0), (0, 0, 8)), pbc=(True, True, False)),
        charge=-1.0,
        multiplicity=2,
        atomic_scalars={
            "initial_charges": AtomicScalarProperty(
                values=[-0.8, 0.4, 0.4], unit=Unit.ELEMENTARY_CHARGE
            ),
            "mulliken": AtomicScalarProperty(values=[-0.6, 0.3, 0.3], unit=Unit.ELEMENTARY_CHARGE),
        },
        atomic_vectors={
            "forces": AtomicVectorProperty(
                values=[(0, 0, 0.1), (0, 0.1, 0), (0, -0.1, 0)], unit=Unit.EV_PER_ANGSTROM
            )
        },
        properties={"energy": Quantity(value=-14.2, unit=Unit.EV)},
        constraints=[
            FixAtoms(indices=[0]),
            FixCartesian(index=1, mask=(True, False, False)),
            FixBondLength(a=0, b=2),
        ],
    )


def test_roundtrip_is_lossless() -> None:
    s = rich_structure()
    atoms = to_atoms(s)
    assert len(atoms) == 3
    assert atoms.get_chemical_symbols() == ["O", "H", "H"]
    assert list(atoms.pbc) == [True, True, False]
    np.testing.assert_allclose(atoms.get_initial_charges(), [-0.8, 0.4, 0.4])
    back = from_atoms(atoms)
    # constraint order is not semantically meaningful
    key = lambda c: c.kind  # noqa: E731
    assert sorted(back.constraints, key=key) == sorted(s.constraints, key=key)
    back.constraints = s.constraints
    assert back == s


def test_from_plain_ase_molecule() -> None:
    s = from_atoms(molecule("CH4"), name="methane")
    assert s.formula() == "CH4"
    assert s.cell is None
    assert s.bonds == []
    assert len({a.uid for a in s.atoms}) == 5


def test_from_periodic_bulk() -> None:
    s = from_atoms(bulk("Si"))
    assert s.cell is not None
    assert s.is_periodic()
    assert abs(s.cell.volume() - bulk("Si").get_volume()) < 1e-9


def test_constraints_map_to_ase_classes() -> None:
    atoms = to_atoms(rich_structure())
    names = sorted(type(c).__name__ for c in atoms.constraints)
    assert names == ["FixAtoms", "FixBondLengths", "FixCartesian"]


def test_from_atoms_rejects_non_finite_positions() -> None:
    """from_atoms validates positions in bulk; a NaN must still be refused."""
    atoms = molecule("H2O")
    atoms.positions[1, 0] = np.nan
    with pytest.raises(ValueError, match="finite"):
        from_atoms(atoms)


def test_from_atoms_rejects_placeholder_element() -> None:
    atoms = Atoms(numbers=[0, 1], positions=[(0.0, 0.0, 0.0), (0.0, 0.0, 1.0)])
    with pytest.raises(ValueError, match="unknown element symbol"):
        from_atoms(atoms)


def test_from_atoms_positions_are_tuples() -> None:
    """Atoms are built without per-model validation, so the tuple shape must be built by hand."""
    s = from_atoms(molecule("H2O"))
    assert all(isinstance(a.position, tuple) and len(a.position) == 3 for a in s.atoms)
    assert s == Structure.model_validate_json(s.model_dump_json())
