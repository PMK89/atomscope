"""Normal modes from finite differences, checked against physics we know.

Water: three vibrations, the bend well below the two stretches. CO2: linear, so five trivial
modes and 3N-5 = 4 vibrations with a doubly degenerate bend. In both cases the zero-point energy
is positive and the displacement vectors are unit-normalised.
"""

from __future__ import annotations

import numpy as np
import pytest

from atomscope.analysis.vibrations import (
    VibrationError,
    compute_modes,
    frequencies_cm,
    make_engine,
    trivial_basis,
)
from atomscope.ase_bridge.openbabel_calculator import OpenBabelCalculator
from atomscope.chem import forcefield
from atomscope.chem.hydrogens import perceive_bonds
from atomscope.model import Atom, Structure, VibrationalSpectrum


def _structure(symbols: list[str], positions: list[tuple[float, float, float]]) -> Structure:
    s = Structure(
        name="test",
        atoms=[Atom(element=e, position=p) for e, p in zip(symbols, positions, strict=True)],
    )
    return perceive_bonds(s)


def _relaxed_modes(structure: Structure, force_field: str = "MMFF94") -> VibrationalSpectrum:
    """A Hessian is only meaningful at a stationary point, so minimise tightly first."""
    opt = forcefield.optimize(
        structure,
        force_field,
        algorithm="conjugate_gradients",
        max_steps=5000,
        convergence=1e-12,
    )
    engine = make_engine(opt.structure, OpenBabelCalculator(force_field), dipole="partial_charges")
    return compute_modes(opt.structure, engine, method=force_field)


@pytest.fixture(scope="module")
def water() -> VibrationalSpectrum:
    return _relaxed_modes(
        _structure(
            ["O", "H", "H"],
            [(0.0, 0.0, 0.117), (0.0, 0.757, -0.469), (0.0, -0.757, -0.469)],
        )
    )


@pytest.fixture(scope="module")
def carbon_dioxide() -> VibrationalSpectrum:
    return _relaxed_modes(
        _structure(["C", "O", "O"], [(0.0, 0.0, 0.0), (0.0, 0.0, 1.16), (0.0, 0.0, -1.16)])
    )


def test_water_has_three_vibrations_with_the_bend_below_the_stretches(
    water: VibrationalSpectrum,
) -> None:
    assert len(water.modes) == 3
    assert len(water.trivial_modes) == 6
    bend, stretch_1, stretch_2 = (m.frequency for m in water.modes)
    assert 1200.0 < bend < 1900.0
    assert stretch_1 > 3000.0 and stretch_2 > 3000.0
    # the bend is clearly below both stretches, not merely below by rounding
    assert stretch_1 - bend > 1000.0


def test_water_is_not_linear_and_has_a_positive_zero_point_energy(
    water: VibrationalSpectrum,
) -> None:
    assert water.linear is False
    assert water.zero_point_energy is not None and water.zero_point_energy > 0
    # 1/2 h nu summed over the three modes, in eV
    expected = 0.5 * sum(m.frequency for m in water.modes) * 1.239841984e-4
    assert water.zero_point_energy == pytest.approx(expected, rel=1e-6)


def test_water_modes_are_unit_normalised_cartesian_vectors(water: VibrationalSpectrum) -> None:
    for mode in water.modes:
        assert len(mode.displacements) == 3
        assert np.linalg.norm(np.asarray(mode.displacements)) == pytest.approx(1.0, rel=1e-9)
        assert mode.reduced_mass is not None and mode.reduced_mass > 0
        assert mode.force_constant is not None and mode.force_constant > 0
        assert mode.kind == "vibration"


def test_water_ir_intensities_are_present_and_non_negative(water: VibrationalSpectrum) -> None:
    assert all(m.ir_intensity is not None for m in water.modes)
    assert all((m.ir_intensity or 0.0) >= 0.0 for m in water.modes)
    assert max(m.ir_intensity or 0.0 for m in water.modes) > 0.0


def test_water_trivial_modes_are_near_zero_and_labelled(water: VibrationalSpectrum) -> None:
    assert {m.kind for m in water.trivial_modes} == {"translation", "rotation"}
    assert sum(m.kind == "translation" for m in water.trivial_modes) == 3
    # at a converged minimum the six trivial frequencies are far below the real ones
    assert max(abs(m.frequency) for m in water.trivial_modes) < 100.0
    assert min(m.frequency for m in water.modes) > 500.0


def test_carbon_dioxide_is_linear_with_five_trivial_modes(
    carbon_dioxide: VibrationalSpectrum,
) -> None:
    assert carbon_dioxide.linear is True
    assert len(carbon_dioxide.trivial_modes) == 5
    assert len(carbon_dioxide.modes) == 4  # 3N - 5
    assert sum(m.kind == "rotation" for m in carbon_dioxide.trivial_modes) == 2


def test_carbon_dioxide_bend_is_doubly_degenerate(carbon_dioxide: VibrationalSpectrum) -> None:
    f = [m.frequency for m in carbon_dioxide.modes]
    assert f[0] == pytest.approx(f[1], rel=1e-3)  # degenerate bend
    assert f[2] > f[1] and f[3] > f[2]  # symmetric then antisymmetric stretch


def test_trivial_basis_ranks_match_the_geometry() -> None:
    masses = np.array([12.0, 16.0, 16.0])
    linear = np.array([[0.0, 0.0, 0.0], [0.0, 0.0, 1.16], [0.0, 0.0, -1.16]])
    bent = np.array([[0.0, 0.0, 0.0], [0.0, 0.9, 0.6], [0.0, -0.9, 0.6]])
    assert trivial_basis(linear, masses)[1].shape[1] == 2
    assert trivial_basis(bent, masses)[1].shape[1] == 3
    assert trivial_basis(bent, masses)[0].shape[1] == 3


def test_frequencies_of_negative_eigenvalues_are_reported_as_imaginary() -> None:
    values = np.array([-1.0, 0.0, 1.0])
    freqs = frequencies_cm(values)
    assert freqs[0] < 0 and freqs[1] == 0.0 and freqs[2] > 0
    assert freqs[0] == pytest.approx(-freqs[2])


def test_a_single_atom_has_no_normal_modes() -> None:
    lone = Structure(name="he", atoms=[Atom(element="He", position=(0.0, 0.0, 0.0))])
    with pytest.raises(VibrationError, match="two atoms"):
        compute_modes(lone, make_engine(lone, OpenBabelCalculator()))
