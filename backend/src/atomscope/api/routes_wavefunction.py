"""Wavefunction import and surface generation (Avogadro 1 "Create Surfaces" equivalent).

A wavefunction file (Gaussian fchk, Molden) is read into memory, its orbitals are listed, and
requested fields (molecular orbital, electron/spin density, electrostatic potential, van der
Waals volume) are evaluated on a grid and stored as project datasets, so the existing Surfaces
panel can display them like any other volumetric data.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import numpy as np
from fastapi import APIRouter, HTTPException, Request, status
from pydantic import Field

from atomscope.api.state import AppState
from atomscope.calculations.grids import write_sidecar
from atomscope.model import OrbitalInfo, Structure, VolumetricGrid
from atomscope.model.common import StrictModel
from atomscope.model.grid import GridKind
from atomscope.units import Unit
from atomscope.wavefunction import (
    bounding_box,
    density_values,
    electrostatic_potential_values,
    make_grid,
    orbital_values,
    read_wavefunction,
    spin_density_values,
    vdw_values,
)
from atomscope.wavefunction.model import Wavefunction

router = APIRouter(prefix="/api/wavefunction", tags=["wavefunction"])

FieldKind = Literal["orbital", "density", "spin_density", "electrostatic_potential", "vdw"]
MAX_ESP_POINTS = 200_000


class WavefunctionOrbital(StrictModel):
    index: int
    energy: float | None = Field(default=None, description="Hartree, as written by the program")
    occupation: float
    spin: str
    label: str


class WavefunctionInfo(StrictModel):
    """What a loaded wavefunction offers; the structure is saved into the project."""

    structure: Structure
    n_basis: int
    n_electrons: float
    orbitals: list[WavefunctionOrbital]
    homo_index: int | None
    source: str
    format: str


class LoadRequest(StrictModel):
    path: Path


class SurfaceRequest(StrictModel):
    path: Path = Field(description="the wavefunction file to evaluate")
    kind: FieldKind = "orbital"
    orbital_index: int | None = Field(default=None, description="0-based; default is the HOMO")
    spacing: float = Field(default=0.2, gt=0.01, le=2.0, description="grid spacing in Angstrom")
    padding: float = Field(default=3.5, ge=0.0, le=20.0, description="box padding in Angstrom")
    vdw_scale: float = Field(default=1.0, gt=0.0, le=3.0)


def _state(request: Request) -> AppState:
    state: AppState = request.app.state.atomscope
    return state


def _load(path: Path) -> Wavefunction:
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{path} not found")
    try:
        return read_wavefunction(path)
    except (ValueError, OSError, IndexError, KeyError) as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"could not read {path.name}: {exc}"
        ) from exc


def _label(index: int, homo: int | None) -> str:
    if homo is None:
        return f"MO {index + 1}"
    offset = index - homo
    if offset == 0:
        return "HOMO"
    if offset == 1:
        return "LUMO"
    return f"HOMO-{-offset}" if offset < 0 else f"LUMO+{offset - 1}"


@router.post("/load", response_model=WavefunctionInfo)
def load(body: LoadRequest, request: Request) -> WavefunctionInfo:
    """Read a wavefunction file and register its geometry in the open project."""
    wavefunction = _load(body.path)
    project = _state(request).require_project()
    project.save_structure(wavefunction.structure)
    homo = wavefunction.homo_index()
    return WavefunctionInfo(
        structure=wavefunction.structure,
        n_basis=wavefunction.n_basis,
        n_electrons=wavefunction.n_electrons,
        orbitals=[
            WavefunctionOrbital(
                index=i,
                energy=mo.energy,
                occupation=mo.occupation,
                spin=mo.spin,
                label=mo.label or _label(i, homo),
            )
            for i, mo in enumerate(wavefunction.orbitals)
        ],
        homo_index=homo,
        source=wavefunction.source,
        format=wavefunction.metadata.get("format", "unknown"),
    )


@router.post("/surface", response_model=VolumetricGrid)
def surface(body: SurfaceRequest, request: Request) -> VolumetricGrid:
    """Evaluate a field on a grid and store it as a dataset of the open project."""
    project = _state(request).require_project()
    wavefunction = _load(body.path)
    try:
        box = bounding_box(wavefunction.structure, padding=body.padding, spacing=body.spacing)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    orbital_meta: OrbitalInfo | None = None
    homo = wavefunction.homo_index()
    if body.kind == "orbital":
        index = body.orbital_index if body.orbital_index is not None else homo
        if index is None or not 0 <= index < len(wavefunction.orbitals):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"no orbital {index}")
        values = orbital_values(wavefunction, index, box)
        mo = wavefunction.orbitals[index]
        orbital_meta = OrbitalInfo(
            index=index,
            energy=mo.energy * 27.211386245988 if mo.energy is not None else None,
            occupation=mo.occupation,
            spin={"alpha": "up", "beta": "down"}.get(mo.spin, "none"),  # type: ignore[arg-type]
            label=mo.label or _label(index, homo),
        )
        name = f"{Path(body.path).stem} {orbital_meta.label}"
        unit = Unit.DIMENSIONLESS
    elif body.kind == "density":
        values = density_values(wavefunction, box)
        name = f"{Path(body.path).stem} electron density"
        unit = Unit.E_PER_BOHR3
    elif body.kind == "spin_density":
        values = spin_density_values(wavefunction, box)
        name = f"{Path(body.path).stem} spin density"
        unit = Unit.E_PER_BOHR3
    elif body.kind == "electrostatic_potential":
        if box.n_points > MAX_ESP_POINTS:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"the electrostatic potential is quadratic in the grid size; {box.n_points} points "
                f"exceed the {MAX_ESP_POINTS} limit, use a coarser spacing",
            )
        values = electrostatic_potential_values(wavefunction, box)
        name = f"{Path(body.path).stem} electrostatic potential"
        unit = Unit.HARTREE_PER_E
    else:
        values = vdw_values(wavefunction.structure, box, scale=body.vdw_scale)
        name = f"{Path(body.path).stem} van der Waals volume"
        unit = Unit.ANGSTROM

    grid_kind: GridKind = {  # type: ignore[assignment]
        "orbital": "orbital",
        "density": "electron_density",
        "spin_density": "spin_density",
        "electrostatic_potential": "electrostatic_potential",
        "vdw": "other",
    }[body.kind]
    grid = make_grid(
        name, grid_kind, box, unit, wavefunction.structure, orbital_meta, source=str(body.path)
    )
    relative = f"datasets/{grid.id}.f32"
    write_sidecar(project.path_in_project(relative), np.asarray(values, dtype=np.float32))
    grid.data_ref = relative
    grid.dtype = "float32"
    project.save_structure(wavefunction.structure)
    project.save_dataset(grid)
    return grid
