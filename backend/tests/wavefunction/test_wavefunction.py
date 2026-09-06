"""Gaussian-basis wavefunctions: readers and field generation.

The assertions are physics, not implementation details: molecular orbitals must be orthonormal,
the density must integrate to the electron count, and the fields must sit where the molecule is.
Fixtures come from the Avogadro 1 test corpus (see tests/fixtures/wavefunction/README.md).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from ase.units import Bohr

from atomscope.units import Unit
from atomscope.wavefunction import (
    EvaluationCancelledError,
    EvaluationHooks,
    bounding_box,
    density_values,
    electrostatic_potential_values,
    make_grid,
    orbital_values,
    read_fchk,
    read_molden,
    read_wavefunction,
    spin_density_values,
    vdw_values,
)
from atomscope.wavefunction.gto import basis_values, primitive_norm, shell_values
from atomscope.wavefunction.model import Wavefunction

FIX = Path(__file__).resolve().parents[1] / "fixtures" / "wavefunction"


def integrate(values: np.ndarray, box: object) -> float:
    voxel = abs(np.linalg.det(np.array(box.axes) / Bohr))  # type: ignore[attr-defined]
    return float(values.sum() * voxel)


def overlap_matrix(wf: Wavefunction, spacing: float = 0.22, padding: float = 6.0) -> np.ndarray:
    """Numeric MO overlap on a uniform grid (Bohr spacing), for orthonormality checks."""
    centres = wf.structure.positions() / Bohr
    lo, hi = centres.min(axis=0) - padding, centres.max(axis=0) + padding
    axes = [np.arange(lo[d], hi[d], spacing) for d in range(3)]
    points = np.array(np.meshgrid(*axes, indexing="ij")).reshape(3, -1).T
    chi = basis_values(wf.shells, centres, points)
    psi = np.array([mo.coefficients for mo in wf.orbitals]) @ chi
    return (psi * spacing**3) @ psi.T


# ---- readers ---------------------------------------------------------------------------------


def test_read_fchk_co() -> None:
    wf = read_fchk(FIX / "co.fchk")
    assert wf.structure.formula() == "CO"
    assert wf.n_electrons == 14
    assert wf.n_basis == sum(s.size for s in wf.shells)
    occupied = [mo for mo in wf.orbitals if mo.occupation > 0]
    assert len(occupied) == 7 and all(mo.occupation == 2.0 for mo in occupied)
    assert wf.homo_index() == 6
    energies = [mo.energy for mo in wf.orbitals if mo.energy is not None]
    assert energies == sorted(energies)  # Gaussian writes them in ascending order


def test_read_fchk_benzene_gzipped_and_sp_shells() -> None:
    wf = read_wavefunction(FIX / "benzene.fchk.gz")
    assert wf.structure.formula() == "C6H6"
    assert wf.n_basis == 66  # 3-21G
    # SP ("L") shells are split into an s and a p shell sharing exponents
    s_shells = [s for s in wf.shells if s.angular_momentum == 0]
    p_shells = [s for s in wf.shells if s.angular_momentum == 1]
    assert len(p_shells) == 12  # two SP shells on each carbon
    assert any(
        s.exponents.shape == p.exponents.shape and np.allclose(s.exponents, p.exponents)
        for s in s_shells
        for p in p_shells
    )


def test_read_molden_cartesian_d() -> None:
    wf = read_molden(FIX / "benzene.molden.gz")
    assert wf.structure.formula() == "C6H6"
    assert wf.n_electrons == 42
    assert any(s.angular_momentum == 2 and not s.pure for s in wf.shells)  # 6D
    assert len(wf.orbitals) == wf.n_basis
    assert sum(1 for mo in wf.orbitals if mo.occupation > 0) == 21


def test_reader_dispatch_and_errors(tmp_path: Path) -> None:
    assert read_wavefunction(FIX / "co.fchk").n_basis > 0
    bad = tmp_path / "nonsense.molden"
    bad.write_text("not a wavefunction\n")
    with pytest.raises(ValueError, match="(?i)molden|section"):
        read_molden(bad)


# ---- basis evaluation ------------------------------------------------------------------------


def test_primitive_normalization_matches_analytic_value() -> None:
    # a normalized 1s Gaussian: N = (2a/pi)^(3/4)
    assert primitive_norm(1.3, (0, 0, 0)) == pytest.approx((2 * 1.3 / np.pi) ** 0.75)
    # a p function carries the extra (4a)^(1/2)
    assert primitive_norm(1.3, (1, 0, 0)) == pytest.approx(
        (2 * 1.3 / np.pi) ** 0.75 * (4 * 1.3) ** 0.5
    )


def test_pure_d_shell_is_orthonormal() -> None:
    """The 5D solid-harmonic transformation must give five orthonormal functions."""
    wf = read_fchk(FIX / "d-only.fchk")
    shell = next(s for s in wf.shells if s.angular_momentum == 2 and s.pure)
    centre = wf.structure.positions()[shell.atom_index] / Bohr
    grid = np.arange(-6.0, 6.0, 0.1)
    points = np.array(np.meshgrid(grid, grid, grid, indexing="ij")).reshape(3, -1).T + centre
    values = shell_values(shell, centre, points)
    overlap = (values * 0.1**3) @ values.T
    np.testing.assert_allclose(np.diag(overlap), np.ones(5), atol=2e-3)
    assert np.abs(overlap - np.diag(np.diag(overlap))).max() < 2e-3


@pytest.mark.parametrize(
    "fixture,electrons,spacing",
    [
        ("co.fchk", 14, 0.11),
        ("d-only.fchk", 10, 0.12),
        ("benzene.fchk.gz", 42, 0.12),
        ("benzene.molden.gz", 42, 0.12),
        ("d-only.gamess.gz", 10, 0.12),
        ("f-only.gamess.gz", 10, 0.12),
    ],
)
def test_orbitals_are_orthonormal_and_density_integrates(
    fixture: str, electrons: int, spacing: float
) -> None:
    """Orthonormal orbitals plus the right electron count validate the basis normalization, the
    shell ordering and the solid-harmonic transformation together.

    What remains is quadrature error: the nuclear cusp is sampled, so coarse grids overshoot
    (benzene gives 46 e at 0.16 A) and only converge from 0.12 A downwards (41.8 e at both 0.12
    and 0.09 A, the deficit being the density outside the padded box). The tolerance therefore
    reflects quadrature, not a normalization error, which would show up as a factor.
    """
    wf = read_wavefunction(FIX / fixture)
    overlap = overlap_matrix(wf)
    occupied = [i for i, mo in enumerate(wf.orbitals) if mo.occupation > 0]
    diag = np.diag(overlap)[occupied]
    assert np.abs(diag - 1.0).max() < 0.06, diag
    off = (
        overlap[np.ix_(occupied, occupied)] - np.diag(np.diag(overlap))[np.ix_(occupied, occupied)]
    )
    assert np.abs(off).max() < 0.05
    box = bounding_box(wf.structure, padding=4.0, spacing=spacing)
    assert integrate(density_values(wf, box), box) == pytest.approx(electrons, rel=0.04)


# ---- fields ----------------------------------------------------------------------------------


def test_orbital_field_is_normalized_and_signed() -> None:
    wf = read_fchk(FIX / "co.fchk")
    box = bounding_box(wf.structure, padding=6.0, spacing=0.2)
    psi = orbital_values(wf, wf.homo_index() or 0, box)
    assert psi.shape == box.shape
    assert integrate(psi**2, box) == pytest.approx(1.0, abs=0.05)
    assert psi.min() < 0 < psi.max()  # a valence orbital has both lobes


def test_density_is_positive_and_peaks_at_nuclei() -> None:
    wf = read_fchk(FIX / "co.fchk")
    box = bounding_box(wf.structure, padding=4.0, spacing=0.15)
    rho = density_values(wf, box)
    assert rho.min() >= -1e-10
    peak = np.unravel_index(int(np.argmax(rho)), rho.shape)
    origin = np.array(box.origin)
    step = np.array([box.axes[d][d] for d in range(3)])
    peak_position = origin + np.array(peak) * step
    distances = np.linalg.norm(wf.structure.positions() - peak_position, axis=1)
    assert distances.min() < 0.3  # the maximum sits on a nucleus


def test_spin_density_vanishes_for_a_closed_shell() -> None:
    wf = read_fchk(FIX / "co.fchk")
    box = bounding_box(wf.structure, padding=3.0, spacing=0.4)
    assert np.abs(spin_density_values(wf, box)).max() == 0.0


def test_electrostatic_potential_is_positive_near_a_nucleus() -> None:
    """Near the nuclei the potential is dominated by the nuclear term and must be positive;
    the on-grid self-interaction of a charged voxel is regularized analytically."""
    wf = read_fchk(FIX / "co.fchk")
    box = bounding_box(wf.structure, padding=2.5, spacing=0.35)
    esp = electrostatic_potential_values(wf, box)
    assert np.isfinite(esp).all()
    assert esp.max() > 0
    # the electron cloud must dominate somewhere, otherwise the electronic term is not being
    # subtracted at all (an all-positive field would pass the assertion above by itself)
    assert esp.min() < 0


def test_vdw_field_marks_the_molecular_volume() -> None:
    wf = read_fchk(FIX / "co.fchk")
    box = bounding_box(wf.structure, padding=4.0, spacing=0.25)
    field = vdw_values(wf.structure, box)
    # inside the vdW spheres the field is positive, far outside it is negative
    assert field.max() > 0 and field.min() < 0
    inside_fraction = float((field > 0).mean())
    assert 0.01 < inside_fraction < 0.6


def test_grid_metadata_round_trips() -> None:
    wf = read_fchk(FIX / "co.fchk")
    box = bounding_box(wf.structure, padding=3.0, spacing=0.3)
    grid = make_grid("homo", "orbital", box, Unit.DIMENSIONLESS, wf.structure)
    assert grid.shape == box.shape and grid.origin == box.origin
    assert grid.n_points == box.n_points
    assert grid.kind == "orbital"


def test_box_rejects_impossible_requests() -> None:
    wf = read_fchk(FIX / "co.fchk")
    with pytest.raises(ValueError, match="spacing"):
        bounding_box(wf.structure, spacing=0.0)
    with pytest.raises(ValueError, match="budget"):
        bounding_box(wf.structure, padding=5.0, spacing=0.002)


def test_electrostatic_potential_refuses_a_grid_it_cannot_afford() -> None:
    """The electronic term is a grid integral, so cost grows as the square of the point count."""
    wf = read_fchk(FIX / "co.fchk")
    box = bounding_box(wf.structure, padding=4.0, spacing=0.05)
    with pytest.raises(ValueError, match="budget"):
        electrostatic_potential_values(wf, box)


def test_a_field_built_from_two_others_reports_one_run_of_progress() -> None:
    """A spin density is two densities; the caller is watching one bar, which may only rise."""
    hooks = EvaluationHooks(on_progress=lambda _: None)
    first, second = hooks.part(0.0, 0.5), hooks.part(0.5, 0.5)
    seen: list[float] = []
    reporting = EvaluationHooks(on_progress=seen.append)
    reporting.part(0.0, 0.5).step(1, 2)
    reporting.part(0.5, 0.5).step(1, 2)
    assert seen == [0.25, 0.75]
    assert first.should_stop is second.should_stop  # stopping still stops both halves

    wf = read_fchk(FIX / "co.fchk")
    box = bounding_box(wf.structure, padding=2.0, spacing=0.5)
    walked: list[float] = []
    spin_density_values(wf, box, hooks=EvaluationHooks(on_progress=walked.append))
    assert walked == sorted(walked)  # one run, not two: the two densities share the bar
    assert walked[-1] == pytest.approx(1.0)
    assert any(p <= 0.5 for p in walked) and any(p > 0.5 for p in walked)


def test_every_field_can_be_stopped_while_it_walks_the_grid() -> None:
    """Cancel has to reach the arithmetic itself, whichever field the panel asked for."""
    wf = read_fchk(FIX / "co.fchk")
    box = bounding_box(wf.structure, padding=2.0, spacing=0.4)
    stop = EvaluationHooks(should_stop=lambda: True)
    for field in (
        lambda: orbital_values(wf, 0, box, stop),
        lambda: density_values(wf, box, hooks=stop),
        lambda: spin_density_values(wf, box, hooks=stop),
        lambda: electrostatic_potential_values(wf, box, hooks=stop),
        lambda: vdw_values(wf.structure, box, hooks=stop),
    ):
        with pytest.raises(EvaluationCancelledError):
            field()


def test_gamess_log_reads_geometry_basis_and_orbitals() -> None:
    """The parts of a GAMESS-US log, read as themselves rather than through the physics test."""
    wf = read_wavefunction(FIX / "d-only.gamess.gz")
    assert wf.metadata["format"] == "gamess"
    assert wf.structure.formula() == "CH4" and wf.n_electrons == 10
    assert wf.structure.provenance is not None
    assert wf.structure.provenance.software == "GAMESS-US"
    # coordinates are printed in Bohr; the C-H distance is 1.09 A
    positions = wf.structure.positions()
    assert float(np.linalg.norm(positions[1] - positions[0])) == pytest.approx(1.0897, abs=1e-3)
    # 21 all-d shells, printed over the 126 Cartesian functions even though ISPHER=1 restricted
    # the variation space (which is why only 105 orbitals come back, not 126)
    assert len(wf.shells) == 21 and {s.angular_momentum for s in wf.shells} == {2}
    assert all(not s.pure for s in wf.shells)
    assert wf.n_basis == 126 and len(wf.orbitals) == 105
    assert wf.homo_index() == 4  # ten electrons in five doubly occupied orbitals
    assert wf.orbitals[0].energy == pytest.approx(-2.3155) and wf.orbitals[0].label == "A"
    assert wf.orbitals[5].occupation == 0.0


def test_gamess_f_shells_are_reordered_into_the_evaluators_convention() -> None:
    """GAMESS writes f components in its own order, and the orbitals mean nothing without it.

    Without the permutation the orbitals are not normalized -- the physics test above would fail
    for `f-only.gamess.gz` -- so this checks the permutation itself, which says why.
    """
    from atomscope.wavefunction.gamess import _gamess_to_internal  # noqa: PLC0415

    assert _gamess_to_internal(0) == [0]
    assert _gamess_to_internal(1) == [0, 1, 2]
    assert _gamess_to_internal(2) == [0, 1, 2, 3, 4, 5]  # d agrees with Gaussian
    # f does not: internal XYY is GAMESS's YYX (index 5), internal XXY is its XXY (index 3), ...
    assert _gamess_to_internal(3) == [0, 1, 2, 5, 3, 4, 7, 8, 6, 9]
    wf = read_wavefunction(FIX / "f-only.gamess.gz")
    assert {s.angular_momentum for s in wf.shells} == {3}
    assert wf.n_basis == 210


def test_a_log_that_is_not_a_wavefunction_says_so(tmp_path: Path) -> None:
    from atomscope.wavefunction.gamess import read_gamess  # noqa: PLC0415

    empty = tmp_path / "empty.gamess"
    empty.write_text("GAMESS VERSION = 1 MAY 2013\nnothing else here\n")
    with pytest.raises(ValueError, match="no atom coordinates"):
        read_gamess(empty)


def test_an_orca_molden_file_is_read_in_its_own_coefficient_convention() -> None:
    """`orca_2mkl` writes the contraction coefficients for *unnormalized* primitives.

    Molden's specification says normalized, and every other file here follows it. Read as the
    specification says, ORCA's shells come out the wrong shape -- each is still normalized
    afterwards, so nothing looks wrong until the orbitals are integrated and come back at about
    0.82 instead of 1. The reader measures which convention a file uses (every spec-conforming
    shell has a self-overlap of exactly 1.000; this file's run from 0.11 to 7.35) and divides the
    primitive normalization back out, which is what this test is checking.
    """
    wf = read_wavefunction(FIX / "caffeine_orca.molden.gz")
    assert wf.metadata["coefficient_convention"] == "unnormalized primitives"
    assert wf.structure.formula() == "C8H10N4O2"
    assert wf.n_basis == 246 and wf.n_electrons == 102 and wf.homo_index() == 50
    box = bounding_box(wf.structure, padding=4.0, spacing=0.2)
    for index in (30, 45, 50):
        values = orbital_values(wf, index, box)
        assert integrate(values**2, box) == pytest.approx(1.0, abs=0.02), index


def test_a_molden_file_that_follows_the_specification_is_left_alone() -> None:
    """The convention is measured per file, so the fix must not touch a conforming one."""
    from atomscope.wavefunction.gto import contraction_norm  # noqa: PLC0415

    wf = read_wavefunction(FIX / "benzene.molden.gz")
    assert wf.metadata["coefficient_convention"] == "normalized primitives"
    factors = [contraction_norm(shell) for shell in wf.shells]
    assert max(abs(f - 1.0) for f in factors) < 1e-9


def _molden(gto: str, n_basis: int) -> str:
    """A one-atom Molden file with `gto` as its ``[GTO]`` body and one occupied orbital."""
    coefficients = "\n".join(f"   {i + 1}  {1.0 if i == 0 else 0.0}" for i in range(n_basis))
    return (
        "[Molden Format]\n[Atoms] AU\nH     1    1    0.0 0.0 0.0\n"
        f"[GTO]\n  1 0\n{gto}\n\n"
        f"[MO]\n Sym= 1a\n Ene= -0.5\n Spin= Alpha\n Occup= 2.0\n{coefficients}\n"
    )


def test_a_conforming_file_with_unnormalized_contractions_is_left_alone(tmp_path: Path) -> None:
    """The self-overlap test alone has a false positive; the second test catches it.

    Coefficients taken straight out of a basis-set library are for normalized primitives but do
    not normalize the contraction, and Molden itself renormalizes them on read. Such a file has
    shell self-overlaps well away from 1 -- 1.70 for this cc-pVDZ hydrogen -- and would be
    "corrected" by that test alone, mangling the shapes the same way ORCA's files are mangled
    without the fix. Its uncontracted shell still says 1, so the two tests disagree and the
    reader leaves the coefficients exactly as written.
    """
    path = tmp_path / "library.molden"
    path.write_text(
        _molden(
            " s   3 1.00\n   13.0100000  0.0196850\n    1.9620000  0.1379770\n"
            "    0.4446000  0.4781480\n s   1 1.00\n    0.1220000  1.0000000",
            2,
        )
    )
    wf = read_molden(path)
    convention = wf.metadata["coefficient_convention"]
    assert convention == "normalized primitives, unnormalized contractions"
    assert wf.shells[0].coefficients[0] == pytest.approx(0.019685)
    assert wf.shells[1].coefficients[0] == pytest.approx(1.0)


def test_a_file_with_no_uncontracted_s_or_p_shell_falls_back_to_the_self_overlaps(
    tmp_path: Path,
) -> None:
    """Nothing to ask the second test, so the first decides on its own and the note says so."""
    from atomscope.wavefunction.gto import contraction_norm  # noqa: PLC0415
    from atomscope.wavefunction.model import Shell  # noqa: PLC0415

    exponents = np.array([1.2, 0.3])
    conforming = np.array([0.4, 0.7])
    conforming = conforming / contraction_norm(Shell(0, 2, False, exponents, conforming))
    written = conforming * np.array([primitive_norm(float(e), (2, 0, 0)) for e in exponents])

    path = tmp_path / "d-only.molden"
    primitives = "\n".join(f"   {e}  {c}" for e, c in zip(exponents, written, strict=True))
    path.write_text(_molden(f" d   2 1.00\n{primitives}", 6))
    wf = read_molden(path)
    assert wf.metadata["coefficient_convention"] == "unnormalized primitives (self-overlaps only)"
    assert wf.shells[0].coefficients == pytest.approx(conforming)


def test_an_orca_output_holds_the_same_wavefunction_as_the_molden_file_beside_it() -> None:
    """Two readers, two file formats, one calculation: they have to agree function by function.

    `caffeine_orca.out.gz` and `caffeine_orca.molden.gz` are the same ORCA job -- the output and
    what `orca_2mkl` wrote from its gbw -- so the readers can be checked against each other
    rather than against a norm. They lay the basis out differently (ORCA prints pz, px, py and
    labels every row; Molden writes px, py, pz and labels nothing), which is exactly what makes
    the comparison worth making: agreeing to the printed precision means both permutations are
    right, not that one mistake was made twice.
    """
    out = read_wavefunction(FIX / "caffeine_orca.out.gz")
    molden = read_wavefunction(FIX / "caffeine_orca.molden.gz")
    assert out.metadata["format"] == "orca"
    assert out.structure.formula() == molden.structure.formula() == "C8H10N4O2"
    assert out.n_basis == molden.n_basis == 246
    assert out.n_electrons == molden.n_electrons == 102
    assert out.homo_index() == molden.homo_index() == 50
    assert out.charge == 0.0 and out.multiplicity == 1

    positions = np.array([a.position for a in out.structure.atoms])
    assert positions == pytest.approx(
        np.array([a.position for a in molden.structure.atoms]), abs=1e-8
    )
    assert len(out.shells) == 114
    for a, b in zip(out.shells, molden.shells, strict=True):
        assert (a.atom_index, a.angular_momentum) == (b.atom_index, b.angular_momentum)
        assert a.exponents == pytest.approx(b.exponents)
        # both files are now read in the normalized-primitive convention, so s and p agree to
        # the printed digits -- but ORCA folds a further sqrt(3) into the d coefficients it
        # writes to a Molden file (its xy component comes out normalized, the others do not),
        # and that is a per-shell factor `contraction_norm` divides out again at evaluation.
        # Hence the same orbitals from coefficients that differ by exactly that much.
        scale = np.sqrt(3.0) if a.angular_momentum == 2 else 1.0
        assert a.coefficients * scale == pytest.approx(b.coefficients, abs=1e-9)
    # the coefficients are printed to six decimals, so half of the last digit is the agreement
    for i, (a, b) in enumerate(zip(out.orbitals, molden.orbitals, strict=True)):
        assert a.coefficients == pytest.approx(b.coefficients, abs=5e-7), i
        assert a.energy == pytest.approx(b.energy, abs=5e-6), i


def test_an_orca_output_gives_normalized_orbitals() -> None:
    """The independent check: whatever the two readers agree on still has to be physics."""
    wf = read_wavefunction(FIX / "caffeine_orca.out.gz")
    box = bounding_box(wf.structure, padding=4.0, spacing=0.2)
    for index in (45, 50):
        assert integrate(orbital_values(wf, index, box) ** 2, box) == pytest.approx(1.0, abs=0.02)


def test_the_converged_step_is_the_one_read_from_an_orca_optimization() -> None:
    """An optimization prints geometry, basis and orbitals once a step; the last is the answer."""
    wf = read_wavefunction(FIX / "caffeine_orca.out.gz")
    # the first step's first atom sits at x = -1.514559 Bohr, the converged one at -1.267887
    assert wf.structure.atoms[0].position[0] == pytest.approx(-1.267886929935834 * Bohr)
    # and its first orbital came out at -18.75360 Eh on that step, -18.75958 at the end
    assert wf.orbitals[0].energy == pytest.approx(-18.75958)


def test_an_unrestricted_orca_output_is_refused_rather_than_half_read(tmp_path: Path) -> None:
    """Reading only the alpha orbitals would quietly halve the density; there is no fixture."""
    from atomscope.wavefunction.orca import read_orca  # noqa: PLC0415

    path = tmp_path / "uhf.out"
    path.write_text("* O   R   C   A *\n SPIN UP ORBITALS\nMOLECULAR ORBITALS\n")
    with pytest.raises(ValueError, match="unrestricted"):
        read_orca(path)


def test_a_cartesian_orca_output_is_refused_rather_than_read_as_solid_harmonics(
    tmp_path: Path,
) -> None:
    """The row labels say which components a shell has, and an unknown set stops the read.

    ORCA prints solid harmonics by default and every component label here is one of those. A run
    in a Cartesian basis prints six d functions under labels this reader has never seen, and
    taking them for the five it knows would put the coefficients on the wrong functions.
    """
    from atomscope.wavefunction.orca import read_orca  # noqa: PLC0415

    rows = "\n".join(
        f"  0He  1{label}       {1.0 if label == 's' else 0.0:.6f}"
        for label in ("s", "dxx", "dyy", "dzz", "dxy", "dxz", "dyz")
    )
    path = tmp_path / "cartesian.out"
    path.write_text(
        "* O   R   C   A *\n\n"
        "CARTESIAN COORDINATES (A.U.)\n----\n  NO LB      ZA    FRAG    MASS        X   Y   Z\n"
        "   0 He    2.0000    0     4.003     0.000000     0.000000     0.000000\n\n"
        "BASIS SET IN INPUT FORMAT\n\n NewGTO He \n S 1 \n   1   1.0000   1.0000\n"
        " D 1 \n   1   1.0000   1.0000\n  end;\n\n"
        f"MOLECULAR ORBITALS\n------\n     0\n  -1.00000\n   2.00000\n  --------\n{rows}\n"
    )
    with pytest.raises(ValueError, match="not the .* this reader knows"):
        read_orca(path)
