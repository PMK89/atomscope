"""FastAPI application factory."""

from __future__ import annotations

from importlib.metadata import version as pkg_version

import ase
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from atomscope.api import (
    routes_backends,
    routes_calculations,
    routes_grids,
    routes_io,
    routes_project,
    routes_structures,
)
from atomscope.api.schemas import HealthResponse
from atomscope.api.state import AppState

DEV_ORIGINS = ["http://127.0.0.1:5173", "http://localhost:5173"]


def create_app() -> FastAPI:
    app = FastAPI(title="Atomscope API", version=pkg_version("atomscope"))
    app.state.atomscope = AppState()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=DEV_ORIGINS,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health", response_model=HealthResponse, tags=["system"])
    def health() -> HealthResponse:
        return HealthResponse(version=pkg_version("atomscope"), ase_version=ase.__version__)

    app.include_router(routes_project.router)
    app.include_router(routes_structures.router)
    app.include_router(routes_io.router)
    app.include_router(routes_backends.router)
    app.include_router(routes_calculations.router)
    app.include_router(routes_grids.router)
    return app
