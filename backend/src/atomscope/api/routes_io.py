"""Import/export of structures through the file-format registry."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Form, HTTPException, Request, UploadFile, status
from pydantic import Field

from atomscope.api.state import AppState
from atomscope.calculations.grids import import_cube
from atomscope.chem.properties import identifiers
from atomscope.io import formats, read_structure, structure_from_string, write_structure
from atomscope.io.fetch import (
    FetchError,
    NotFoundError,
    UpstreamError,
    compound_name,
    fetch_structure,
)
from atomscope.io.images import FORMATS, ImageFormat, ImageOptions, write_image
from atomscope.io.poscar import MissingSpeciesError
from atomscope.io.qc_outputs import OutputImport, read_output
from atomscope.io.rdkit_io import from_smiles
from atomscope.io.recent import RecentFile, clear_recent, recent_files, record_recent
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


class ImportTextRequest(StrictModel):
    text: str = Field(max_length=20_000_000, description="file content, e.g. a clipboard paste")
    format: str | None = Field(default=None, description="format name; sniffed when omitted")
    species: list[str] | None = Field(
        default=None,
        description="element of each species of a VASP 4 POSCAR, which does not name them",
    )


class FetchRequest(StrictModel):
    source: Literal["pdb", "pubchem"] = Field(description="which database to ask")
    query: str = Field(
        max_length=200, description="a PDB id (1CRN) or a chemical name (caffeine); never a URL"
    )


class CompoundNameRequest(StrictModel):
    structure: Structure


class CompoundName(StrictModel):
    """What PubChem calls this compound, and the key it was asked about."""

    name: str
    inchikey: str
    source: str = "pubchem"


class ExportRequest(StrictModel):
    structure: Structure
    format: str
    path: Path | None = Field(default=None, description="write here if given, else return text")
    overwrite: bool = Field(
        default=False,
        description="allow writing over an existing file; without it an existing path is a 409",
    )


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
def import_path(body: ImportPathRequest, request: Request) -> Structure:
    """Read a structure from a file on this machine (the backend is local-only)."""
    if not body.path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{body.path} not found")
    try:
        structure = read_structure(body.path, body.format)
    except (FormatError, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    # recorded only once it read: a path that is not a structure is not worth going back to
    record_recent(_state(request).data_dir, body.path)
    return structure


@router.post("/import/upload", response_model=Structure)
async def import_upload(
    file: UploadFile,
    request: Request,
    format: Annotated[str | None, Form()] = None,
) -> Structure:
    """Read a structure from an uploaded file (browser file picker).

    ``format`` overrides the detection, which a file whose extension says nothing about its
    contents needs -- a Gaussian output called ``run.txt``, say.
    """
    state = _state(request)
    name = Path(file.filename or "upload.xyz").name
    tmp_dir = state.scratch_dir()
    target = tmp_dir / name
    target.write_bytes(await file.read())
    try:
        return read_structure(target, format or None)
    except (FormatError, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    finally:
        target.unlink(missing_ok=True)


@router.post("/import/text", response_model=Structure)
def import_text(body: ImportTextRequest) -> Structure:
    """Read a structure from text: a clipboard paste, or an editor buffer. No file involved."""
    try:
        return structure_from_string(body.text, body.format, species=body.species)
    except MissingSpeciesError as exc:
        # 422 rather than 400: the request is well formed, it is the *text* that is missing
        # something only the user can supply. The counts travel so the dialog can ask per species.
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            {"message": str(exc), "counts": exc.counts},
        ) from exc
    except (FormatError, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.get("/recent", response_model=list[RecentFile])
def get_recent(request: Request) -> list[RecentFile]:
    """The files opened by path recently, most recent first (Avogadro's Open Recent)."""
    return recent_files(_state(request).data_dir)


@router.delete("/recent", response_model=list[RecentFile])
def delete_recent(request: Request) -> list[RecentFile]:
    """Clear Recent."""
    clear_recent(_state(request).data_dir)
    return []


@router.post("/fetch", response_model=Structure)
def fetch(body: FetchRequest) -> Structure:
    """Download a structure from RCSB (by PDB id) or PubChem (by name).

    The query is an identifier, not a URL: it is validated and then placed in one path segment of
    a fixed address. Fetching an arbitrary URL is deliberately not offered.
    """
    try:
        return fetch_structure(body.source, body.query)
    except NotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{body.query}: {exc}") from exc
    except UpstreamError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    except (FetchError, FormatError, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.post("/compound-name", response_model=CompoundName)
def compound_name_lookup(body: CompoundNameRequest) -> CompoundName:
    """The IUPAC name PubChem has for the posted structure (Avogadro's Molecule Properties name).

    The InChIKey is computed here, locally, and only that goes to the database -- the structure
    itself is never sent. Nothing calls this on its own: it is a button in the Properties tab,
    because looking a molecule up tells someone else what is being worked on.
    """
    if not body.structure.atoms:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "structure has no atoms")
    try:
        key = identifiers(body.structure).inchikey
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    try:
        return CompoundName(name=compound_name(key), inchikey=key)
    except NotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{key}: {exc}") from exc
    except UpstreamError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    except FetchError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


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


@router.post("/import/output", response_model=OutputImport)
def import_output(body: ImportPathRequest) -> OutputImport:
    """Import a quantum-chemistry output file (Gaussian, ORCA, NWChem, QE): final structure with
    energy/forces/dipole/charges and the optimization trajectory."""
    if not body.path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{body.path} not found")
    try:
        return read_output(body.path, body.format)
    except (ValueError, OSError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.post("/smiles", response_model=Structure)
def build_from_smiles(body: SmilesRequest) -> Structure:
    try:
        return from_smiles(body.smiles, add_hydrogens=body.add_hydrogens)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


class ImageExportRequest(StrictModel):
    structure: Structure
    format: ImageFormat = Field(default="png")
    path: Path | None = Field(
        default=None, description="write here if given, else into the app's scratch directory"
    )
    overwrite: bool = Field(default=False, description="an existing path is otherwise a 409")
    options: ImageOptions = Field(default_factory=ImageOptions)


class ImageExportResponse(StrictModel):
    files: list[Path] = Field(description="everything written; pov produces an .ini as well")
    rendered: bool = Field(description="whether a raster image was produced")
    note: str | None = Field(default=None, description="why it was not rendered, when it was not")


@router.get("/image-formats", response_model=list[str])
def image_formats() -> list[str]:
    """Formats ``/api/io/export/image`` can write."""
    return list(FORMATS)


@router.post("/export/image", response_model=ImageExportResponse)
def export_image(body: ImageExportRequest, request: Request) -> ImageExportResponse:
    """Render a structure through ASE's own image writers.

    ``options`` are ASE's parameters at ASE's defaults, passed through unreinterpreted -- so the
    knob someone knows from ``ase.io.write`` is the knob they find here.

    ``pov`` is written but never rendered: POV-Ray is not installed on this machine, and ASE
    raises from inside the writer if asked to run it. The ``.pov`` and its ``.ini`` come back
    together, which is what rendering it elsewhere needs, and ``note`` says so.
    """
    target = body.path
    if target is None:
        target = (
            _state(request).scratch_dir() / f"{body.structure.name or 'structure'}.{body.format}"
        )
    elif target.is_dir():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{target} is a directory")
    elif target.exists() and not body.overwrite:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{target} exists")
    try:
        files = write_image(body.structure, target, body.format, body.options)
    except (OSError, ValueError, TypeError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    note = (
        "POV-Ray is not installed here, so the scene was written but not rendered; "
        "render it with `povray <name>.ini`"
        if body.format == "pov"
        else None
    )
    return ImageExportResponse(files=files, rendered=body.format in ("png", "eps"), note=note)


@router.post("/export", response_model=ExportResponse)
def export_structure(body: ExportRequest) -> ExportResponse:
    try:
        if body.path is not None:
            if body.path.is_dir():
                raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{body.path} is a directory")
            # a Save As that silently replaces someone's file is the one mistake worth a round trip
            if body.path.exists() and not body.overwrite:
                raise HTTPException(status.HTTP_409_CONFLICT, f"{body.path} exists")
            write_structure(body.structure, body.path, body.format)
            return ExportResponse(path=body.path)
        return ExportResponse(text=structure_to_string(body.structure, body.format))
    except (FormatError, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
