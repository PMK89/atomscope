"""Harmonic normal modes from finite differences of forces.

The Hessian is built directly rather than through :class:`ase.vibrations.Vibrations`, because
that class caches every displacement in a directory on disk and does not separate the
translational/rotational modes -- both of which we need to avoid here (the API computes modes for
a posted structure, with no calculation directory) and to report (a Vibrations dock shows the
six trivial modes as a convergence diagnostic, the way Gaussian prints "Low frequencies").

Method
------
Central differences of the forces ``F_i = -dE/dx_i`` give the Cartesian Hessian

    H[i][j] = -(F_j(x_i + d) - F_j(x_i - d)) / (2 d)

which is symmetrised, ``H <- (H + H^T) / 2``, and mass-weighted

    D[i][j] = H[i][j] / sqrt(m_i m_j)

(the Cartesian form of the Wilson GF method: E. B. Wilson, J. C. Decius & P. C. Cross,
*Molecular Vibrations*, McGraw-Hill 1955, ch. 2; J. W. Ochterski, *Vibrational Analysis in
Gaussian*, Gaussian Inc. 1999). Diagonalising ``D`` gives eigenvalues ``omega^2`` in
eV/(A^2 amu) and mass-weighted eigenvectors ``v``. Frequencies use ASE's constant, so Atomscope
and ``ase.vibrations`` agree exactly:

    hbar*omega [eV] = hbar * 1e10 / sqrt(e * amu) * sqrt(omega^2)
    nu [cm^-1]      = hbar*omega / ase.units.invcm

Six eigenvectors (five for a linear molecule) span the translations and rotations of the whole
molecule. They are identified by their overlap with the analytic translation/rotation basis in
mass-weighted coordinates rather than by a frequency threshold, so a soft real mode below a
badly converged trivial mode is not mistaken for one.

Per-mode numbers follow the Gaussian conventions:

    reduced mass    mu   = 1 / sum_j (v_j^2 / m_j)                        [amu]
    force constant  k    = 4 pi^2 c^2 nu^2 mu                            [mDyne/A]
    zero-point energy    = 1/2 sum_k h nu_k over the real vibrations      [eV]

IR intensities
--------------
The intensity of mode ``k`` is proportional to the square of the dipole derivative along the
normal coordinate (D. Porezag & M. R. Pederson, *Phys. Rev. B* **54** (1996) 7830; Ochterski
sec. "IR intensities"):

    dmu/dQ_k = sum_i (dmu/dx_i) v_ik / sqrt(m_i)
    A_k [km/mol] = 42.255 * |dmu/dQ_k|^2 [(D/A)^2 / amu]

``dmu/dx`` comes from the same displaced geometries as the Hessian. Any ASE calculator that
implements ``dipole`` supplies it. For the Open Babel force fields, which have no electronic
structure, the dipole is the point-charge sum ``sum_i q_i r_i`` over Open Babel partial charges
(:func:`atomscope.chem.properties.partial_charges`). **This is an approximation**: topological
charge models such as Gasteiger do not respond to geometry, so the charge-flux term
``sum_i r_i dq_i/dx`` is zero and only the ``sum_i q_i dr_i/dx`` term survives. The resulting
intensities are qualitative -- useful to tell a strong band from a silent one, not to compare
with an experimental absorbance. They are labelled as such in the returned ``method`` string.
"""

from __future__ import annotations

import math
from typing import Any, Literal, Protocol

import numpy as np
from ase import Atoms, units

from atomscope.model import Provenance, Structure, VibrationalMode, VibrationalSpectrum, new_uid
from atomscope.model.common import Vec3

# hbar * omega in eV from an eigenvalue of the mass-weighted Hessian in eV/(A^2 amu).
EV_PER_SQRT_EIGENVALUE = units._hbar * 1e10 / math.sqrt(units._e * units._amu)
# (D/A)^2/amu -> km/mol, Porezag & Pederson, Phys. Rev. B 54 (1996) 7830.
KM_PER_MOL_PER_DA2_AMU = 42.255
# 1 e*A expressed in Debye, for the point-charge dipole derivative.
DEBYE_PER_E_ANGSTROM = 1.0 / units.Debye
# speed of light in cm/s, for the force constants.
C_CM_PER_S = units._c * 100.0

DipoleSource = Literal["calculator", "partial_charges", "none"]


class VibrationError(ValueError):
    """Raised when normal modes cannot be computed for the given input."""


class ForceEngine(Protocol):
    """Forces (eV/A) and an optional dipole (e*A) at a given geometry."""

    def evaluate(self, positions: np.ndarray) -> tuple[np.ndarray, np.ndarray | None]: ...


