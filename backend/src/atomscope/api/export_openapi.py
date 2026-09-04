"""Write the OpenAPI document (source of truth for frontend types). Usage: -m ... <out.json>."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from atomscope.api.app import create_app


def main(argv: list[str]) -> None:
    out = Path(argv[1])
    spec = create_app().openapi()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(spec, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv)
