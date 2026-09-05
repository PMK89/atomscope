"""Volumetric grid data service: binary sidecars, statistics and lookup inside a project.

Sidecars are little-endian float32 in C order matching ``VolumetricGrid.shape``. ``data_ref``
is always a path relative to the project root (``calculations/<id>/results/<grid>.f32`` or
``datasets/<grid>.f32``) so one lookup serves both sources.

Suggested isovalue rule (``GridStats.suggested_isovalue``):

* density-like kinds (``electron_density``, ``orbital_density``): the value ``v`` such that the
  voxels with ``values >= v`` contain ``DENSITY_FRACTION`` (80 %) of the integrated positive
  field. This is robust against the nuclear cusps that make "10 % of max" a pinprick.
* signed kinds (orbitals, spin density, density differences, potentials) and any other field
  with negative values: ``min(0.05, abs_max / 2)`` - the conventional +-0.05 orbital contour,
  clamped so it always intersects the data.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from pydantic import Field

from atomscope.backends.base import ResultBundle
from atomscope.calculations.models import Calculation
from atomscope.model import Provenance, Structure, VolumetricGrid
from atomscope.model.common import StrictModel
from atomscope.model.grid import GridKind
from atomscope.parsers.cube import read_cube
from atomscope.project import ProjectStore
from atomscope.units import Unit

DENSITY_FRACTION = 0.8
ORBITAL_ISOVALUE = 0.05
DENSITY_KINDS: frozenset[str] = frozenset({"electron_density", "orbital_density"})


class GridStats(StrictModel):
    min: float
    max: float
    mean: float
    abs_max: float
    has_negative: bool
    suggested_isovalue: float
    rule: str = Field(description="how suggested_isovalue was chosen")


class GridRef(StrictModel):
    """A grid and where it lives: a calculation's results or a standalone dataset."""

    grid: VolumetricGrid
    calculation_id: str | None = None


def write_sidecar(path: Path, values: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    np.ascontiguousarray(values, dtype="<f4").tofile(path)


def load_values(project: ProjectStore, grid: VolumetricGrid) -> np.ndarray:
    """Read a grid's values from its sidecar (or inline values) as a C-order array."""
    if grid.inline_values is not None:
        return np.asarray(grid.inline_values, dtype=np.float64).reshape(grid.shape)
    assert grid.data_ref is not None
    path = project.path_in_project(grid.data_ref)
    dtype = "<f4" if grid.dtype == "float32" else "<f8"
    data = np.fromfile(path, dtype=dtype)
    if data.size != grid.n_points:
        msg = f"sidecar {grid.data_ref} has {data.size} values, shape needs {grid.n_points}"
        raise ValueError(msg)
    return data.reshape(grid.shape)


def compute_stats(values: np.ndarray, kind: GridKind) -> GridStats:
    flat = np.asarray(values, dtype=np.float64).reshape(-1)
    vmin, vmax = float(flat.min()), float(flat.max())
    abs_max = max(abs(vmin), abs(vmax))
    has_negative = vmin < 0
    if kind in DENSITY_KINDS and not has_negative and vmax > 0:
        pos = np.sort(flat[flat > 0])[::-1]
        cum = np.cumsum(pos)
        idx = int(np.searchsorted(cum, DENSITY_FRACTION * cum[-1]))
        iso = float(pos[min(idx, pos.size - 1)])
        rule = f"isovalue enclosing {DENSITY_FRACTION:.0%} of the integrated density"
    else:
        iso = min(ORBITAL_ISOVALUE, abs_max / 2) if abs_max > 0 else 0.0
        rule = f"min({ORBITAL_ISOVALUE}, abs_max / 2) for signed fields"
    return GridStats(
        min=vmin,
        max=vmax,
        mean=float(flat.mean()),
        abs_max=abs_max,
        has_negative=has_negative,
        suggested_isovalue=iso,
        rule=rule,
    )


def materialize_grids(
    bundle: ResultBundle, work: Path, calc_id: str, project: ProjectStore
) -> None:
    """Convert the cubes referenced by ``bundle.grids`` (file names inside ``work``) into float32
    sidecars under ``calculations/<calc_id>/results/`` and point ``data_ref`` at them.

    Unreadable cubes are dropped with a warning; result collection must never fail on a grid.
    """
    kept: list[VolumetricGrid] = []
    for grid in bundle.grids:
        if grid.data_ref is None:
            kept.append(grid)
            continue
        cube = work / grid.data_ref
        try:
            values = read_cube(cube, kind=grid.kind, unit=grid.unit).values
            if values.shape != tuple(grid.shape):
                msg = f"shape {values.shape} does not match grid {grid.shape}"
                raise ValueError(msg)  # noqa: TRY301
            rel = f"calculations/{calc_id}/results/{grid.id}.f32"
            write_sidecar(project.path_in_project(rel), values)
        except (OSError, ValueError) as exc:
            bundle.warnings.append(f"grid {grid.name}: could not convert {cube.name}: {exc}")
            continue
        grid.data_ref = rel
        grid.dtype = "float32"
        kept.append(grid)
    bundle.grids = kept


def import_cube(
    project: ProjectStore, path: Path, kind: GridKind = "other", unit: Unit = Unit.E_PER_BOHR3
) -> tuple[VolumetricGrid, Structure]:
    """Import a cube file as a standalone dataset; the embedded structure is saved as well."""
    data = read_cube(path, kind=kind, unit=unit)
    grid, structure = data.grid, data.structure
    structure.provenance = Provenance(source=str(path))
    project.save_structure(structure)
    rel = f"datasets/{grid.id}.f32"
    write_sidecar(project.path_in_project(rel), data.values)
    grid.data_ref = rel
    grid.dtype = "float32"
    project.save_dataset(grid)
    return grid, structure


def list_grids(project: ProjectStore, calculations: list[Calculation]) -> list[GridRef]:
    """All grids of the project: calculation results first, then datasets."""
    out: list[GridRef] = []
    for calc in calculations:
        if calc.results is not None:
            out.extend(GridRef(grid=g, calculation_id=calc.id) for g in calc.results.grids)
    out.extend(GridRef(grid=g) for g in project.list_datasets())
    return out


def find_grid(
    project: ProjectStore, calculations: list[Calculation], grid_id: str
) -> GridRef | None:
    return next((r for r in list_grids(project, calculations) if r.grid.id == grid_id), None)
