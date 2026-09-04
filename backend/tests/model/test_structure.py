import math

import pytest
from pydantic import ValidationError

from atomscope.model import (
    Atom,
    AtomicVectorProperty,
    Bond,
    Cell,
    FixAtoms,
    Structure,
)
from atomscope.units import Unit


def water() -> Structure:
    return Structure(
        name="water",
        atoms=[
            Atom(element="O", position=(0.0, 0.0, 0.1173)),
            Atom(element="H", position=(0.0, 0.7572, -0.4692)),
            Atom(element="H", position=(0.0, -0.7572, -0.4692)),
        ],
        bonds=[Bond(a=0, b=1), Bond(a=0, b=2)],
    )


def test_formula_hill_order() -> None:
    assert water().formula() == "H2O"
    s = Structure(atoms=[Atom(element="C", position=(0, 0, 0))] * 0)
    assert s.formula() == ""
    ethanol = Structure(
        atoms=[Atom(element=e, position=(i, 0, 0)) for i, e in enumerate("CCOHHHHHH")]
    )
    assert ethanol.formula() == "C2H6O"


def test_invalid_element_rejected() -> None:
    with pytest.raises(ValidationError):
        Atom(element="Xx", position=(0, 0, 0))


def test_bond_out_of_range_rejected() -> None:
    with pytest.raises(ValidationError, match="outside"):
        Structure(atoms=[Atom(element="H", position=(0, 0, 0))], bonds=[Bond(a=0, b=1)])


def test_duplicate_bond_rejected() -> None:
    with pytest.raises(ValidationError, match="duplicate"):
        Structure(
            atoms=[Atom(element="H", position=(0, 0, 0)), Atom(element="H", position=(0.74, 0, 0))],
            bonds=[Bond(a=0, b=1), Bond(a=1, b=0)],
        )


def test_self_bond_rejected() -> None:
    with pytest.raises(ValidationError):
        Bond(a=1, b=1)


def test_atomic_property_length_checked() -> None:
    s = water()
    with pytest.raises(ValidationError, match="values for 3 atoms"):
        Structure(
            atoms=s.atoms,
            atomic_vectors={
                "forces": AtomicVectorProperty(values=[(0, 0, 0)], unit=Unit.EV_PER_ANGSTROM)
            },
        )


def test_constraint_range_checked() -> None:
    with pytest.raises(ValidationError, match="constraint"):
        Structure(atoms=water().atoms, constraints=[FixAtoms(indices=[5])])


def test_cell_geometry() -> None:
    c = Cell(vectors=((2.0, 0, 0), (0, 3.0, 0), (0, 0, 4.0)))
    assert math.isclose(c.volume(), 24.0)
    lengths, angles = c.lengths_angles()
    assert lengths == (2.0, 3.0, 4.0)
    assert all(math.isclose(a, 90.0) for a in angles)


def test_json_roundtrip_is_lossless_and_deterministic() -> None:
    s = water()
    s.cell = Cell(vectors=((10, 0, 0), (0, 10, 0), (0, 0, 10)), pbc=(False, False, False))
    s.constraints = [FixAtoms(indices=[0])]
    text = s.model_dump_json()
    again = Structure.model_validate_json(text)
    assert again == s
    assert again.model_dump_json() == text
    assert not again.is_periodic()


def test_unknown_field_rejected() -> None:
    with pytest.raises(ValidationError):
        Atom(element="H", position=(0, 0, 0), colour="red")  # type: ignore[call-arg]


def test_positions_array_shape() -> None:
    assert water().positions().shape == (3, 3)
    assert list(water().numbers()) == [8, 1, 1]
