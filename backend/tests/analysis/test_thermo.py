"""Thermochemistry against ASE's own asserted numbers.

Every golden here is copied from `ase/test/test_thermochemistry.py` in the installed ASE, not
computed by this code and not remembered: if the wrapper mixes an argument up or converts a unit
wrongly, the number moves. The conversion from cm^-1 is checked separately, because it is the one
piece ASE does not do.
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from ase import Atoms, units
from ase.build import molecule
from ase.calculators.emt import EMT
from ase.optimize import QuasiNewton

from atomscope.analysis.thermo import (
    HinderedParameters,
    ThermoError,
    detect_geometry,
    energies_ev,
    thermo_table,
)
from atomscope.analysis.vibrations import compute_modes, make_engine
from atomscope.ase_bridge import from_atoms


def relaxed_n2() -> tuple[object, float]:
    """ASE's own N2: EMT-relaxed from 1.1 A, with the potential energy its goldens include.

    `get_enthalpy` returns E_pot + ZPE + the thermal terms, so the potential energy has to be the
    same one ASE's test passed or the enthalpy golden is out by exactly that energy.
    """
    atoms = Atoms("N2", positions=[(0, 0, 0), (0, 0, 1.1)])
    atoms.calc = EMT()
    QuasiNewton(atoms, logfile=None).run(fmax=0.01)
    return from_atoms(atoms, name="n2"), float(atoms.get_potential_energy())


# ase/test/test_thermochemistry.py::test_ideal_gas_thermo_n2, for the EMT-relaxed N2 whose one
# real mode is 0.15264748 eV
N2_MODE_EV = 1.52647479e-01
N2_ZPE = 0.07632373926263808
N2_ENTHALPY_1000 = 0.6719935644272014
N2_ENTROPY_1000 = 0.0017861226676818658

# ::test_ideal_gas_thermo_ch3 -- deliberately toy frequencies, in an unsorted list
CH3_MODES_EV = [1.0, 0.05, 0.08, 0.1, 0.2, 0.3, 0.4, 0.35, 0.12]
CH3_KEPT_EV = [0.12, 0.2, 0.3, 0.35, 0.4, 1.0]
CH3_ZPE = 1.185
CH3_ENTHALPY_1000 = 10.610695269124156
CH3_ENTROPY_1000 = 0.0019310086280219891
# ASE's `CH3_THERMO` dict also carries a "gibbs" entry, 8.678687641495167. It is **not** asserted
# anywhere in ASE's own test file, and it disagrees by 1 meV with the H and S that file does
# assert (10.610695269124156 - 1000*0.0019310086280219891 = 8.679686641102167). It is stale, so
# the identity is pinned here instead of that number.

# ::test_harmonic_thermo
HARMONIC_MODES_EV = [0.00959394, 0.00959394, 0.01741657]
HARMONIC_E_POT = 4.120517148154894
HARMONIC_HELMHOLTZ_298 = 4.060698673180732

# ::test_hindered_thermo1, which is the example in ASE's own documentation. ASE writes them as
# wavenumbers divided by 8065.54429 (that is `units.invcm`), so they go in as they stand -- 24 of
# them, of which `HinderedThermo` keeps 3N-3 = 21 for the ten-atom ethane it describes.
HINDERED_MODES_CM = [
    3049.060670,
    3040.796863,
    3001.661338,
    2997.961647,
    2866.153162,
    2750.855460,
    1436.792655,
    1431.413595,
    1415.952186,
    1395.726300,
    1358.412432,
    1335.922737,
    1167.009954,
    1142.126116,
    1013.918680,
    803.400098,
    783.026031,
    310.448278,
    136.112935,
    112.939853,
    103.926392,
    77.262869,
    60.278004,
    25.825447,
]
HINDERED_HELMHOLTZ_298 = 1.5932242071261076

CM = 1.0 / units.invcm  # eV -> cm^-1


def as_cm(energies_ev_list: list[float]) -> list[float]:
    return [e * CM for e in energies_ev_list]


def test_frequencies_in_wavenumbers_become_energies_in_ev() -> None:
    # 1000 cm^-1 is 0.12398 eV; the constant is ASE's, so this pins the direction of the division
    assert energies_ev([1000.0])[0].real == pytest.approx(0.12398, abs=1e-5)
    # a negative wavenumber is `vibrations.frequencies_cm`'s imaginary mode and must become one
    imaginary = energies_ev([-500.0])[0]
    assert imaginary.real == 0.0
    assert imaginary.imag == pytest.approx(500.0 * units.invcm)
    assert np.iscomplex(imaginary)


def test_ideal_gas_matches_ase_for_n2() -> None:
    structure, energy = relaxed_n2()
    table = thermo_table(
        "ideal-gas",
        as_cm([N2_MODE_EV]),
        [1000.0],
        structure=structure,
        potential_energy_ev=energy,
        symmetry_number=2,
        spin=0,
        pressure_pa=1e8,
    )
    assert table.free_energy_kind == "gibbs"
    assert table.geometry == "linear"
    assert table.n_modes == 1
    assert table.zpe_ev == pytest.approx(N2_ZPE, rel=1e-6)
    point = table.points[0]
    assert point.enthalpy_ev == pytest.approx(N2_ENTHALPY_1000, rel=1e-6)
    assert point.entropy_ev_per_k == pytest.approx(N2_ENTROPY_1000, rel=1e-6)
    # ASE asserts the same identity, and it is what makes G a Gibbs energy rather than an H
    assert point.free_energy_ev == pytest.approx(point.enthalpy_ev - 1000 * point.entropy_ev_per_k)
    assert point.ts_ev == pytest.approx(1000 * point.entropy_ev_per_k)


def test_ideal_gas_trims_the_modes_to_the_geometry_as_ase_does() -> None:
    """Nine modes for a four-atom nonlinear molecule: ASE keeps the six largest."""
    table = thermo_table(
        "ideal-gas",
        as_cm(CH3_MODES_EV),
        [1000.0],
        structure=from_atoms(molecule("CH3"), name="ch3"),
        potential_energy_ev=9.0,
        symmetry_number=6,
        spin=0.5,
        pressure_pa=1e8,
    )
    assert table.n_modes == len(CH3_KEPT_EV)
    assert table.zpe_ev == pytest.approx(CH3_ZPE, rel=1e-4)
    point = table.points[0]
    assert point.enthalpy_ev == pytest.approx(CH3_ENTHALPY_1000, rel=1e-6)
    assert point.entropy_ev_per_k == pytest.approx(CH3_ENTROPY_1000, rel=1e-6)
    assert point.free_energy_ev == pytest.approx(CH3_ENTHALPY_1000 - 1000 * CH3_ENTROPY_1000)


def test_the_symmetry_number_changes_the_entropy_and_nothing_else() -> None:
    """It is the caller's to supply, so it has to reach ASE -- sigma=1 vs 6 differs by R*ln 6."""
    common = {
        "frequencies_cm": as_cm(CH3_MODES_EV),
        "temperatures_k": [1000.0],
        "structure": from_atoms(molecule("CH3"), name="ch3"),
        "spin": 0.5,
        "pressure_pa": 1e8,
    }
    one = thermo_table("ideal-gas", symmetry_number=1, **common).points[0]  # type: ignore[arg-type]
    six = thermo_table("ideal-gas", symmetry_number=6, **common).points[0]  # type: ignore[arg-type]
    assert one.enthalpy_ev == pytest.approx(six.enthalpy_ev)
    assert one.entropy_ev_per_k - six.entropy_ev_per_k == pytest.approx(
        units.kB * math.log(6), rel=1e-6
    )


