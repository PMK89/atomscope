"""The project's ASE database: select finished calculations by chemistry and by parameter.

The selection string is ASE's own -- ``'Fe'``, ``'Fe,O'``, ``'natoms<4'``, ``'energy<-500'``,
``'epwpsi=30'``, and combinations separated by commas. It is passed to ``ase.db`` untouched:
that syntax is what the historical CP-PAW/ASE workflow already uses, and a query language of our
own would only be a worse version of it.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import Field

from atomscope.api.state import AppState
from atomscope.model.common import StrictModel
from atomscope.project.database import DB_NAME, ProjectDatabase

router = APIRouter(prefix="/api/database", tags=["database"])


class DatabaseRow(StrictModel):
    """One indexed calculation, as much of it as a results table needs."""

    id: int = Field(description="ASE row id")
    calculation_id: str | None
    name: str | None
    formula: str
    natoms: int
    energy: float | None = Field(default=None, description="eV")
    charge: float | None = None
    magmom: float | None = None
    backend: str | None = None
    status: str | None = None
    keys: dict[str, Any] = Field(
        default_factory=dict, description="the row's key-value pairs, minus the ones above"
    )


class DatabaseSelection(StrictModel):
    rows: list[DatabaseRow]
    total: int = Field(description="rows in the database, before the selection")
    selection: str | None = Field(default=None, description="what was asked for, as given")


class ReindexResult(StrictModel):
    indexed: int
    problems: list[str] = Field(
        default_factory=list, description="calculations that could not be indexed, and why"
    )


ABOVE = frozenset(
    {
        "id",
        "calculation_id",
        "name",
        "formula",
        "natoms",
        "energy",
        "charge",
        "magmom",
        "backend",
        "status",
    }
)


def _state(request: Request) -> AppState:
    state: AppState = request.app.state.atomscope
    return state


def _row(row: Any) -> DatabaseRow:
    kvp = dict(row.key_value_pairs)
    return DatabaseRow(
        id=int(row.id),
        calculation_id=kvp.pop("calculation_id", None),
        name=kvp.pop("name", None),
        formula=row.formula,
        natoms=int(row.natoms),
        # a row written without a calculator has no energy at all, not a zero
        energy=float(row.energy) if "energy" in row else None,
        charge=float(row.charge) if row.charge else None,
        magmom=float(row.magmom) if "magmom" in row else None,
        backend=kvp.pop("backend", None),
        status=kvp.pop("status", None),
        keys={k: v for k, v in kvp.items() if k not in ABOVE},
    )


@router.get("", response_model=DatabaseSelection)
def select(
    request: Request,
    selection: str | None = Query(
        default=None,
        description="ASE selection string, e.g. 'Fe', 'Fe,O', 'natoms<4', 'epwpsi=30'",
    ),
    limit: int = Query(default=200, ge=1, le=2000),
) -> DatabaseSelection:
    project = _state(request).require_project()
    db = ProjectDatabase(project.root)
    if not db.path.exists():
        return DatabaseSelection(rows=[], total=0, selection=selection)
    with db.connect() as connection:
        total = connection.count()
        try:
            rows = [_row(r) for r in connection.select(selection or "", limit=limit)]
        except (ValueError, KeyError, AssertionError) as exc:
            # ASE raises on a malformed selection; that is the user's typo, not a server fault
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{selection!r} is not a selection ase.db understands: {exc}",
            ) from exc
    return DatabaseSelection(rows=rows, total=total, selection=selection)


@router.post("/reindex", response_model=ReindexResult)
def reindex(request: Request) -> ReindexResult:
    """Rebuild the database from the project's calculation directories.

    The directories are the source of truth, so this is always safe: it is how a project made
    before the database existed gets one, and how a database that has drifted is repaired.
    """
    svc = _state(request).require_calculations()
    indexed, problems = svc.reindex()
    return ReindexResult(indexed=indexed, problems=problems)


@router.get("/path")
def database_path(request: Request) -> dict[str, str | bool]:
    """Where the file is, so it can be opened with `ase db` or `ase gui` directly."""
    project = _state(request).require_project()
    db = ProjectDatabase(project.root)
    return {"path": str(db.path), "exists": db.path.exists(), "name": DB_NAME}
