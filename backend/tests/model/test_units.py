import math

import pytest
from ase import units as u

from atomscope.units import Unit, UnitError, convert, kind_of


def test_hartree_to_ev_matches_ase() -> None:
    assert math.isclose(convert(1.0, Unit.HARTREE, Unit.EV), u.Hartree, rel_tol=1e-12)


def test_bohr_to_angstrom_roundtrip() -> None:
    x = convert(1.0, Unit.BOHR, Unit.ANGSTROM)
    assert math.isclose(x, 0.529177, rel_tol=1e-5)
    assert math.isclose(convert(x, Unit.ANGSTROM, Unit.BOHR), 1.0, rel_tol=1e-12)


def test_force_conversion() -> None:
    f = convert(1.0, Unit.HARTREE_PER_BOHR, Unit.EV_PER_ANGSTROM)
    assert math.isclose(f, u.Hartree / u.Bohr, rel_tol=1e-12)


def test_incompatible_kinds_raise() -> None:
    with pytest.raises(UnitError):
        convert(1.0, Unit.EV, Unit.ANGSTROM)


def test_every_unit_has_kind() -> None:
    for unit in Unit:
        assert kind_of(unit)
        assert convert(2.0, unit, unit) == 2.0
