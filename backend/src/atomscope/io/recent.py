"""
The files that were opened recently (Avogadro's File ▸ Open Recent, and Clear Recent).

This is the one piece of state that belongs to the *application* rather than to a project: it has
to survive opening a different project, so it is a small JSON file in the data directory rather
than an entry in a project manifest. Nothing else is kept there yet.

Only files opened by path are recorded. A file uploaded through the browser has no path on this
machine to go back to, and a fetched structure has no file at all.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import Field

from atomscope.model import StrictModel

MAX_RECENT = 10
SETTINGS_NAME = "settings.json"


class RecentFile(StrictModel):
    path: str = Field(description="absolute path, as it was opened")
    name: str = Field(description="the file name alone, for the menu")
    exists: bool = Field(description="whether it is still there; a moved file is kept, not hidden")


def _settings_path(data_dir: Path) -> Path:
    return data_dir / SETTINGS_NAME


def _read(data_dir: Path) -> dict[str, object]:
    try:
        loaded = json.loads(_settings_path(data_dir).read_text())
    except (OSError, ValueError):
        # missing, unreadable or corrupt: an empty list of recent files, not an error on startup
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _write(data_dir: Path, settings: dict[str, object]) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)
    _settings_path(data_dir).write_text(json.dumps(settings, indent=2) + "\n")


def _paths(data_dir: Path) -> list[str]:
    stored = _read(data_dir).get("recent_files")
    if not isinstance(stored, list):
        return []
    return [p for p in stored if isinstance(p, str)][:MAX_RECENT]


def recent_files(data_dir: Path) -> list[RecentFile]:
    """The list, most recently opened first."""
    return [
        RecentFile(path=p, name=Path(p).name, exists=Path(p).is_file()) for p in _paths(data_dir)
    ]


def record_recent(data_dir: Path, path: Path) -> list[RecentFile]:
    """
    Put `path` at the top of the list, once, and drop the oldest beyond `MAX_RECENT`.

    Best effort: a data directory that cannot be written to (read-only, full, or owned by
    somebody else) must not turn a file that opened perfectly well into a failed open.
    """
    resolved = str(path.resolve())
    kept = [p for p in _paths(data_dir) if p != resolved]
    settings = _read(data_dir)
    settings["recent_files"] = [resolved, *kept][:MAX_RECENT]
    try:
        _write(data_dir, settings)
    except OSError:
        pass
    return recent_files(data_dir)


def clear_recent(data_dir: Path) -> None:
    settings = _read(data_dir)
    settings["recent_files"] = []
    _write(data_dir, settings)
