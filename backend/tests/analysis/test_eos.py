"""The fitted curves, against the worked example the course prints for them.

Chapter 6.3.7 runs `paw_scanlat -p si -l "94 96 98 100 102 104 106"` on silicon and pipes the
resulting `murn.in` into `paw_murnaghan.x -vbl 0.25`. The tutorial prints its input, its fit
parameters and its per-point residuals, which together pin down both the functional form and the
answer -- so the fit can be checked against the real tool without running it.

Source: Blöchl, *CP-PAW Hands-On Course on First-Principles Calculations*, ch. 6.3.7.
"""

from __future__ import annotations

import numpy as np
import pytest
from ase import units
from ase.eos import birchmurnaghan, murnaghan

from atomscope.analysis.eos import MIN_POINTS, EosError, fit_cubic, fit_murnaghan

#: The course's `murn.in` for silicon: volume of the two-atom primitive cell in bohr³, and the
#: total energy of that cell in Hartree.
COURSE_VOLUMES_BOHR3 = [224.47093, 239.10587, 254.36348, 270.25674, 286.79862, 304.00208, 321.88010]
COURSE_ENERGIES_H = [-8.01232, -8.02363, -8.03018, -8.03279, -8.03079, -8.02752, -8.02210]

#: What `paw_murnaghan.x -vbl 0.25` prints for those points: E0/H, V0/bohr³, B0/a.u., B'.
COURSE_PARAMETERS = (-8.03221, 272.10726, 0.00312, 5.32371)

#: Its "COMPARE ORIGINAL AND INTERPOLATED DATA" column, E(FIT)-E(IN) in Hartree.
COURSE_RESIDUALS_H = [0.00008, -0.00029, 0.00006, 0.00059, -0.00031, -0.00004, 0.00002]

#: Volume of that cell over the cube of the lattice constant -- the course's `-vbl 0.25`.
FCC_PRIMITIVE = 0.25

VOLUMES_A3 = [v * units.Bohr**3 for v in COURSE_VOLUMES_BOHR3]
ENERGIES_EV = [e * units.Hartree for e in COURSE_ENERGIES_H]


def test_ase_murnaghan_is_the_function_cp_paw_prints() -> None:
    """The model, checked apart from the optimizer.

    Evaluated at the parameters `paw_murnaghan.x` printed, ASE's `murnaghan` has to reproduce the
    residuals it printed. This is what distinguishes Murnaghan from Birch-Murnaghan, which the
    early notes for this feature had confused: the same parameters through the Birch-Murnaghan
    form are wrong by 45 times as much, so the assertion cannot pass for the wrong equation.
    """
    e0, v0, b0, bp = COURSE_PARAMETERS
    volumes = np.array(COURSE_VOLUMES_BOHR3)
    energies = np.array(COURSE_ENERGIES_H)

    ours = murnaghan(volumes, e0, b0, bp, v0) - energies
    # 1e-5 H is the rounding of the five decimals the parameters are printed to
    assert np.abs(ours - np.array(COURSE_RESIDUALS_H)).max() < 1.0e-5

    theirs = birchmurnaghan(volumes, e0, b0, bp, v0) - energies
    assert np.abs(theirs - np.array(COURSE_RESIDUALS_H)).max() > 1.0e-4


def test_murnaghan_finds_the_equilibrium_the_course_reports() -> None:
    fit = fit_murnaghan(VOLUMES_A3, ENERGIES_EV, volume_per_a3=FCC_PRIMITIVE)
    assert fit.kind == "murnaghan"
    p = fit.murnaghan
    assert p is not None

    e0_h, v0_bohr3 = p.e0_ev / units.Hartree, p.v0_a3 / units.Bohr**3
    # the equilibrium is the answer the exercise wants, and it agrees to the printed precision
    assert e0_h == pytest.approx(-8.03221, abs=1.0e-3)
    assert v0_bohr3 == pytest.approx(272.10726, rel=1.0e-3)
    assert p.lattice_constant_a is not None
    # 5.44337 Å, against silicon's measured 5.431 -- the exercise's point is that PBE overshoots
    assert p.lattice_constant_a == pytest.approx(5.44337, abs=5.0e-3)
    # the bulk modulus is what the chapter is really after, and is quoted in GPa
    assert p.b0_gpa == pytest.approx(91.84, rel=0.02)
    assert p.bp == pytest.approx(5.32371, rel=0.05)
    # seven real points bracket their own minimum, so this is not an extrapolation
    assert p.extrapolated is False


def test_our_fit_is_at_least_as_good_as_the_tool_s() -> None:
    """`paw_murnaghan.f90` minimizes with quenched dynamics and stops on a gradient tolerance,
    which leaves it short of the least-squares minimum. Our residuals must not be worse than the
    ones it printed -- that, rather than agreement to five decimals, is the honest claim."""
    fit = fit_murnaghan(VOLUMES_A3, ENERGIES_EV)
    ours_h = np.array(fit.residuals_ev) / units.Hartree
    theirs_h = np.array(COURSE_RESIDUALS_H)
    assert np.sqrt(np.mean(ours_h**2)) <= np.sqrt(np.mean(theirs_h**2))
    assert fit.rms_ev == pytest.approx(np.sqrt(np.mean(np.array(fit.residuals_ev) ** 2)))


