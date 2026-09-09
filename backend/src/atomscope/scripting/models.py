"""Records for the scripting subsystem: a script, a run of one, and what a run produced."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import Field

from atomscope.jobs.models import JobStatus
from atomscope.model.common import StrictModel
from atomscope.model.structure import Structure, new_uid


class Script(StrictModel):
    """A Python file in the project's ``scripts/`` directory."""

    id: str = Field(description="file stem, which is also the id")
    source: str


class ScriptError(StrictModel):
    """What the script raised, as the runner saw it."""

    type: str
    message: str
    traceback: str


class ScriptResult(StrictModel):
    """The runner's ``result.json``: the structures the script saved and the values it emitted."""

    structures: list[Structure] = Field(default_factory=list)
    values: dict[str, object] = Field(default_factory=dict)


class ScriptRun(StrictModel):
    """One execution of a script, persisted as ``run.json`` in the run's own directory.

    ``structure_ids`` are filled in once the run has finished and its outputs have been imported
    into the project; ``imported`` is what stops that happening twice.
    """

    id: str = Field(default_factory=new_uid)
    script_id: str
    structure_id: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(tz=UTC))
    status: JobStatus = "queued"
    job_id: str | None = None
    structure_ids: list[str] = Field(default_factory=list)
    values: dict[str, object] = Field(default_factory=dict)
    error: ScriptError | None = None
    imported: bool = False


StreamName = Literal["stdout", "stderr"]