class AseForceEngine:
    """Wraps an ASE calculator; the dipole is taken from the calculator when it has one."""

    def __init__(self, atoms: Atoms, *, use_dipole: bool = True) -> None:
        self.atoms = atoms
        self.use_dipole = use_dipole

    def evaluate(self, positions: np.ndarray) -> tuple[np.ndarray, np.ndarray | None]:
        self.atoms.set_positions(positions)
        forces = np.asarray(self.atoms.get_forces(), dtype=float)
        dipole: np.ndarray | None = None
        if self.use_dipole:
            try:
                dipole = np.asarray(self.atoms.get_dipole_moment(), dtype=float)
            except Exception:  # noqa: BLE001 - most calculators simply have no dipole
                self.use_dipole = False
        return forces, dipole


class ChargeDipoleEngine:
    """Forces from an ASE calculator, dipole from Open Babel partial charges (approximate)."""

    def __init__(self, atoms: Atoms, structure: Structure, charge_model: str) -> None:
        from atomscope.chem.properties import partial_charges  # noqa: PLC0415

        self.atoms = atoms
        result = partial_charges(structure, charge_model)  # type: ignore[arg-type]
        scalars = result.structure.atomic_scalars["partial_charges"]
        self.charges = np.asarray(scalars.values, dtype=float)

    def evaluate(self, positions: np.ndarray) -> tuple[np.ndarray, np.ndarray | None]:
        self.atoms.set_positions(positions)
        forces = np.asarray(self.atoms.get_forces(), dtype=float)
        return forces, (self.charges[:, None] * positions).sum(axis=0)


def hessian(engine: ForceEngine, positions: np.ndarray, delta: float) -> tuple[np.ndarray, Any]:
    """Central-difference Hessian (eV/A^2) and dipole derivative (e, i.e. e*A per A).

    Returns ``(H, dmu_dx)`` where ``H`` is 3N x 3N and ``dmu_dx`` is 3N x 3 or ``None`` when the
    engine produced no dipole.
    """
    n = positions.shape[0]
    ndof = 3 * n
    h = np.zeros((ndof, ndof), dtype=float)
    dmu = np.zeros((ndof, 3), dtype=float)
    have_dipole = True
    for r in range(ndof):
        atom, cart = divmod(r, 3)
        plus = positions.copy()
        plus[atom, cart] += delta
        minus = positions.copy()
        minus[atom, cart] -= delta
        f_plus, mu_plus = engine.evaluate(plus)
        f_minus, mu_minus = engine.evaluate(minus)
        h[r] = -(f_plus - f_minus).ravel() / (2.0 * delta)
        if mu_plus is None or mu_minus is None:
            have_dipole = False
        else:
            dmu[r] = (mu_plus - mu_minus) / (2.0 * delta)
    return 0.5 * (h + h.T), (dmu if have_dipole else None)


def _orthonormalize(columns: np.ndarray, against: np.ndarray | None = None) -> np.ndarray:
    """Orthonormal basis of the column space, optionally after projecting ``against`` out."""
    m = columns if against is None else columns - against @ (against.T @ columns)
    u, s, _ = np.linalg.svd(m, full_matrices=False)
    keep = s > s[0] * 1e-6 if s.size and s[0] > 0 else np.zeros(s.shape, dtype=bool)
    return np.asarray(u[:, keep])


