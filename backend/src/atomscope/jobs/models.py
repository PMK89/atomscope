"""Job records and run specifications (persisted as JSON next to the job's work directory)."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import Field

from atomscope.model.common import StrictModel
from atomscope.model.structure import new_uid

JobStatus = Literal["queued", "running", "completed", "failed", "cancelled"]


class RunSpec(StrictModel):
    """Everything needed to start a process. Built by backend plugins, executed by JobManager."""

    argv: list[str] = Field(min_length=1, description="argv[0] is an absolute executable path")
    cwd: Path
    env: dict[str, str] = Field(default_factory=dict, description="added to a minimal base env")
    stdout_name: str = "stdout.log"
    stderr_name: str = "stderr.log"
    watch_files: list[str] = Field(
        default_factory=list, description="files (relative to cwd) whose growth is streamed"
    )
    description: str = ""
    soft_stop_seconds: float = Field(
        default=5.0,
        description=(
            "seconds given to the process itself (SIGTERM to its PID) before the whole "
            "process group is signalled"
        ),
    )


class JobRecord(StrictModel):
    id: str = Field(default_factory=new_uid)
    spec: RunSpec
    status: JobStatus = "queued"
    pid: int | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(tz=UTC))
    started_at: datetime | None = None
    finished_at: datetime | None = None
    exit_code: int | None = None
    error: str | None = None
    calculation_id: str | None = None

    @property
    def elapsed_seconds(self) -> float | None:
        if self.started_at is None:
            return None
        end = self.finished_at or datetime.now(tz=UTC)
        return (end - self.started_at).total_seconds()

    @property
    def is_active(self) -> bool:
        return self.status in ("queued", "running")


class LogEvent(StrictModel):
    """One streamed line from a job's stdout/stderr or a watched file."""

    job_id: str
    stream: str = Field(description="'stdout', 'stderr' or the watched file name")
    line: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(tz=UTC))


class StatusEvent(StrictModel):
    job_id: str
    status: JobStatus
    exit_code: int | None = None
    error: str | None = None
