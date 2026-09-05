"""Backend plugin discovery: schemas, presets, executables."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status

from atomscope.api.state import AppState
from atomscope.backends.base import BackendCapabilities, ExecutableReport
from atomscope.model.common import StrictModel
from atomscope.schemas import ParameterSchema, Preset

router = APIRouter(prefix="/api/backends", tags=["backends"])


class BackendInfo(StrictModel):
    id: str
    name: str
    capabilities: BackendCapabilities
    executables: ExecutableReport


def _state(request: Request) -> AppState:
    state: AppState = request.app.state.atomscope
    return state


@router.get("", response_model=list[BackendInfo])
def list_backends(request: Request) -> list[BackendInfo]:
    return [
        BackendInfo(
            id=p.id, name=p.name, capabilities=p.capabilities, executables=p.discover_executables()
        )
        for p in _state(request).registry.all()
    ]


@router.get("/{backend_id}/schema", response_model=ParameterSchema)
def backend_schema(backend_id: str, request: Request) -> ParameterSchema:
    try:
        return _state(request).registry.get(backend_id).schema()
    except KeyError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc


@router.get("/{backend_id}/presets", response_model=list[Preset])
def backend_presets(backend_id: str, request: Request) -> list[Preset]:
    try:
        return _state(request).registry.get(backend_id).presets()
    except KeyError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
