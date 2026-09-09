"""Fitted curves through a sweep: a cubic, and Murnaghan's equation of state.

The course reads two things off the same set of points (ch. 6.3.6/6.3.7, Figs 6.6 and 6.7). A
cubic through energy against scaled lattice constant gives the optimum lattice constant, which
the tutorial fits in `xmgrace`. Murnaghan's equation of state through energy against *volume*
gives the equilibrium volume, the bulk modulus and its pressure derivative, which the tutorial
fits with `paw_murnaghan.x`.

**It is Murnaghan, not Birch-Murnaghan.** `paw_murnaghan.f90` and the course both cite
F. D. Murnaghan, PNAS 30, 244 (1944), whose assumption is that the bulk modulus depends linearly
on pressure. The two equations of state are different functions and give different bulk moduli
for the same points -- for the course's own silicon data, 93 GPa against 95 GPa.

`ase.eos.murnaghan` is the same function as the one `paw_murnaghan.f90` prints:

    CP-PAW  E = E0 + B0 V0/(B'(B'-1)) ((V/V0)^(1-B') - 1) + B0 V0/B' ((V/V0) - 1)
    ASE     E = E0 + B0 V/B' ((V0/V)^B'/(B'-1) + 1) - V0 B0/(B'-1)

Expand ASE's in V/V0 and the two constant terms collapse to -B0 V0/(B'-1), which is what CP-PAW's
-B0 V0/(B'(B'-1)) - B0 V0/B' sums to; the V-dependent terms are already identical. Evaluated at
the parameters the course prints, `ase.eos.murnaghan` reproduces the course's printed residuals to
1e-5 H, and `ase.eos.birchmurnaghan` does not (4.5e-4 H) -- which is the test that tells the two
apart. So ASE's fit is used rather than a second implementation of the same algebra.

One difference worth knowing: `paw_murnaghan.f90` minimizes its penalty with quenched dynamics and
stops on a gradient tolerance, which leaves it slightly short of the least-squares minimum. On the
course's own data scipy reaches a mean square residual of 7.55e-8 H^2 where the tool's printed
parameters give 7.93e-8. The equilibrium volume and energy agree to the digits the course prints;
B' is the soft direction of a four-parameter fit and differs by about 4%. Our numbers are the
better fit to the same points, not a different model.
"""

from __future__ import annotations

from typing import Literal

import numpy as np
from ase import units
from ase.eos import EquationOfState
from pydantic import Field

from atomscope.model.common import StrictModel

#: Both fits have four parameters, so four points is the least that determines one.
#: `paw_murnaghan.f90` refuses fewer ("TOO FEW INPUT DATA, AT LEAST 4 ARE REQUIRED!").
MIN_POINTS = 4

#: How far past the data the drawn curve reaches, as a fraction of the sampled range at each end.
#: `MURN.DAT` is written over the same extension.
MARGIN = 0.1

#: Points on the drawn curve. Enough that a cusped curve looks smooth at any chart width.
SAMPLES = 201

FitKind = Literal["cubic", "murnaghan"]


class EosError(ValueError):
    """The points cannot carry the requested fit."""


class FitCurve(StrictModel):
    """The fitted function, sampled for drawing."""

    x: list[float]
    y: list[float] = Field(description="eV")


class MurnaghanParameters(StrictModel):
    """What the equation of state is for. Everything is per the cell that was swept."""

    e0_ev: float = Field(description="energy at the equilibrium volume")
    v0_a3: float = Field(description="equilibrium volume, Å³")
    b0_gpa: float = Field(description="bulk modulus at the equilibrium volume")
    bp: float = Field(description="pressure derivative of the bulk modulus, dimensionless")
    lattice_constant_a: float | None = Field(
        default=None,
        description="(v0 / volume_per_a3)^(1/3), only when the caller said how the cell's volume"
        " relates to its lattice constant",
    )
    extrapolated: bool = Field(
        description="the equilibrium volume lies outside the volumes that were computed, so it is"
        " an extrapolation and the sweep should be widened"
    )


class CubicParameters(StrictModel):
    """A cubic in the sweep's own x, and the minimum it puts there."""

    coefficients: list[float] = Field(description="highest power first, as `numpy.polyfit` returns")
    x_min: float | None = Field(
        default=None, description="where the cubic has its minimum, when it has one"
    )
    y_min: float | None = Field(default=None, description="eV at `x_min`")
    extrapolated: bool = Field(
        description="the sweep did not bracket a minimum: `x_min` is either outside the x that"
        " were computed, or absent because the cubic has none"
    )


class SweepFit(StrictModel):
    """A fitted curve through sweep points, with the parameters that make it worth fitting."""

    kind: FitKind
    curve: FitCurve
    residuals_ev: list[float] = Field(description="fitted minus computed, one per input point")
    rms_ev: float = Field(description="root mean square of the residuals")
    murnaghan: MurnaghanParameters | None = None
    cubic: CubicParameters | None = None


