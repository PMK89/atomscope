"""Application state: the currently open project. One project per backend process."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from fastapi import HTTPException, status

from atomscope.project import ProjectStore


class AppState:
    def __init__(self, data_dir: Path | None = None) -> None:
        self.project: ProjectStore | None = None
        env_dir = os.environ.get("ATOMSCOPE_DATA_DIR")
        self.data_dir = data_dir or Path(env_dir) if env_dir else Path(tempfile.gettempdir())

    def scratch_dir(self) -> Path:
        """Directory for transient uploads; inside the data dir, never the project."""
        d = (self.data_dir / "scratch").resolve()
        d.mkdir(parents=True, exist_ok=True)
        return d

    def require_project(self) -> ProjectStore:
        if self.project is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "no project is open")
        return self.project
