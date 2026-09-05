"""Generate volumetric fields from a wavefunction (Avogadro 1 "Create Surfaces" equivalent).

All grids are returned as :class:`atomscope.model.VolumetricGrid` metadata plus a NumPy array,
in the same convention as the cube parser: value (i, j, k) sits at ``origin + i*a + j*b + k*c``
with the axes in Angstrom, while the evaluation happens in Bohr because that is the unit of the
Gaussian basis.

Fields: molecular orbital (psi), electron density (sum of occ*|psi|^2), spin density
(alpha - beta), electrostatic potential of the nuclei and the electrons, and a van der Waals
"distance" field whose zero isosurface is the union of the atomic vdW spheres.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass

import numpy as np
from ase.data import atomic_numbers, vdw_radii
from ase.units import Bohr

from atomscope.model import OrbitalInfo, Provenance, Structure, VolumetricGrid, new_uid
from atomscope.model.grid import GridKind
from atomscope.units import Unit
from atomscope.wavefunction.gto import basis_values
from atomscope.wavefunction.model import Wavefunction

DEFAULT_PADDING_ANGSTROM = 3.5
DEFAULT_SPACING_ANGSTROM = 0.2
MAX_POINTS = 40_000_000
CHUNK_POINTS = 200_000
ESP_SOURCES = 20_000
ESP_PAIR_BUDGET = 8_000_000  # entries of the target x source distance matrix (~64 MB)
ESP_MAX_POINTS = 2_000_000  # the potential is a grid integral, so its cost is quadratic


class EvaluationCancelledError(Exception):
    """Raised out of a field evaluation whose caller asked it to stop."""


@dataclass(frozen=True)
class EvaluationHooks:
    """What a long evaluation reports and obeys, checked once per chunk of grid points.

    A field over a fine grid takes seconds to minutes, so the caller needs two things from it:
    how far it has got, and a way to stop it. Both are optional, and a plain call has neither.
    """

    should_stop: Callable[[], bool] | None = None
    on_progress: Callable[[float], None] | None = None

    def step(self, filled: int, total: int) -> None:
        """Called with the points done so far; raises when the caller has asked to stop."""
        if self.should_stop is not None and self.should_stop():
            raise EvaluationCancelledError
        if self.on_progress is not None:
            self.on_progress(filled / total if total > 0 else 1.0)


NO_HOOKS = EvaluationHooks()


@dataclass(frozen=True)
class GridBox:
    """A regular grid: origin and step vectors in Angstrom plus the point counts."""

    origin: tuple[float, float, float]
    axes: tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]
    shape: tuple[int, int, int]

    @property
    def n_points(self) -> int:
        return self.shape[0] * self.shape[1] * self.shape[2]

    def points_bohr(self) -> Iterator[np.ndarray]:
        """Yield chunks of grid points in Bohr, in C order (third index fastest)."""
        origin = np.array(self.origin) / Bohr
        a, b, c = (np.array(v) / Bohr for v in self.axes)
        n0, n1, n2 = self.shape
        rows_per_chunk = max(1, CHUNK_POINTS // max(1, n1 * n2))
        j, k = np.meshgrid(np.arange(n1), np.arange(n2), indexing="ij")
        plane = origin + j.ravel()[:, None] * b + k.ravel()[:, None] * c
        for start in range(0, n0, rows_per_chunk):
            stop = min(n0, start + rows_per_chunk)
            block = np.concatenate([plane + i * a for i in range(start, stop)])
            yield block


def bounding_box(
    structure: Structure,
    padding: float = DEFAULT_PADDING_ANGSTROM,
    spacing: float = DEFAULT_SPACING_ANGSTROM,
) -> GridBox:
    """An axis-aligned box around the molecule with the requested padding and spacing."""
    if structure.n_atoms == 0:
        msg = "cannot build a grid box for a structure without atoms"
        raise ValueError(msg)
    if spacing <= 0:
        msg = "spacing must be positive"
        raise ValueError(msg)
    positions = structure.positions()
    lo = positions.min(axis=0) - padding
    hi = positions.max(axis=0) + padding
    shape = tuple(max(2, int(np.ceil((hi[d] - lo[d]) / spacing)) + 1) for d in range(3))
    if shape[0] * shape[1] * shape[2] > MAX_POINTS:
        msg = (
            f"grid of {shape} points exceeds the {MAX_POINTS} point budget; "
            "increase the spacing or reduce the padding"
        )
        raise ValueError(msg)
    return GridBox(
        origin=(float(lo[0]), float(lo[1]), float(lo[2])),
        axes=((spacing, 0.0, 0.0), (0.0, spacing, 0.0), (0.0, 0.0, spacing)),
        shape=shape,  # type: ignore[arg-type]
    )


def _evaluate(
    wavefunction: Wavefunction,
    box: GridBox,
    reducer: Callable[[np.ndarray], np.ndarray],
    hooks: EvaluationHooks = NO_HOOKS,
) -> np.ndarray:
    """Walk the grid in chunks, applying ``reducer(basis_block) -> values``."""
    centres = wavefunction.structure.positions() / Bohr
    out = np.empty(box.n_points, dtype=np.float64)
    filled = 0
    for chunk in box.points_bohr():
        chi = basis_values(wavefunction.shells, centres, chunk)
        values = reducer(chi)
        out[filled : filled + values.size] = values
        filled += values.size
        hooks.step(filled, box.n_points)
    return np.asarray(out[:filled].reshape(box.shape))


def orbital_values(
    wavefunction: Wavefunction, index: int, box: GridBox, hooks: EvaluationHooks = NO_HOOKS
) -> np.ndarray:
    """Values of one molecular orbital on the grid (atomic units)."""
    coefficients = wavefunction.orbitals[index].coefficients
    return _evaluate(wavefunction, box, lambda chi: coefficients @ chi, hooks)


def density_values(
    wavefunction: Wavefunction,
    box: GridBox,
    spin: str | None = None,
    hooks: EvaluationHooks = NO_HOOKS,
) -> np.ndarray:
    """Electron density, or the density of one spin channel when ``spin`` is given."""
    selected = [
        mo
        for mo in wavefunction.orbitals
        if mo.occupation > 0 and (spin is None or mo.spin in (spin, "none"))
    ]
    if not selected:
        msg = "no occupied orbitals for the requested spin channel"
        raise ValueError(msg)
    coefficients = np.array([mo.coefficients for mo in selected])
    occupations = np.array([mo.occupation for mo in selected])
    if spin is not None:
        # a restricted orbital carries both spins; take half of it for one channel
        occupations = np.array(
            [mo.occupation / 2.0 if mo.spin == "none" else mo.occupation for mo in selected]
        )

    def reducer(chi: np.ndarray) -> np.ndarray:
        psi = coefficients @ chi
        return np.asarray((occupations[:, None] * psi**2).sum(axis=0))

    return _evaluate(wavefunction, box, reducer)


def spin_density_values(
    wavefunction: Wavefunction, box: GridBox, hooks: EvaluationHooks = NO_HOOKS
) -> np.ndarray:
    """Alpha minus beta density; zero for a restricted wavefunction."""
    alpha = density_values(wavefunction, box, spin="alpha", hooks=hooks)
    try:
        beta = density_values(wavefunction, box, spin="beta", hooks=hooks)
    except ValueError:
        return np.zeros_like(alpha)
    return np.asarray(alpha - beta)


def electrostatic_potential_values(
    wavefunction: Wavefunction,
    box: GridBox,
    density: np.ndarray | None = None,
    hooks: EvaluationHooks = NO_HOOKS,
) -> np.ndarray:
    """Electrostatic potential V(r) = sum_A Z_A/|r-R_A| - integral rho(r')/|r-r'| dr'.

    The electronic term is evaluated by numerical integration over the same grid, which is
    accurate away from the nuclei (where the potential is dominated by the nuclear term anyway)
    and is the approach Avogadro 1's ESP colouring uses. Cost is O(N_grid^2) unless the density
    is thresholded, so the grid must be coarse: use a spacing of ~0.4 A or more.
    """
    if box.n_points > ESP_MAX_POINTS:
        msg = (
            f"grid of {box.n_points} points is too large for the electrostatic potential "
            f"(budget {ESP_MAX_POINTS}); the electronic term is a grid integral, so the cost "
            "grows with the square of the point count. Use a coarser spacing."
        )
        raise ValueError(msg)
    if density is None:
        density = density_values(wavefunction, box, hooks=hooks)
    numbers = wavefunction.structure.numbers()
    nuclei = wavefunction.structure.positions() / Bohr
    voxel = abs(np.linalg.det(np.array(box.axes) / Bohr))

    # keep only voxels that carry charge, which removes most of the quadratic cost
    flat_density = density.ravel()
    significant = flat_density > 1e-6
    source_points = np.concatenate(list(box.points_bohr()))[significant]
    source_charge = flat_density[significant] * voxel
    # A target point that coincides with a source voxel would see a 1/0 singularity. Use the
    # analytic potential at the centre of a uniformly charged cube of side L: V = 2.3800774 q / L
    # (Hummer, Chem. Phys. Lett. 235, 297 (1995)), which keeps the on-grid potential finite.
    side = voxel ** (1.0 / 3.0)
    self_potential = 2.3800774 / side
    near = 0.5 * side

    source_sq = (source_points**2).sum(axis=1)
    # The pair term is a targets x sources matrix, so both loops are blocked to keep it small.
    targets_per_block = max(1, ESP_PAIR_BUDGET // max(1, min(source_points.shape[0], ESP_SOURCES)))

    out = np.empty(box.n_points, dtype=np.float64)
    filled = 0
    for chunk in box.points_bohr():
        nuclear = np.zeros(chunk.shape[0])
        for z, r in zip(numbers, nuclei, strict=True):
            distance = np.linalg.norm(chunk - r, axis=1)
            nuclear += z / np.maximum(distance, 1e-8)
        electronic = np.zeros(chunk.shape[0])
        for lo in range(0, chunk.shape[0], targets_per_block):
            targets = chunk[lo : lo + targets_per_block]
            target_sq = (targets**2).sum(axis=1)
            partial = np.zeros(targets.shape[0])
            for start in range(0, source_points.shape[0], ESP_SOURCES):
                block = source_points[start : start + ESP_SOURCES]
                charge = source_charge[start : start + ESP_SOURCES]
                # |r - r'|^2 = |r|^2 + |r'|^2 - 2 r.r', which avoids materializing the vectors
                d2 = target_sq[:, None] + source_sq[start : start + ESP_SOURCES][None, :]
                d2 -= 2.0 * (targets @ block.T)
                distance = np.sqrt(np.maximum(d2, 0.0))
                contribution = np.where(
                    distance < near, charge * self_potential, charge / np.maximum(distance, near)
                )
                partial += contribution.sum(axis=1)
            electronic[lo : lo + targets_per_block] = partial
        out[filled : filled + chunk.shape[0]] = nuclear - electronic
        filled += chunk.shape[0]
        hooks.step(filled, box.n_points)
    return np.asarray(out.reshape(box.shape))


def vdw_values(
    structure: Structure, box: GridBox, scale: float = 1.0, hooks: EvaluationHooks = NO_HOOKS
) -> np.ndarray:
    """Signed distance-like field whose zero isosurface is the union of vdW spheres.

    ``f(r) = max_A (R_A - |r - R_A|)``, so f > 0 inside the molecular volume. Radii are Bondi/
    Alvarez values from ASE, falling back to 1.5 times the covalent radius when unknown.
    """
    from ase.data import covalent_radii  # noqa: PLC0415

    radii = []
    for symbol in structure.symbols():
        z = atomic_numbers[symbol]
        r = (
            vdw_radii[z]
            if z < len(vdw_radii) and np.isfinite(vdw_radii[z])
            else covalent_radii[z] * 1.5
        )
        radii.append(float(r) * scale)
    positions = structure.positions()
    out = np.full(box.n_points, -np.inf)
    filled = 0
    for chunk in box.points_bohr():
        chunk_ang = chunk * Bohr
        best = np.full(chunk_ang.shape[0], -np.inf)
        for r, centre in zip(radii, positions, strict=True):
            best = np.maximum(best, r - np.linalg.norm(chunk_ang - centre, axis=1))
        out[filled : filled + best.size] = best
        filled += best.size
        hooks.step(filled, box.n_points)
    return out.reshape(box.shape)


def make_grid(  # noqa: PLR0917
    name: str,
    kind: GridKind,
    box: GridBox,
    unit: Unit,
    structure: Structure,
    orbital: OrbitalInfo | None = None,
    source: str = "wavefunction",
) -> VolumetricGrid:
    """Grid metadata for values produced by the functions above (values stored separately)."""
    return VolumetricGrid(
        id=new_uid(),
        name=name,
        kind=kind,
        origin=box.origin,
        axes=box.axes,
        shape=box.shape,
        unit=unit,
        dtype="float32",
        data_ref=f"{name}.f32",
        orbital=orbital,
        structure_id=structure.id,
        provenance=Provenance(source=source, software="atomscope.wavefunction"),
    )
