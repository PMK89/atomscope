"""Import/export of structures through the file-format registry."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, UploadFile, status
from pydantic import Field

from atomscope.api.state import AppState
from atomscope.calculations.grids import import_cube
from atomscope.io import formats, read_structure, write_structure
from atomscope.io.rdkit_io import from_smiles
from atomscope.io.registry import FormatError, structure_to_string
from atomscope.model import Structure, VolumetricGrid
from atomscope.model.common import StrictModel
from atomscope.model.grid import GridKind

router = APIRouter(prefix="/api/io", tags=["io"])


class FormatDescription(StrictModel):
    name: str
    extensions: list[str]
    description: str
    can_read: bool
    can_write: bool
    library: str


class ImportPathRequest(StrictModel):
    path: Path
    format: str | None = None


class ImportCubeRequest(StrictModel):
    path: Path
    kind: GridKind = "other"


class ImportCubeResponse(StrictModel):
    grid: VolumetricGrid
    structure: Structure


class SmilesRequest(StrictModel):
    smiles: str
    add_hydrogens: bool = True


class ExportRequest(StrictModel):
    structure: Structure
    format: str
    path: Path | None = Field(default=None, description="write here if given, else return text")


class ExportResponse(StrictModel):
    text: str | None = None
    path: Path | None = None


def _state(request: Request) -> AppState:
    state: AppState = request.app.state.atomscope
    return state


@router.get("/formats", response_model=list[FormatDescription])
def list_formats() -> list[FormatDescription]:
    return [
        FormatDescription(
            name=f.name,
            extensions=list(f.extensions),
            description=f.description,
            can_read=f.can_read,
            can_write=f.can_write,
            library=f.library,
        )
        for f in formats()
    ]


@router.post("/import/path", response_model=Structure)
def import_path(body: ImportPathRequest) -> Structure:
    """Read a structure from a file on this machine (the backend is local-only)."""
    if not body.path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{body.path} not found")
    try:
        return read_structure(body.path, body.format)
    except (FormatError, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.post("/import/upload", response_model=Structure)
async def import_upload(file: UploadFile, request: Request) -> Structure:
    """Read a structure from an uploaded file (browser file picker)."""
    state = _state(request)
    name = Path(file.filename or "upload.xyz").name
    tmp_dir = state.scratch_dir()
    target = tmp_dir / name
    target.write_bytes(await file.read())
    try:
        return read_structure(target)
    except (FormatError, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    finally:
        target.unlink(missing_ok=True)


@router.post("/import/cube", response_model=ImportCubeResponse)
def import_cube_file(body: ImportCubeRequest, request: Request) -> ImportCubeResponse:
    """Import a Gaussian cube file (optionally gzipped) into the open project as a dataset."""
    project = _state(request).require_project()
    if not body.path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{body.path} not found")
    try:
        grid, structure = import_cube(project, body.path, kind=body.kind)
    except (ValueError, OSError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return ImportCubeResponse(grid=grid, structure=structure)


@router.post("/smiles", response_model=Structure)
def build_from_smiles(body: SmilesRequest) -> Structure:
    try:
        return from_smiles(body.smiles, add_hydrogens=body.add_hydrogens)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.post("/export", response_model=ExportResponse)
def export_structure(body: ExportRequest) -> ExportResponse:
    try:
        if body.path is not None:
            write_structure(body.structure, body.path, body.format)
            return ExportResponse(path=body.path)
        return ExportResponse(text=structure_to_string(body.structure, body.format))
    except (FormatError, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
