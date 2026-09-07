"""Project lifecycle routes."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import Field

from atomscope.api.schemas import CreateProjectRequest, OpenProjectRequest, ProjectInfo
from atomscope.api.state import AppState
from atomscope.model.common import StrictModel
from atomscope.project import ProjectStore
from atomscope.project.export import BY_KEY, DEFAULT_EXCLUDED, EXCLUSIONS, export_project
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


class ExportProjectRequest(StrictModel):
    """Where to put the copy, and what to leave out of it."""

    path: Path
    exclude: list[str] | None = Field(
        default=None,
        description="exclusion keys (see GET /api/project/export/options); the default leaves out"
        " restart files and setup reports",
    )


class SkippedCategory(StrictModel):
    key: str
    files: int
    bytes: int
    reason: str


class ExportResult(StrictModel):
    path: Path
    files: int
    bytes_copied: int
    skipped: list[SkippedCategory]

    @property
    def bytes_skipped(self) -> int:
        return sum(s.bytes for s in self.skipped)


class ExclusionOption(StrictModel):
    key: str
    patterns: list[str]
    reason: str
    default: bool = Field(description="whether it is left out unless asked for")


@router.get("/export/options", response_model=list[ExclusionOption])
def export_options() -> list[ExclusionOption]:
    """What an export can leave out, and why each one is safe to leave out."""
    return [
        ExclusionOption(
            key=e.key,
            patterns=list(e.patterns),
            reason=e.reason,
            default=e.key in DEFAULT_EXCLUDED,
        )
        for e in EXCLUSIONS
    ]


@router.post("/export", response_model=ExportResult)
def export_current_project(body: ExportProjectRequest, request: Request) -> ExportResult:
    """Copy the open project somewhere else, without the files that are big and reproducible.

    The copy is a project directory: open it like any other. What it cannot do is continue a run
    or extract a new orbital, both of which read the restart file -- `EXPORT.md` in the copy says
    so, with the numbers.
    """
    store = _state(request).require_project()
    try:
        report = export_project(
            store, body.path, exclude=None if body.exclude is None else frozenset(body.exclude)
        )
    except (ValueError, OSError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return ExportResult(
        path=report.destination,
        files=report.files,
        bytes_copied=report.bytes_copied,
        skipped=[
            SkippedCategory(key=key, files=files, bytes=size, reason=BY_KEY[key].reason)
            for key, (files, size) in sorted(report.skipped.items())
        ],
    )
