"""Command line entry point (``atomscope``)."""

from __future__ import annotations

import typer
import uvicorn

from atomscope.api.app import create_app

app = typer.Typer(help="Atomscope scientific backend")


@app.command()
def serve(port: int = 8765) -> None:
    """Start the local API server on 127.0.0.1."""
    uvicorn.run(create_app(), host="127.0.0.1", port=port, log_level="info")


def main() -> None:
    app()