def _checked(x: list[float], y: list[float]) -> tuple[np.ndarray, np.ndarray]:
    if len(x) != len(y):
        msg = f"{len(x)} x against {len(y)} energies"
        raise EosError(msg)
    if len(x) < MIN_POINTS:
        msg = f"a fit needs at least {MIN_POINTS} points, got {len(x)}"
        raise EosError(msg)
    xs, ys = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    if not (np.all(np.isfinite(xs)) and np.all(np.isfinite(ys))):
        msg = "the points carry a value that is not finite"
        raise EosError(msg)
    if len(np.unique(xs)) < MIN_POINTS:
        msg = f"the points repeat: {len(np.unique(xs))} distinct x among {len(xs)}"
        raise EosError(msg)
    return xs, ys


def _span(xs: np.ndarray) -> np.ndarray:
    lo, hi = float(xs.min()), float(xs.max())
    margin = MARGIN * (hi - lo)
    return np.linspace(lo - margin, hi + margin, SAMPLES)


def fit_cubic(x: list[float], y: list[float]) -> SweepFit:
    """A cubic polynomial through the points, and its minimum -- Fig. 6.6.

    The minimum is where the derivative vanishes with positive curvature. A cubic has at most one
    such point, and it can fall outside the sampled range, which is reported rather than clamped:
    a minimum off the end of the sweep means the sweep did not bracket it.
    """
    xs, ys = _checked(x, y)
    coefficients = np.polyfit(xs, ys, 3)
    poly = np.poly1d(coefficients)
    slope = poly.deriv()
    x_min: float | None = None
    for root in np.roots(slope):
        if abs(root.imag) < 1e-12 and slope.deriv()(root.real) > 0:
            x_min = float(root.real)
    curve = _span(xs)
    residuals = poly(xs) - ys
    return SweepFit(
        kind="cubic",
        curve=FitCurve(x=[float(v) for v in curve], y=[float(v) for v in poly(curve)]),
        residuals_ev=[float(v) for v in residuals],
        rms_ev=float(np.sqrt(np.mean(residuals**2))),
        cubic=CubicParameters(
            coefficients=[float(c) for c in coefficients],
            x_min=x_min,
            y_min=None if x_min is None else float(poly(x_min)),
            extrapolated=x_min is None or not (xs.min() <= x_min <= xs.max()),
        ),
    )


def fit_murnaghan(
    volumes_a3: list[float], energies_ev: list[float], *, volume_per_a3: float | None = None
) -> SweepFit:
    """Murnaghan's equation of state through energy against volume -- Fig. 6.7.

    ``volume_per_a3`` is the cell's volume divided by the cube of its lattice constant, which is
    `paw_murnaghan.x`'s ``-vbl``: 1 for a conventional cubic cell, 0.25 for the two-atom primitive
    cell of a face-centred lattice, which is what the course's silicon exercise uses. Without it
    no lattice constant is reported, because the relation between the two is a property of the
    lattice and not something to guess from a volume.
    """
    volumes, energies = _checked(volumes_a3, energies_ev)
    if np.any(volumes <= 0):
        msg = "a volume must be positive"
        raise EosError(msg)
    eos = EquationOfState(list(volumes), list(energies), eos="murnaghan")
    try:
        # `warn=False`: ASE prints to stderr when the minimum is an extrapolation. That is worth
        # saying, but it belongs in the result where the caller can show it, not in the log.
        v0, e0, b0 = eos.fit(warn=False)
    except Exception as exc:  # noqa: BLE001 -- scipy raises several kinds when it cannot converge
        msg = f"the equation of state would not fit these points: {exc}"
        raise EosError(msg) from exc
    bp = float(eos.eos_parameters[2])
    curve = _span(volumes)
    fitted = eos.func(curve, *eos.eos_parameters)
    residuals = eos.func(volumes, *eos.eos_parameters) - energies
    return SweepFit(
        kind="murnaghan",
        curve=FitCurve(x=[float(v) for v in curve], y=[float(v) for v in fitted]),
        residuals_ev=[float(v) for v in residuals],
        rms_ev=float(np.sqrt(np.mean(residuals**2))),
        murnaghan=MurnaghanParameters(
            e0_ev=float(e0),
            v0_a3=float(v0),
            # ASE's own idiom for eV/Å³ -> GPa
            b0_gpa=float(b0 / units.kJ * 1.0e24),
            bp=bp,
            lattice_constant_a=(
                None if volume_per_a3 is None else float((v0 / volume_per_a3) ** (1.0 / 3.0))
            ),
            extrapolated=not (volumes.min() <= v0 <= volumes.max()),
        ),
    )
