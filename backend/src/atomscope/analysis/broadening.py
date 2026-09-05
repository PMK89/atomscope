"""Peak broadening: turn a list of sticks into a sampled curve.

Both line shapes are normalised to unit area over ``(-inf, inf)`` and parameterised by their
full width at half maximum ``w``, so a peak of intensity ``I`` contributes exactly ``I`` to the
integral of the curve and the two shapes are directly comparable.

Gaussian (FWHM ``w``, sigma = w / (2 sqrt(2 ln 2))):

    g(x) = 1 / (sigma sqrt(2 pi)) * exp(-(x - x0)^2 / (2 sigma^2))

Lorentzian (FWHM ``w``, half width gamma = w / 2):

    l(x) = (1 / pi) * gamma / ((x - x0)^2 + gamma^2)

References: J. B. Foresman & A. Frisch, *Exploring Chemistry with Electronic Structure Methods*,
2nd ed., Appendix; P. Atkins & R. Friedman, *Molecular Quantum Mechanics*, 5th ed., ch. 13
(line shapes). Avogadro 1 broadens with a Gaussian only
(``libavogadro/src/extensions/spectra/spectradialog.cpp``); the Lorentzian is the natural shape
for a lifetime-broadened vibrational band and is offered alongside it.
"""

from __future__ import annotations

import math

import numpy as np

from atomscope.model.spectrum import LineShape

# FWHM = 2 sqrt(2 ln 2) * sigma
FWHM_TO_SIGMA = 1.0 / (2.0 * math.sqrt(2.0 * math.log(2.0)))


def gaussian(x: np.ndarray, center: float, width: float) -> np.ndarray:
    """Unit-area Gaussian of full width at half maximum ``width``."""
    sigma = width * FWHM_TO_SIGMA
    z = (x - center) / sigma
    return np.exp(-0.5 * z * z) / (sigma * math.sqrt(2.0 * math.pi))


def lorentzian(x: np.ndarray, center: float, width: float) -> np.ndarray:
    """Unit-area Lorentzian of full width at half maximum ``width``."""
    gamma = 0.5 * width
    d = x - center
    return gamma / (math.pi * (d * d + gamma * gamma))


def broaden(
    x: np.ndarray,
    centers: np.ndarray,
    intensities: np.ndarray,
    width: float,
    shape: LineShape = "gaussian",
) -> np.ndarray:
    """Sum of unit-area line shapes scaled by ``intensities``, evaluated on ``x``."""
    if width <= 0:
        msg = "broadening width must be positive"
        raise ValueError(msg)
    if len(centers) != len(intensities):
        msg = f"{len(centers)} centers but {len(intensities)} intensities"
        raise ValueError(msg)
    kernel = gaussian if shape == "gaussian" else lorentzian
    out = np.zeros_like(x, dtype=float)
    for c, i in zip(centers, intensities, strict=True):
        if i == 0.0:
            continue
        out += float(i) * kernel(x, float(c), width)
    return out


def auto_grid(
    centers: np.ndarray, width: float, points: int = 1000, margin: float = 5.0
) -> np.ndarray:
    """A grid covering all peaks plus ``margin`` line widths on each side."""
    if len(centers) == 0:
        return np.linspace(0.0, 1.0, points)
    lo = float(np.min(centers)) - margin * width
    hi = float(np.max(centers)) + margin * width
    if hi <= lo:
        lo, hi = lo - width, hi + width
    return np.linspace(lo, hi, points)


def to_transmittance(absorbance: np.ndarray, scale: float = 1.0) -> np.ndarray:
    """Beer-Lambert transmittance ``T = 10^(-scale * A)``, in percent, clipped to [0, 100].

    Avogadro 1 instead maps the absorbance linearly onto 0..100 %
    (``spectradialog.cpp`` / ``ir.cpp``); the exponential form here is the physical one and
    reduces to the linear map for small absorbance. ``scale`` absorbs concentration and path
    length, which a computed spectrum does not know.
    """
    return np.clip(100.0 * np.power(10.0, -scale * absorbance), 0.0, 100.0)
