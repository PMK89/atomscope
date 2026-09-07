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


class AnalysisJob(StrictModel):
    """A post-processing job (DOS, band structure, orbital export) run in the work directory of
    a completed calculation; outputs are read back through the backend plugin."""

    kind: str
    options: dict[str, object] = Field(default_factory=dict)
    job: JobRecord


class SweepMembership(StrictModel):
    """This calculation is one point of a sweep: several runs that differ in one way.

    A convergence test, an energy-against-volume curve, a scan -- the tutorial's whole chapter 8
    is this shape. Membership is recorded on the member rather than in an object of its own, so
    the sweep is a view over the calculations a project already holds: everything with this
    ``sweep_id``, in order of ``x``.

    What varies is either one schema value (``key``) or the structure itself (``key`` is None) --
    a cell-size or volume sweep changes the lattice, which no schema value can express. Either
    way ``x`` is the number the result is plotted against, and ``label``/``unit`` say what that
    number is, because for a structure sweep there is no parameter to ask.
    """

    sweep_id: str
    label: str = Field(description="axis label, e.g. 'Plane-wave cutoff'")
    unit: str | None = None
    key: str | None = Field(default=None, description="schema key varied; None = the structure")
    x: float
    index: int


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
    sweep: SweepMembership | None = Field(
        default=None, description="set when this calculation is one point of a sweep"
    )
    analysis_jobs: list[AnalysisJob] = Field(default_factory=list)
    notes: str = ""
    provenance: Provenance | None = None