def test_the_geometry_is_read_off_the_moments_of_inertia() -> None:
    """ASE takes the word 'linear' and trusts it, so the word has to be right."""
    assert detect_geometry(molecule("CO2")) == "linear"
    assert detect_geometry(molecule("H2O")) == "nonlinear"
    assert detect_geometry(Atoms("Ar", positions=[(0, 0, 0)])) == "monatomic"


def test_a_linear_molecule_keeps_one_more_mode_than_a_nonlinear_one() -> None:
    """A three-atom molecule has 3N-6 = 3 vibrations bent and 3N-5 = 4 straight."""
    modes = as_cm([0.05, 0.08, 0.1, 0.2, 0.3, 0.4])
    water = from_atoms(molecule("H2O"), name="w")
    co2 = from_atoms(molecule("CO2"), name="c")
    assert thermo_table("ideal-gas", modes, [300.0], structure=water).n_modes == 3
    assert thermo_table("ideal-gas", modes, [300.0], structure=co2).n_modes == 4
    # and the override wins over the detection, which is what a mode analysis uses it for
    assert (
        thermo_table("ideal-gas", modes, [300.0], structure=water, geometry="linear").n_modes == 4
    )


def test_the_ideal_gas_model_says_it_needs_the_molecule() -> None:
    with pytest.raises(ThermoError, match="needs the molecule"):
        thermo_table("ideal-gas", as_cm([0.1, 0.2, 0.3]), [300.0])


def test_harmonic_matches_ase() -> None:
    table = thermo_table(
        "harmonic",
        as_cm(HARMONIC_MODES_EV),
        [298.15],
        potential_energy_ev=HARMONIC_E_POT,
    )
    assert table.free_energy_kind == "helmholtz"
    assert table.geometry is None  # a harmonic oscillator has no shape to speak of
    assert table.n_modes == 3
    assert table.points[0].free_energy_ev == pytest.approx(HARMONIC_HELMHOLTZ_298, rel=1e-6)
    assert table.points[0].internal_energy_ev is not None
    assert table.points[0].enthalpy_ev is None
    assert table.points[0].pressure_pa is None
    # F = U - T*S, which is what makes this a Helmholtz energy
    assert table.points[0].free_energy_ev == pytest.approx(
        table.points[0].internal_energy_ev - table.points[0].ts_ev
    )


def test_harmonic_keeps_every_mode_it_is_given() -> None:
    """No geometry trimming: an adsorbate has no translations or rotations to subtract."""
    table = thermo_table("harmonic", as_cm([0.01] * 9), [300.0])
    assert table.n_modes == 9


