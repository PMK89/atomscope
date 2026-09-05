"""The line shapes are unit-area, so a broadened stick integrates back to its intensity."""

from __future__ import annotations

import math

import numpy as np
import pytest

from atomscope.analysis.broadening import (
    auto_grid,
    broaden,
    gaussian,
    lorentzian,
    to_transmittance,
)


def test_gaussian_integrates_to_one() -> None:
    x = np.linspace(-50.0, 50.0, 200001)
    y = gaussian(x, 0.0, 10.0)
    assert np.trapezoid(y, x) == pytest.approx(1.0, rel=1e-9)


def test_gaussian_half_maximum_is_at_half_the_width() -> None:
    width = 12.0
    peak = float(gaussian(np.array([0.0]), 0.0, width)[0])
    half = float(gaussian(np.array([width / 2]), 0.0, width)[0])
    assert half == pytest.approx(peak / 2, rel=1e-12)


def test_lorentzian_integrates_to_one_analytically() -> None:
    """A Lorentzian on a finite window integrates to (2/pi) arctan(W / gamma), not to 1."""
    width = 4.0
    gamma = width / 2
    window = 200.0
    x = np.linspace(-window, window, 400001)
    y = lorentzian(x, 0.0, width)
    expected = (2.0 / math.pi) * math.atan(window / gamma)
    assert np.trapezoid(y, x) == pytest.approx(expected, rel=1e-6)
    assert expected < 1.0


def test_lorentzian_half_maximum_is_at_half_the_width() -> None:
    width = 7.0
    peak = float(lorentzian(np.array([0.0]), 0.0, width)[0])
    half = float(lorentzian(np.array([width / 2]), 0.0, width)[0])
    assert half == pytest.approx(peak / 2, rel=1e-12)


def test_broaden_preserves_total_intensity() -> None:
    centers = np.array([100.0, 300.0, 305.0])
    intensities = np.array([2.0, 5.0, 1.0])
    x = np.linspace(-200.0, 600.0, 400001)
    y = broaden(x, centers, intensities, 8.0, "gaussian")
    assert np.trapezoid(y, x) == pytest.approx(intensities.sum(), rel=1e-6)


def test_broaden_rejects_a_non_positive_width() -> None:
    with pytest.raises(ValueError, match="positive"):
        broaden(np.zeros(3), np.array([1.0]), np.array([1.0]), 0.0)


def test_broaden_rejects_mismatched_lengths() -> None:
    with pytest.raises(ValueError, match="intensities"):
        broaden(np.zeros(3), np.array([1.0, 2.0]), np.array([1.0]), 1.0)


def test_auto_grid_covers_every_peak_with_margin() -> None:
    grid = auto_grid(np.array([500.0, 1500.0]), 20.0, points=101, margin=5.0)
    assert grid[0] == pytest.approx(400.0)
    assert grid[-1] == pytest.approx(1600.0)
    assert len(grid) == 101


def test_transmittance_is_bounded_and_monotone() -> None:
    absorbance = np.array([0.0, 1.0, 10.0, 1e6])
    t = to_transmittance(absorbance, 1.0)
    assert t[0] == pytest.approx(100.0)
    assert t[1] == pytest.approx(10.0)
    assert np.all(np.diff(t) <= 0)
    assert t.min() >= 0.0 and t.max() <= 100.0
