"""Structure CRUD within the open project."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status

from atomscope.api.schemas import StructureSummary
from atomscope.api.state import AppState
from atomscope.model import Structure
from atomscope.project.store import ProjectError

router = APIRouter(prefix="/api/structures", tags=["structures"])


def _store(request: Request) -> AppState:
    state: AppState = request.app.state.atomscope
    return state


def summarize(s: Structure) -> StructureSummary:
    return StructureSummary(
        id=s.id, name=s.name, formula=s.formula(), n_atoms=s.n_atoms, periodic=s.is_periodic()
    )


@router.get("", response_model=list[StructureSummary])
def list_structures(request: Request) -> list[StructureSummary]:
    store = _store(request).require_project()
    return [summarize(s) for s in store.list_structures()]


@router.get("/{structure_id}", response_model=Structure)
def get_structure(structure_id: str, request: Request) -> Structure:
    store = _store(request).require_project()
    try:
        return store.load_structure(structure_id)
    except ProjectError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc


@router.put("/{structure_id}", response_model=StructureSummary)
def put_structure(structure_id: str, body: Structure, request: Request) -> StructureSummary:
    """Create or replace a structure. The path id must match the body id."""
    store = _store(request).require_project()
    if body.id != structure_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "structure id mismatch")
    try:
        store.save_structure(body)
    except ProjectError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return summarize(body)


@router.delete("/{structure_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_structure(structure_id: str, request: Request) -> None:
    store = _store(request).require_project()
    try:
        store.delete_structure(structure_id)
    except ProjectError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
