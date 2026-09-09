"""FastAPI application factory."""

from __future__ import annotations

from importlib.metadata import version as pkg_version
from pathlib import Path

import ase
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from atomscope.api import (
    routes_analysis,
    routes_backends,
    routes_build,
    routes_calculations,
    routes_chem,
    routes_cppaw,
    routes_crystal,
    routes_database,
    routes_grids,
    routes_io,
    routes_project,
    routes_scripts,
    routes_structures,
    routes_sweeps,
    routes_trajectory,
    routes_wavefunction,
)
from atomscope.api.schemas import HealthResponse
from atomscope.api.state import AppState

DEV_ORIGINS = ["http://127.0.0.1:5173", "http://localhost:5173"]


def create_app(data_dir: Path | None = None) -> FastAPI:
    """The API. `data_dir` overrides `ATOMSCOPE_DATA_DIR`, which is what a test wants."""
    app = FastAPI(title="Atomscope API", version=pkg_version("atomscope"))
    app.state.atomscope = AppState(data_dir)
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
    app.include_router(routes_crystal.router)
    app.include_router(routes_backends.router)
    app.include_router(routes_calculations.router)
    app.include_router(routes_grids.router)
    app.include_router(routes_cppaw.router)
    app.include_router(routes_sweeps.router)
    app.include_router(routes_scripts.router)
    app.include_router(routes_database.router)
    app.include_router(routes_trajectory.calc_router)
    app.include_router(routes_trajectory.io_router)
    app.include_router(routes_chem.router)
    app.include_router(routes_build.router)
    app.include_router(routes_wavefunction.router)
    app.include_router(routes_analysis.router)
    app.include_router(routes_analysis.io_router)
    return app