def test_hindered_matches_ase() -> None:
    table = thermo_table(
        "hindered",
        HINDERED_MODES_CM,
        [298.15],
        hindered=HinderedParameters(
            trans_barrier_energy_ev=0.049313,
            rot_barrier_energy_ev=0.017675,
            site_density_cm2=1.5e15,
            rotational_minima=6,
            symmetry_number=1,
            mass_amu=30.07,
            inertia_amu_a2=73.149,
        ),
    )
    assert table.n_modes == 21
    assert table.points[0].free_energy_ev == pytest.approx(HINDERED_HELMHOLTZ_298, rel=1e-6)


def test_the_hindered_model_says_what_it_is_missing() -> None:
    barriers = HinderedParameters(
        trans_barrier_energy_ev=0.05,
        rot_barrier_energy_ev=0.02,
        site_density_cm2=1.5e15,
        rotational_minima=6,
    )
    with pytest.raises(ThermoError, match="barriers"):
        thermo_table("hindered", as_cm([0.01] * 6), [300.0])
    with pytest.raises(ThermoError, match="mass and moment of inertia"):
        thermo_table("hindered", as_cm([0.01] * 6), [300.0], hindered=barriers)


def test_the_hindered_model_takes_the_mass_from_the_adsorbate() -> None:
    """Given the adsorbate itself, ASE works the mass and the moment of inertia out."""
    ethane = from_atoms(molecule("C2H6"), name="ethane")
    given = thermo_table(
        "hindered",
        HINDERED_MODES_CM,
        [298.15],
        hindered=HinderedParameters(
            trans_barrier_energy_ev=0.049313,
            rot_barrier_energy_ev=0.017675,
            site_density_cm2=1.5e15,
            rotational_minima=6,
            mass_amu=30.07,
            inertia_amu_a2=73.149,
        ),
    )
    derived = thermo_table(
        "hindered",
        HINDERED_MODES_CM,
        [298.15],
        structure=ethane,
        hindered=HinderedParameters(
            trans_barrier_energy_ev=0.049313,
            rot_barrier_energy_ev=0.017675,
            site_density_cm2=1.5e15,
            rotational_minima=6,
        ),
    )
    # the mass is the same molecule's, so the free energy lands within a per cent of the
    # hand-entered one; the moment of inertia of ASE's idealised C2H6 is not exactly 73.149
    assert derived.n_modes == given.n_modes == 21
    assert derived.points[0].free_energy_ev == pytest.approx(
        given.points[0].free_energy_ev, rel=0.02
    )


def test_an_imaginary_mode_is_refused_and_can_be_ignored() -> None:
    modes = as_cm([0.01, 0.02, 0.03]) + [-250.0]
    with pytest.raises(ThermoError, match="1 imaginary mode"):
        thermo_table("harmonic", modes, [300.0])
    table = thermo_table("harmonic", modes, [300.0], ignore_imaginary=True)
    assert table.n_imaginary == 1
    assert table.n_modes == 3
    # and the answer is the one the real modes alone give
    assert table.points[0].free_energy_ev == pytest.approx(
        thermo_table("harmonic", as_cm([0.01, 0.02, 0.03]), [300.0]).points[0].free_energy_ev
    )


def test_empty_input_is_refused_rather_than_returning_zeros() -> None:
    with pytest.raises(ThermoError, match="no vibrational modes"):
        thermo_table("harmonic", [], [300.0])
    with pytest.raises(ThermoError, match="at least one temperature"):
        thermo_table("harmonic", as_cm([0.01]), [])
    with pytest.raises(ThermoError, match="absolute zero"):
        thermo_table("harmonic", as_cm([0.01]), [0.0])


def test_the_free_energy_falls_with_temperature() -> None:
    """The direction of -TS: a table is meant to be read as a curve, so it has to have one."""
    table = thermo_table("harmonic", as_cm([0.01, 0.02, 0.03]), [100.0, 300.0, 500.0, 1000.0])
    values = [p.free_energy_ev for p in table.points]
    assert values == sorted(values, reverse=True)
    assert [p.temperature_k for p in table.points] == [100.0, 300.0, 500.0, 1000.0]


def test_an_ase_relaxed_n2_reproduces_the_documented_zpe() -> None:
    """The whole path, from a real calculator through this module's own mode analysis."""
    structure, energy = relaxed_n2()
    spectrum = compute_modes(structure, make_engine(structure, EMT()))
    # a diatomic has one vibration, and `compute_modes` has already put the other five aside
    assert len(spectrum.modes) == 1
    assert spectrum.linear
    table = thermo_table(
        "ideal-gas",
        [m.frequency for m in spectrum.modes],
        [1000.0],
        structure=structure,
        potential_energy_ev=energy,
        geometry="linear" if spectrum.linear else "nonlinear",
        symmetry_number=2,
        pressure_pa=1e8,
    )
    # ASE's own golden for this molecule, reached through Atomscope's Hessian rather than ASE's
    assert table.zpe_ev == pytest.approx(N2_ZPE, rel=2e-3)
    assert table.points[0].enthalpy_ev == pytest.approx(N2_ENTHALPY_1000, rel=2e-3)
