"""Run the development server: ``python -m atomscope.api.server``. Loopback only by design."""

from __future__ import annotations

import argparse

import uvicorn

from atomscope.api.app import create_app


def main() -> None:
    parser = argparse.ArgumentParser(description="Atomscope backend server")
    parser.add_argument("--host", default="127.0.0.1", choices=["127.0.0.1", "localhost"])
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    uvicorn.run(create_app(), host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
