"""Trajectory delivery (JSON, binary positions, per-frame scalars) and multi-frame file IO."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import numpy as np
from fastapi import APIRouter, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import Field

from atomscope.api.state import AppState
from atomscope.calculations.service import CalculationError
from atomscope.io.registry import FormatError
from atomscope.io.trajectory_io import (
    read_trajectory,
    trajectory_to_extxyz,
    write_trajectory_extxyz,
)
from atomscope.model import Structure, Trajectory
from atomscope.model.common import Mat3, StrictModel

calc_router = APIRouter(prefix="/api/calculations", tags=["trajectory"])
io_router = APIRouter(prefix="/api/io", tags=["trajectory"])


class TrajectoryScalars(StrictModel):
    """Per-frame scalars and cells; the companion of the binary positions stream."""

    id: str
    name: str
    kind: str
    n_frames: int
    n_atoms: int
    symbols: list[str]
    energy: list[float | None]
    time: list[float | None]
    temperature: list[float | None]
    step: list[int | None]
    cells: list[Mat3 | None]


class TrajectoryImport(StrictModel):
    trajectory: Trajectory
    structure: Structure = Field(description="first frame, with perceived bonds")


class ImportTrajectoryRequest(StrictModel):
    path: Path
    format: str | None = Field(default=None, description="ASE format name; auto-detected if None")


class ExportTrajectoryRequest(StrictModel):
    trajectory: Trajectory
    path: Path | None = Field(default=None, description="write here if given, else return text")


class ExportTrajectoryResponse(StrictModel):
    text: str | None = None
    path: Path | None = None


def _state(request: Request) -> AppState:
    state: AppState = request.app.state.atomscope
    return state


def _trajectory(calc_id: str, request: Request) -> Trajectory:
    svc = _state(request).require_calculations()
    try:
        calc = svc.get(calc_id)
    except CalculationError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    results = calc.results
    if results is None:
        if calc.generated is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "calculation has not run")
        results = svc.collect_results(calc_id)
    if results.trajectory is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "calculation has no trajectory")
    return results.trajectory


@calc_router.get("/{calc_id}/trajectory", response_model=Trajectory)
def trajectory(calc_id: str, request: Request) -> Trajectory:
    return _trajectory(calc_id, request)


@calc_router.get("/{calc_id}/trajectory/scalars", response_model=TrajectoryScalars)
def trajectory_scalars(calc_id: str, request: Request) -> TrajectoryScalars:
    t = _trajectory(calc_id, request)
    return TrajectoryScalars(
        id=t.id,
        name=t.name,
        kind=t.kind,
        n_frames=t.n_frames,
        n_atoms=len(t.symbols),
        symbols=t.symbols,
        energy=[f.energy for f in t.frames],
        time=[f.time for f in t.frames],
        temperature=[f.temperature for f in t.frames],
        step=[f.step for f in t.frames],
        cells=[f.cell for f in t.frames],
    )


@calc_router.get(
    "/{calc_id}/trajectory/positions",
    response_class=StreamingResponse,
    responses={200: {"content": {"application/octet-stream": {}}}},
)
def trajectory_positions(calc_id: str, request: Request) -> StreamingResponse:
    """Raw little-endian float32 positions, frames x atoms x 3 (Å), one frame per chunk."""
    t = _trajectory(calc_id, request)

    def chunks() -> Iterator[bytes]:
        for frame in t.frames:
            yield np.asarray(frame.positions, dtype="<f4").tobytes()

    return StreamingResponse(
        chunks(),
        media_type="application/octet-stream",
        headers={"X-Frames": str(t.n_frames), "X-Atoms": str(len(t.symbols))},
    )


@io_router.post("/import/trajectory", response_model=TrajectoryImport)
def import_trajectory_path(body: ImportTrajectoryRequest) -> TrajectoryImport:
    """Read a multi-frame file on this machine (extxyz, ASE .traj, XDATCAR, ...)."""
    if not body.path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{body.path} not found")
    try:
        t, s = read_trajectory(body.path, body.format)
    except (FormatError, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return TrajectoryImport(trajectory=t, structure=s)


@io_router.post("/import/trajectory/upload", response_model=TrajectoryImport)
async def import_trajectory_upload(file: UploadFile, request: Request) -> TrajectoryImport:
    """Read a multi-frame file from the browser file picker (name kept for format detection)."""
    target = _state(request).scratch_dir() / Path(file.filename or "upload.xyz").name
    target.write_bytes(await file.read())
    try:
        t, s = read_trajectory(target)
    except (FormatError, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    finally:
        target.unlink(missing_ok=True)
    return TrajectoryImport(trajectory=t, structure=s)


@io_router.post("/export/trajectory", response_model=ExportTrajectoryResponse)
def export_trajectory(body: ExportTrajectoryRequest) -> ExportTrajectoryResponse:
    """Write a trajectory as extended XYZ (energy, forces, cell, time per frame)."""
    try:
        if body.path is not None:
            write_trajectory_extxyz(body.trajectory, body.path)
            return ExportTrajectoryResponse(path=body.path)
        return ExportTrajectoryResponse(text=trajectory_to_extxyz(body.trajectory))
    except (FormatError, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