def trivial_basis(positions: np.ndarray, masses: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Orthonormal mass-weighted bases of the translations (3N x 3) and rotations (3N x 2 or 3).

    Translation along ``a``: ``T_a[3i+c] = sqrt(m_i) delta_ac``.
    Rotation about ``a``:    ``R_a[3i+:] = sqrt(m_i) (e_a x (r_i - R_com))``.
    A linear molecule has only two independent rotations, so the rotation rank is 2 and the
    molecule has 3N-5 vibrations.
    """
    n = positions.shape[0]
    sqrt_m = np.sqrt(masses)
    com = (masses[:, None] * positions).sum(axis=0) / masses.sum()
    rel = positions - com
    trans = np.zeros((3 * n, 3))
    rot = np.zeros((3 * n, 3))
    for a in range(3):
        t = np.zeros((n, 3))
        t[:, a] = sqrt_m
        trans[:, a] = t.ravel()
        axis = np.zeros(3)
        axis[a] = 1.0
        rot[:, a] = (sqrt_m[:, None] * np.cross(axis, rel)).ravel()
    translations = _orthonormalize(trans)
    return translations, _orthonormalize(rot, against=translations)


def frequencies_cm(eigenvalues: np.ndarray) -> np.ndarray:
    """cm^-1 from eigenvalues of the mass-weighted Hessian; imaginary modes come out negative."""
    energies = EV_PER_SQRT_EIGENVALUE * np.sqrt(np.abs(eigenvalues))
    return np.sign(eigenvalues) * energies / units.invcm


def _mode(
    vector: np.ndarray,
    frequency: float,
    masses: np.ndarray,
    ir_intensity: float | None,
    kind: str,
) -> VibrationalMode:
    n = masses.size
    v = vector.reshape(n, 3)
    cartesian = v / np.sqrt(masses)[:, None]
    norm = float(np.linalg.norm(cartesian))
    if norm > 0:
        cartesian = cartesian / norm
    reduced_mass = 1.0 / float((vector**2 / np.repeat(masses, 3)).sum())
    omega = 2.0 * math.pi * C_CM_PER_S * abs(frequency)  # rad/s
    # k [N/m] = mu [kg] * omega^2; 1 mDyne/A = 100 N/m
    force_constant = reduced_mass * units._amu * omega**2 / 100.0
    displacements: list[Vec3] = [(float(d[0]), float(d[1]), float(d[2])) for d in cartesian]
    return VibrationalMode(
        frequency=float(frequency),
        displacements=displacements,
        ir_intensity=ir_intensity,
        reduced_mass=reduced_mass,
        force_constant=force_constant,
        kind=kind,
    )


def compute_modes(
    structure: Structure,
    engine: ForceEngine,
    *,
    delta: float = 0.01,
    method: str = "finite-difference Hessian",
    masses: np.ndarray | None = None,
) -> VibrationalSpectrum:
    """Normal modes of ``structure`` from central differences of the engine's forces.

    ``delta`` is the Cartesian displacement in A (ASE's default is 0.01 A). ``masses`` defaults
    to the standard atomic masses of the elements.
    """
    n = structure.n_atoms
    if n < 2:
        msg = "normal modes need at least two atoms"
        raise VibrationError(msg)
    if delta <= 0:
        msg = "the finite-difference displacement must be positive"
        raise VibrationError(msg)
    positions = structure.positions()
    if masses is None:
        masses = np.asarray(Atoms(symbols=structure.symbols()).get_masses(), dtype=float)
    if not np.all(masses > 0):
        msg = "every atom needs a non-zero mass"
        raise VibrationError(msg)

    h, dmu_dx = hessian(engine, positions, delta)
    weights = 1.0 / np.sqrt(np.repeat(masses, 3))
    eigenvalues, vectors = np.linalg.eigh(weights[:, None] * h * weights[None, :])
    freqs = frequencies_cm(eigenvalues)

    translations, rotations = trivial_basis(positions, masses)
    n_trivial = translations.shape[1] + rotations.shape[1]
    t_overlap = np.square(translations.T @ vectors).sum(axis=0)
    r_overlap = np.square(rotations.T @ vectors).sum(axis=0)
    overlap = t_overlap + r_overlap
    trivial_index = set(np.argsort(overlap)[::-1][:n_trivial].tolist())

    intensities = _ir_intensities(dmu_dx, vectors, masses)

    modes: list[VibrationalMode] = []
    trivial: list[VibrationalMode] = []
    for k in range(vectors.shape[1]):
        if k in trivial_index:
            kind = "translation" if t_overlap[k] >= r_overlap[k] else "rotation"
            trivial.append(_mode(vectors[:, k], freqs[k], masses, None, kind))
        else:
            ir = None if intensities is None else float(intensities[k])
            modes.append(_mode(vectors[:, k], freqs[k], masses, ir, "vibration"))
    modes.sort(key=lambda m: m.frequency)
    trivial.sort(key=lambda m: m.frequency)

    zpe = 0.5 * sum(m.frequency for m in modes if m.frequency > 0) * units.invcm
    return VibrationalSpectrum(
        id=new_uid(),
        structure_id=structure.id,
        symbols=structure.symbols(),
        positions=[(float(p[0]), float(p[1]), float(p[2])) for p in positions],
        modes=modes,
        trivial_modes=trivial,
        zero_point_energy=zpe,
        linear=n_trivial == 5,
        method=method,
        provenance=Provenance(source="analysis.vibrations", notes=method),
    )


def _ir_intensities(
    dmu_dx: np.ndarray | None, vectors: np.ndarray, masses: np.ndarray
) -> np.ndarray | None:
    """km/mol per mode from the Cartesian dipole derivative (3N x 3, in e)."""
    if dmu_dx is None:
        return None
    weights = 1.0 / np.sqrt(np.repeat(masses, 3))
    dmu_dq = (weights[:, None] * dmu_dx).T @ vectors  # 3 x 3N, in e/sqrt(amu)
    squared = np.square(dmu_dq * DEBYE_PER_E_ANGSTROM).sum(axis=0)  # (D/A)^2/amu
    return np.asarray(KM_PER_MOL_PER_DA2_AMU * squared)


def make_engine(
    structure: Structure,
    calculator: Any,
    *,
    dipole: DipoleSource = "calculator",
    charge_model: str = "gasteiger",
) -> ForceEngine:
    """Attach ``calculator`` to the structure and choose where the dipole comes from."""
    from atomscope.ase_bridge.convert import to_atoms  # noqa: PLC0415

    atoms = to_atoms(structure)
    atoms.calc = calculator
    if dipole == "partial_charges":
        return ChargeDipoleEngine(atoms, structure, charge_model)
    return AseForceEngine(atoms, use_dipole=dipole == "calculator")


__all__ = [
    "AseForceEngine",
    "ChargeDipoleEngine",
    "DipoleSource",
    "ForceEngine",
    "VibrationError",
    "compute_modes",
    "frequencies_cm",
    "hessian",
    "make_engine",
    "trivial_basis",
]
