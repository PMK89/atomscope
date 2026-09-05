from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import Field

from atomscope.backends.base import GeneratedInputs, Resources, ResultBundle
from atomscope.jobs.models import JobRecord
from atomscope.model.common import Provenance, StrictModel
from atomscope.model.structure import new_uid

CalculationStatus = Literal[
    "draft", "ready", "queued", "running", "completed", "failed", "cancelled"
]


class Calculation(StrictModel):
    """Persisted as ``calculations/<id>/calculation.json`` inside the project."""

    id: str = Field(default_factory=new_uid)
    name: str
    backend_id: str
    schema_version: int = 1
    structure_id: str = Field(description="input structure (a copy is stored with the calculation)")
    values: dict[str, object] = Field(
        default_factory=dict, description="full merged parameter values"
    )
    resources: Resources = Field(default_factory=Resources)
    status: CalculationStatus = "draft"
    created_at: datetime = Field(default_factory=lambda: datetime.now(tz=UTC))
    generated: GeneratedInputs | None = None
    job: JobRecord | None = None
    results: ResultBundle | None = None
    result_structure_id: str | None = None
    parent_calculation_id: str | None = Field(default=None, description="for reruns/restarts")
    notes: str = ""
    provenance: Provenance | None = None
