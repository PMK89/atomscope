"""Project lifecycle routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request, status

from atomscope.api.schemas import CreateProjectRequest, OpenProjectRequest, ProjectInfo
from atomscope.api.state import AppState
from atomscope.model.common import StrictModel
from atomscope.project import ProjectStore
from atomscope.project.store import ProjectError

router = APIRouter(prefix="/api/project", tags=["project"])


def _state(request: Request) -> AppState:
    state: AppState = request.app.state.atomscope
    return state


@router.get("", response_model=ProjectInfo | None)
def current_project(request: Request) -> ProjectInfo | None:
    store = _state(request).project
    if store is None:
        return None
    return ProjectInfo(path=store.root, manifest=store.manifest)


@router.post("/open", response_model=ProjectInfo)
def open_project(body: OpenProjectRequest, request: Request) -> ProjectInfo:
    try:
        store = ProjectStore.open(body.path)
    except ProjectError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    _state(request).set_project(store)
    return ProjectInfo(path=store.root, manifest=store.manifest)


@router.post("/create", response_model=ProjectInfo, status_code=status.HTTP_201_CREATED)
def create_project(body: CreateProjectRequest, request: Request) -> ProjectInfo:
    try:
        store = ProjectStore.create(body.path, body.name)
    except ProjectError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    _state(request).set_project(store)
    return ProjectInfo(path=store.root, manifest=store.manifest)


class ViewSettingsBody(StrictModel):
    settings: dict[str, Any]


@router.get("/view-settings", response_model=dict[str, Any])
def get_view_settings(request: Request) -> dict[str, Any]:
    return dict(_state(request).require_project().manifest.view_settings)


@router.put("/view-settings", response_model=dict[str, Any])
def put_view_settings(body: ViewSettingsBody, request: Request) -> dict[str, Any]:
    """Persist UI view settings (representation, background, layer toggles) with the project."""
    store = _state(request).require_project()
    store.manifest.view_settings = dict(body.settings)
    store.save_manifest()
    return dict(store.manifest.view_settings)


@router.post("/close", status_code=status.HTTP_204_NO_CONTENT)
def close_project(request: Request) -> None:
    _state(request).set_project(None)
