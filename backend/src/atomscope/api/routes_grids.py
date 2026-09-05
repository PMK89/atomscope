"""Volumetric grids of the open project: metadata, raw float32 data and statistics."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response, status

from atomscope.api.state import AppState
from atomscope.calculations.grids import (
    GridRef,
    GridStats,
    compute_stats,
    find_grid,
    list_grids,
    load_values,
)
from atomscope.model import VolumetricGrid

router = APIRouter(prefix="/api/grids", tags=["grids"])


def _state(request: Request) -> AppState:
    state: AppState = request.app.state.atomscope
    return state


def _lookup(request: Request, grid_id: str) -> GridRef:
    state = _state(request)
    ref = find_grid(state.require_project(), state.require_calculations().list(), grid_id)
    if ref is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"grid {grid_id} not found")
    return ref


@router.get("", response_model=list[GridRef])
def list_all(request: Request) -> list[GridRef]:
    state = _state(request)
    return list_grids(state.require_project(), state.require_calculations().list())


@router.get("/{grid_id}", response_model=VolumetricGrid)
def get_grid(grid_id: str, request: Request) -> VolumetricGrid:
    return _lookup(request, grid_id).grid


@router.get(
    "/{grid_id}/data",
    response_class=Response,
    responses={200: {"content": {"application/octet-stream": {}}}},
)
def get_grid_data(grid_id: str, request: Request) -> Response:
    """Raw little-endian float32 values in C order (shape in the X-Grid-Shape header)."""
    grid = _lookup(request, grid_id).grid
    try:
        values = load_values(_state(request).require_project(), grid)
    except (OSError, ValueError) as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(exc)) from exc
    return Response(
        content=values.astype("<f4").tobytes(order="C"),
        media_type="application/octet-stream",
        headers={
            "X-Grid-Shape": ",".join(str(n) for n in grid.shape),
            "X-Grid-Dtype": "float32",
        },
    )


@router.get("/{grid_id}/stats", response_model=GridStats)
def get_grid_stats(grid_id: str, request: Request) -> GridStats:
    grid = _lookup(request, grid_id).grid
    try:
        values = load_values(_state(request).require_project(), grid)
    except (OSError, ValueError) as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(exc)) from exc
    return compute_stats(values, grid.kind)
