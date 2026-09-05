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