def test_the_drawn_curve_passes_through_the_points_and_reaches_past_them() -> None:
    fit = fit_murnaghan(VOLUMES_A3, ENERGIES_EV)
    assert len(fit.curve.x) == len(fit.curve.y)
    lo, hi = min(VOLUMES_A3), max(VOLUMES_A3)
    span = hi - lo
    # a tenth of the range past each end, as MURN.DAT is written
    assert fit.curve.x[0] == pytest.approx(lo - 0.1 * span)
    assert fit.curve.x[-1] == pytest.approx(hi + 0.1 * span)
    assert fit.curve.x == sorted(fit.curve.x)
    # and it really is the fitted curve: interpolating it at a computed volume gives that point
    for v, e in zip(VOLUMES_A3, ENERGIES_EV, strict=True):
        assert float(np.interp(v, fit.curve.x, fit.curve.y)) == pytest.approx(e, abs=0.02)


def test_a_lattice_constant_is_reported_only_when_the_lattice_is_named() -> None:
    fit = fit_murnaghan(VOLUMES_A3, ENERGIES_EV)
    assert fit.murnaghan is not None
    # without -vbl there is no way from a volume to a lattice constant, so none is invented
    assert fit.murnaghan.lattice_constant_a is None

    cubic_cell = fit_murnaghan(VOLUMES_A3, ENERGIES_EV, volume_per_a3=1.0)
    assert cubic_cell.murnaghan is not None
    assert cubic_cell.murnaghan.lattice_constant_a == pytest.approx(
        fit.murnaghan.v0_a3 ** (1.0 / 3.0)
    )


def test_an_equilibrium_off_the_end_of_the_sweep_says_so() -> None:
    """The failure the chapter teaches students to spot: a sweep that never reached the minimum.
    Four points off the repulsive wall still fit, and the minimum they imply is an extrapolation."""
    fit = fit_murnaghan(VOLUMES_A3[:4], ENERGIES_EV[:4])
    assert fit.murnaghan is not None
    assert fit.murnaghan.extrapolated is True


def test_cubic_finds_the_optimum_lattice_scaling() -> None:
    """Fig. 6.6: the same silicon points against percentage of the initial lattice constant, which
    is what `paw_scanlat -l "94 96 ..."` sweeps. The cubic's minimum has to agree with the lattice
    constant the equation of state gives from the volumes -- two fits of different functions in
    different variables, so agreeing is a real check."""
    percent = [94.0, 96.0, 98.0, 100.0, 102.0, 104.0, 106.0]
    fit = fit_cubic(percent, ENERGIES_EV)
    assert fit.kind == "cubic"
    p = fit.cubic
    assert p is not None
    assert len(p.coefficients) == 4
    assert p.x_min is not None
    assert p.extrapolated is False

    murn = fit_murnaghan(VOLUMES_A3, ENERGIES_EV, volume_per_a3=FCC_PRIMITIVE)
    assert murn.murnaghan is not None
    a0 = murn.murnaghan.lattice_constant_a
    assert a0 is not None

    # The 100% point is the lattice constant the run started from, and for this exercise it is
    # silicon's measured 5.431 Å -- which is the check that the volumes and `-vbl 0.25` describe
    # the same cell.
    a_start = (VOLUMES_A3[3] / FCC_PRIMITIVE) ** (1.0 / 3.0)
    assert a_start == pytest.approx(5.431, abs=1.0e-3)

    # so the cubic's minimum, in percent of that, has to be the same length the equation of state
    # puts its minimum at -- two different functions of two different variables, agreeing to 0.05%
    assert a_start * p.x_min / 100.0 == pytest.approx(a0, rel=1.0e-3)
    assert 100.0 < p.x_min < 104.0  # PBE overshoots, so the minimum is above the measured value

    # A least-squares cubic need not pass below its lowest sample, and here it does not: the
    # fitted minimum sits 11 meV above the computed point at 100%.
    assert p.y_min is not None
    assert p.y_min == pytest.approx(min(ENERGIES_EV), abs=0.02)


def test_a_cubic_without_a_minimum_reports_none() -> None:
    """A monotone sweep -- a plane-wave cutoff, which only ever falls -- has no minimum to fit."""
    fit = fit_cubic([10.0, 20.0, 30.0, 40.0, 50.0], [-1.0, -2.0, -2.5, -2.7, -2.75])
    assert fit.cubic is not None
    assert fit.cubic.extrapolated is True


@pytest.mark.parametrize(
    ("x", "y", "message"),
    [
        ([1.0, 2.0, 3.0], [1.0, 2.0, 3.0], "at least 4 points"),
        ([1.0, 2.0, 3.0, 4.0], [1.0, 2.0, 3.0], "against"),
        ([1.0, 1.0, 2.0, 3.0], [1.0, 2.0, 3.0, 4.0], "repeat"),
        ([1.0, 2.0, 3.0, float("nan")], [1.0, 2.0, 3.0, 4.0], "not finite"),
    ],
)
def test_points_that_cannot_carry_a_fit_are_refused(
    x: list[float], y: list[float], message: str
) -> None:
    with pytest.raises(EosError, match=message):
        fit_cubic(x, y)
    with pytest.raises(EosError, match=message):
        fit_murnaghan(x, y)


def test_a_volume_must_be_positive() -> None:
    with pytest.raises(EosError, match="positive"):
        fit_murnaghan([-1.0, 1.0, 2.0, 3.0], [1.0, 2.0, 3.0, 4.0])


def test_min_points_matches_the_tool() -> None:
    # paw_murnaghan.f90: "TOO FEW INPUT DATA, AT LEAST 4 ARE REQUIRED!"
    assert MIN_POINTS == 4
