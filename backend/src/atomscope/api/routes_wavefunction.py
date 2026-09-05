"""Wavefunction import and surface generation (Avogadro 1 "Create Surfaces" equivalent).

A wavefunction file (Gaussian fchk, Molden) is read into memory, its orbitals are listed, and
requested fields (molecular orbital, electron/spin density, electrostatic potential, van der
Waals volume) are evaluated on a grid and stored as project datasets, so the existing Surfaces
panel can display them like any other volumetric data.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np
from anyio import to_thread
from fastapi import APIRouter, HTTPException, Request, status
from pydantic import Field

from atomscope.api.state import AppState
from atomscope.calculations.grids import write_sidecar
from atomscope.model import OrbitalInfo, Structure, VolumetricGrid
from atomscope.model.common import StrictModel
from atomscope.model.grid import GridKind
from atomscope.units import Unit
from atomscope.wavefunction import (
    EvaluationCancelledError,
    EvaluationHooks,
    GridBox,
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
from atomscope.wavefunction.tasks import SurfaceTask, TaskStatus

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


class SurfaceTaskStatus(StrictModel):
    """A running (or finished) field evaluation. The grid is there once the status is `done`."""

    id: str
    status: TaskStatus
    progress: float = Field(ge=0.0, le=1.0, description="fraction of the grid points evaluated")
    grid: VolumetricGrid | None = None
    error: str | None = None


def _status(task: SurfaceTask) -> SurfaceTaskStatus:
    return SurfaceTaskStatus(
        id=task.id,
        status=task.status,
        progress=task.progress,
        grid=task.grid,
        error=task.error,
    )


def _field_values(
    wavefunction: Wavefunction,
    body: SurfaceRequest,
    box: GridBox,
    index: int | None,
    hooks: EvaluationHooks,
) -> np.ndarray:
    """The field itself. Runs in a worker thread, so it touches nothing but its arguments."""
    if body.kind == "orbital":
        assert index is not None
        return orbital_values(wavefunction, index, box, hooks)
    if body.kind == "density":
        return density_values(wavefunction, box, hooks=hooks)
    if body.kind == "spin_density":
        return spin_density_values(wavefunction, box, hooks=hooks)
    if body.kind == "electrostatic_potential":
        return electrostatic_potential_values(wavefunction, box, hooks=hooks)
    return vdw_values(wavefunction.structure, box, scale=body.vdw_scale, hooks=hooks)


@dataclass(frozen=True)
class _FieldPlan:
    """Everything about the requested field that can be settled before any arithmetic."""

    name: str
    unit: Unit
    grid_kind: GridKind
    orbital_meta: OrbitalInfo | None
    orbital_index: int | None


def _plan(wavefunction: Wavefunction, body: SurfaceRequest, box: GridBox) -> _FieldPlan:
    """Name, unit and orbital metadata, refusing what cannot be evaluated. Raises HTTPException."""
    stem = Path(body.path).stem
    grid_kind: GridKind = {  # type: ignore[assignment]
        "orbital": "orbital",
        "density": "electron_density",
        "spin_density": "spin_density",
        "electrostatic_potential": "electrostatic_potential",
        "vdw": "other",
    }[body.kind]
    if body.kind == "orbital":
        homo = wavefunction.homo_index()
        index = body.orbital_index if body.orbital_index is not None else homo
        if index is None or not 0 <= index < len(wavefunction.orbitals):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"no orbital {index}")
        mo = wavefunction.orbitals[index]
        meta = OrbitalInfo(
            index=index,
            energy=mo.energy * 27.211386245988 if mo.energy is not None else None,
            occupation=mo.occupation,
            spin={"alpha": "up", "beta": "down"}.get(mo.spin, "none"),  # type: ignore[arg-type]
            label=mo.label or _label(index, homo),
        )
        return _FieldPlan(f"{stem} {meta.label}", Unit.DIMENSIONLESS, grid_kind, meta, index)
    if body.kind == "density":
        return _FieldPlan(f"{stem} electron density", Unit.E_PER_BOHR3, grid_kind, None, None)
    if body.kind == "spin_density":
        return _FieldPlan(f"{stem} spin density", Unit.E_PER_BOHR3, grid_kind, None, None)
    if body.kind == "electrostatic_potential":
        if box.n_points > MAX_ESP_POINTS:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"the electrostatic potential is quadratic in the grid size; {box.n_points} points "
                f"exceed the {MAX_ESP_POINTS} limit, use a coarser spacing",
            )
        return _FieldPlan(
            f"{stem} electrostatic potential", Unit.HARTREE_PER_E, grid_kind, None, None
        )
    return _FieldPlan(f"{stem} van der Waals volume", Unit.ANGSTROM, grid_kind, None, None)


@router.post("/surface", response_model=SurfaceTaskStatus)
async def surface(body: SurfaceRequest, request: Request) -> SurfaceTaskStatus:
    """Start evaluating a field on a grid; the dataset is stored in the project when it finishes.

    Everything that can be refused is refused here, synchronously, so a bad request is still a
    400. What is left is the arithmetic, which runs in a worker thread and is followed with
    `GET /surface/{id}` and stopped with `POST /surface/{id}/cancel`.
    """
    state = _state(request)
    project = state.require_project()
    wavefunction = _load(body.path)
    try:
        box = bounding_box(wavefunction.structure, padding=body.padding, spacing=body.spacing)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    plan = _plan(wavefunction, body, box)

    task = state.surface_tasks.start()
    hooks = EvaluationHooks(should_stop=task.should_stop, on_progress=task.report)

    async def run() -> None:
        try:
            values = await to_thread.run_sync(
                lambda: _field_values(wavefunction, body, box, plan.orbital_index, hooks)
            )
        except EvaluationCancelledError:
            task.status = "cancelled"
            return
        except (ValueError, MemoryError, OSError) as exc:
            task.status, task.error = "failed", str(exc)
            return
        # the project is written from the loop thread, as every other route writes it
        grid = make_grid(
            plan.name,
            plan.grid_kind,
            box,
            plan.unit,
            wavefunction.structure,
            plan.orbital_meta,
            source=str(body.path),
        )
        relative = f"datasets/{grid.id}.f32"
        write_sidecar(project.path_in_project(relative), np.asarray(values, dtype=np.float32))
        grid.data_ref = relative
        grid.dtype = "float32"
        project.save_structure(wavefunction.structure)
        project.save_dataset(grid)
        task.grid = grid
        task.progress = 1.0
        task.status = "done"

    task.task = asyncio.create_task(run())
    return _status(task)


@router.get("/surface/{task_id}", response_model=SurfaceTaskStatus)
def surface_status(task_id: str, request: Request) -> SurfaceTaskStatus:
    """How far the evaluation has got, and its grid once it is done."""
    task = _state(request).surface_tasks.get(task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no surface task {task_id}")
    return _status(task)


@router.post("/surface/{task_id}/cancel", response_model=SurfaceTaskStatus)
def cancel_surface(task_id: str, request: Request) -> SurfaceTaskStatus:
    """Stop an evaluation. It notices at the end of the chunk of grid points it is in."""
    task = _state(request).surface_tasks.get(task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no surface task {task_id}")
    task.cancel()
    return _status(task)
