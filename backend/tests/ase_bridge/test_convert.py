import numpy as np
import pytest
from ase import Atoms
from ase.build import bulk, molecule
from ase.constraints import FixInternals as AseFixInternals

from atomscope.ase_bridge import from_atoms, to_atoms
from atomscope.model import (
    Atom,
    AtomicScalarProperty,
    AtomicVectorProperty,
    Bond,
    Cell,
    FixAngle,
    FixAtoms,
    FixBondLength,
    FixCartesian,
    FixDihedral,
    IgnoreAtoms,
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


def test_internal_coordinate_constraints_round_trip() -> None:
    s = rich_structure()
    s.constraints = [
        FixAngle(a=1, b=0, c=2, value=104.5),
        FixDihedral(a=0, b=1, c=2, d=0),
        FixBondLength(a=0, b=1, value=0.98),
        IgnoreAtoms(indices=[2]),
    ]
    atoms = to_atoms(s)
    # angles, dihedrals and a bond with a target value all go into one ASE FixInternals
    assert sorted(type(c).__name__ for c in atoms.constraints) == ["FixInternals"]
    back = from_atoms(atoms)
    # an ignored atom has no ASE meaning, but the verbatim copy in atoms.info keeps it
    assert back.constraints == s.constraints


def test_constraints_come_from_ase_when_the_file_is_not_ours() -> None:
    atoms = molecule("H2O")
    atoms.set_constraint(
        AseFixInternals(angles_deg=[[104.5, [1, 0, 2]]], dihedrals_deg=[[None, [0, 1, 2, 0]]])
    )
    s = from_atoms(atoms)
    assert s.constraints == [
        FixAngle(a=1, b=0, c=2, value=104.5),
        FixDihedral(a=0, b=1, c=2, d=0, value=None),
    ]


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


def test_atoms_grown_by_extend_do_not_carry_the_wrong_per_atom_data() -> None:
    """``slab += adsorbate`` is a conversion that used to raise IndexError.

    ``ase.Atoms.extend`` -- which is what ``+=``, ``append`` and `ase.build.add_adsorbate` do --
    copies neither ``info`` nor the other object's per-atom arrays, so the combined object carries
    the *first* one's uid/label/formal-charge lists against a longer set of atoms. Reading them
    positionally walked off the end. Now data that cannot belong to these atoms is dropped, and
    the conversion succeeds; a user script doing this in the Scripts panel is the way in.
    """
    water = to_atoms(from_atoms(molecule("H2O"), name="water"))
    water.info["atomscope"]["bonds"] = [{"a": 0, "b": 1, "order": 1, "aromatic": False}]
    water.info["atomscope"]["atomic_scalars"] = {
        "q": {"values": [0.1, -0.05, -0.05], "unit": "e", "description": ""}
    }
    grown = water + molecule("CO")

    structure = from_atoms(grown, name="grown")
    assert structure.n_atoms == 5
    # fresh uids for all five rather than three reused ones
    assert len({a.uid for a in structure.atoms}) == 5
    # and the per-atom property of three atoms is not claimed to describe five
    assert "q" not in structure.atomic_scalars
    # a bond whose ends are both still present survives
    assert [b.key() for b in structure.bonds] == [(0, 1)]


def test_a_bond_to_a_removed_atom_is_dropped_rather_than_failing() -> None:
    water = to_atoms(from_atoms(molecule("H2O"), name="water"))
    water.info["atomscope"]["bonds"] = [
        {"a": 0, "b": 1, "order": 1, "aromatic": False},
        {"a": 0, "b": 2, "order": 1, "aromatic": False},
    ]
    del water[2]
    structure = from_atoms(water, name="oh")
    assert structure.n_atoms == 2
    assert [b.key() for b in structure.bonds] == [(0, 1)]
