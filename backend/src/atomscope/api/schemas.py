"""Request/response models that are not part of the scientific data model itself."""

from __future__ import annotations

from pathlib import Path

from pydantic import Field

from atomscope.model.common import StrictModel
from atomscope.project.manifest import ProjectManifest


class HealthResponse(StrictModel):
    status: str = "ok"
    version: str
    ase_version: str


class OpenProjectRequest(StrictModel):
    path: Path = Field(description="absolute path of an existing project directory")


class CreateProjectRequest(StrictModel):
    path: Path = Field(description="absolute path of a new (empty or missing) directory")
    name: str


class ProjectInfo(StrictModel):
    path: Path
    manifest: ProjectManifest


class StructureSummary(StrictModel):
    id: str
    name: str
    formula: str
    n_atoms: int
    periodic: bool


class ErrorResponse(StrictModel):
    detail: str
