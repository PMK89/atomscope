"""Session-wide test configuration.

Temporary directories stay inside the project tree, but **not** under one fixed path.
`--basetemp` looked like the way to do that and is a trap: pytest deletes and recreates that
directory at the start of every session, so two sessions running at once destroy each other's
`tmp_path`. Running `make test` and `pytest -m cppaw` in two shells did exactly that -- the
second session wiped the tree while the first was still running CP-PAW against it, and the
CP-PAW tests failed with a `FileNotFoundError` on their own `tmp_path` and with runs whose work
directory had vanished.

`PYTEST_DEBUG_TEMPROOT` moves the *root* instead, and pytest then makes a numbered
`pytest-of-<user>/pytest-N` beneath it per session and garbage-collects the old ones. Concurrent
sessions get separate roots. It is set here rather than in `env.sh` or the Makefile so that a
bare `pytest`, an IDE run and `make test` all behave the same, and it is absolute, so it no
longer depends on running pytest from `backend/`.
"""

from __future__ import annotations

import os
from pathlib import Path

_SCRATCH = Path(__file__).resolve().parents[2] / ".scratch" / "pytest"
_SCRATCH.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("PYTEST_DEBUG_TEMPROOT", str(_SCRATCH))
