"""Unit tags and conversions.

Internal storage follows ASE conventions (Å, eV, fs, e, μB). Constants are taken from
``ase.units`` so that Atomscope and ASE agree exactly. CP-PAW works in Hartree atomic units;
its adapter converts at the boundary using these functions.
"""

from __future__ import annotations

from enum import StrEnum

from ase import units as _u


class Unit(StrEnum):
    """Units that can appear on quantities in the data model."""

    # length
    ANGSTROM = "angstrom"
    BOHR = "bohr"
    NANOMETER = "nm"
    # energy
    EV = "eV"
    HARTREE = "hartree"
    KJ_PER_MOL = "kJ/mol"
    KCAL_PER_MOL = "kcal/mol"
    RYDBERG = "rydberg"
    # force
    EV_PER_ANGSTROM = "eV/angstrom"
    HARTREE_PER_BOHR = "hartree/bohr"
    # time
    FEMTOSECOND = "fs"
    ATOMIC_TIME = "atomic_time"
    PICOSECOND = "ps"
    # misc
    ELEMENTARY_CHARGE = "e"
    BOHR_MAGNETON = "muB"
    KELVIN = "K"
    WAVENUMBER = "cm^-1"
    DEBYE = "debye"
    E_ANGSTROM = "e*angstrom"
    DIMENSIONLESS = ""
    # densities (per volume)
    E_PER_ANGSTROM3 = "e/angstrom^3"
    E_PER_BOHR3 = "e/bohr^3"
    # potentials
    VOLT = "V"
    HARTREE_PER_E = "hartree/e"


# Factors converting a value in the given unit to the internal (ASE) unit of the same kind.
_TO_INTERNAL: dict[Unit, float] = {
    Unit.ANGSTROM: 1.0,
    Unit.BOHR: _u.Bohr,
    Unit.NANOMETER: 10.0,
    Unit.EV: 1.0,
    Unit.HARTREE: _u.Hartree,
    Unit.RYDBERG: _u.Rydberg,
    Unit.KJ_PER_MOL: _u.kJ / _u.mol,
    Unit.KCAL_PER_MOL: _u.kcal / _u.mol,
    Unit.EV_PER_ANGSTROM: 1.0,
    Unit.HARTREE_PER_BOHR: _u.Hartree / _u.Bohr,
    Unit.FEMTOSECOND: 1.0,
    Unit.PICOSECOND: 1000.0,
    Unit.ATOMIC_TIME: _u._aut * 1e15,  # atomic unit of time in fs
    Unit.ELEMENTARY_CHARGE: 1.0,
    Unit.BOHR_MAGNETON: 1.0,
    Unit.KELVIN: 1.0,
    Unit.WAVENUMBER: 1.0,
    Unit.DEBYE: _u.Debye,
    Unit.E_ANGSTROM: 1.0,
    Unit.DIMENSIONLESS: 1.0,
    Unit.E_PER_ANGSTROM3: 1.0,
    Unit.E_PER_BOHR3: 1.0 / _u.Bohr**3,
    Unit.VOLT: 1.0,
    Unit.HARTREE_PER_E: _u.Hartree,
}

_KIND: dict[Unit, str] = {
    Unit.ANGSTROM: "length",
    Unit.BOHR: "length",
    Unit.NANOMETER: "length",
    Unit.EV: "energy",
    Unit.HARTREE: "energy",
    Unit.RYDBERG: "energy",
    Unit.KJ_PER_MOL: "energy",
    Unit.KCAL_PER_MOL: "energy",
    Unit.EV_PER_ANGSTROM: "force",
    Unit.HARTREE_PER_BOHR: "force",
    Unit.FEMTOSECOND: "time",
    Unit.PICOSECOND: "time",
    Unit.ATOMIC_TIME: "time",
    Unit.ELEMENTARY_CHARGE: "charge",
    Unit.BOHR_MAGNETON: "magnetic_moment",
    Unit.KELVIN: "temperature",
    Unit.WAVENUMBER: "frequency",
    Unit.DEBYE: "dipole",
    Unit.E_ANGSTROM: "dipole",
    Unit.DIMENSIONLESS: "dimensionless",
    Unit.E_PER_ANGSTROM3: "density",
    Unit.E_PER_BOHR3: "density",
    Unit.VOLT: "potential",
    Unit.HARTREE_PER_E: "potential",
}


class UnitError(ValueError):
    """Raised when converting between incompatible units."""


def convert(value: float, from_unit: Unit, to_unit: Unit) -> float:
    """Convert ``value`` between two units of the same physical kind."""
    if _KIND[from_unit] != _KIND[to_unit]:
        msg = f"cannot convert {from_unit!s} ({_KIND[from_unit]}) to {to_unit!s} ({_KIND[to_unit]})"
        raise UnitError(msg)
    return value * _TO_INTERNAL[from_unit] / _TO_INTERNAL[to_unit]


def kind_of(unit: Unit) -> str:
    """Physical kind ("length", "energy", ...) of a unit."""
    return _KIND[unit]
