"""Application state: the currently open project. One project per backend process."""

from __future__ import annotations

from fastapi import HTTPException, status

from atomscope.project import ProjectStore


class AppState:
    def __init__(self) -> None:
        self.project: ProjectStore | None = None

    def require_project(self) -> ProjectStore:
        if self.project is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "no project is open")
        return self.project
