"""Application state: the currently open project. One project per backend process."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from fastapi import HTTPException, status

from atomscope.backends.registry import BackendRegistry, default_registry
from atomscope.calculations import CalculationService
from atomscope.jobs import JobManager
from atomscope.project import ProjectStore


class AppState:
    def __init__(
        self, data_dir: Path | None = None, registry: BackendRegistry | None = None
    ) -> None:
        self.project: ProjectStore | None = None
        self.calculations: CalculationService | None = None
        self.registry = registry or default_registry()
        self.jobs = JobManager(max_parallel=1)
        env_dir = os.environ.get("ATOMSCOPE_DATA_DIR")
        # an explicit directory wins over the environment, and both over a temporary one. Written
        # as one expression this read `(data_dir or Path(env_dir)) if env_dir else tempdir`, which
        # threw away the argument whenever the variable was unset.
        if data_dir is not None:
            self.data_dir = data_dir
        elif env_dir:
            self.data_dir = Path(env_dir)
        else:
            self.data_dir = Path(tempfile.gettempdir())

    def scratch_dir(self) -> Path:
        """Directory for transient uploads; inside the data dir, never the project."""
        d = (self.data_dir / "scratch").resolve()
        d.mkdir(parents=True, exist_ok=True)
        return d

    def set_project(self, project: ProjectStore | None) -> None:
        if self.calculations is not None:
            self.calculations.close()
        self.project = project
        self.calculations = (
            CalculationService(project, self.registry, self.jobs) if project is not None else None
        )

    def require_calculations(self) -> CalculationService:
        if self.calculations is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "no project is open")
        return self.calculations

    def require_project(self) -> ProjectStore:
        if self.project is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "no project is open")
        return self.project
