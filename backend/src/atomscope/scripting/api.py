"""What a user script sees.

A script is an ordinary Python module run in its own process by
:mod:`atomscope.scripting.runner`, with the whole of the project's Python environment available
to it: ASE, numpy, scipy and Atomscope itself. What this module adds is the connection back to
the application -- the structure that was selected when Run was pressed, the other structures of
the project, and the two ways of handing something back::

    from atomscope.scripting import save, value

    atoms.rattle(0.05)          # `atoms` is predefined: the selected structure
    save(atoms, name='rattled')  # becomes a new structure in the project
    value('energy', atoms.get_potential_energy())

Nothing here reads a file at import time. The runner installs the run's context first; calling
:func:`save` or :func:`load` outside a run raises :class:`ScriptApiError` instead of quietly
reading whatever the current directory happens to hold. That is what lets the server import this
module (through the service) without touching a run directory of its own.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from ase import Atoms

from atomscope.ase_bridge.convert import INFO_KEY, from_atoms, to_atoms
from atomscope.model.structure import Structure

#: The same shape the project store accepts, so a script cannot reach out of `structures/`.
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class ScriptApiError(Exception):
    """Raised for anything the script itself got wrong: a bad id, use outside a run."""


@dataclass
class RunContext:
    """Where the run's files are and what it has produced so far."""

    run_dir: Path
    project_root: Path
    structure_id: str | None = None
    structures: list[Structure] = field(default_factory=list)
    values: dict[str, object] = field(default_factory=dict)


_context: RunContext | None = None


def set_context(context: RunContext | None) -> None:
    """Install the run's context. Called by the runner, not by a script."""
    global _context  # noqa: PLW0603
    _context = context


def context() -> RunContext:
    if _context is None:
        msg = "this function only works inside a script run started by Atomscope"
        raise ScriptApiError(msg)
    return _context


def _structure_path(structure_id: str) -> Path:
    if not _ID_RE.match(structure_id):
        msg = f"{structure_id!r} is not a structure id"
        raise ScriptApiError(msg)
    return context().project_root / "structures" / f"{structure_id}.json"


def _read(path: Path) -> Structure:
    if not path.is_file():
        msg = f"no structure at {path.name}"
        raise ScriptApiError(msg)
    return Structure.model_validate_json(path.read_text(encoding="utf-8"))


def input_atoms() -> Atoms:
    """The structure that was selected when the script was run, as an :class:`ase.Atoms`.

    The same object the runner predefines as ``atoms``; this is for a script that would rather
    ask for it explicitly, or that wants a second, unmodified copy.
    """
    ctx = context()
    if ctx.structure_id is None:
        msg = "this run has no input structure"
        raise ScriptApiError(msg)
    return to_atoms(_read(ctx.run_dir / "input" / "structure.json"))


def load(structure_id: str) -> Atoms:
    """Another structure of the open project, by id (see :func:`list_structures`)."""
    return to_atoms(_read(_structure_path(structure_id)))


def list_structures() -> list[dict[str, str]]:
    """``[{'id': ..., 'name': ...}]`` for every structure of the open project."""
    root = context().project_root
    manifest = json.loads((root / "project.json").read_text(encoding="utf-8"))
    out: list[dict[str, str]] = []
    for structure_id in manifest.get("structure_ids", []):
        path = root / "structures" / f"{structure_id}.json"
        if path.is_file():
            out.append({"id": structure_id, "name": _read(path).name})
    return out


def save(atoms: Atoms, *, name: str | None = None) -> str:
    """Hand a structure back to the application; returns the id it will have.

    Always a *new* structure. `to_atoms`/`from_atoms` are lossless, which means an `Atoms` that
    came from :func:`input_atoms` still carries the source structure's id in
    ``atoms.info['atomscope']`` -- saving that unchanged would overwrite the structure the script
    was run on. The id is dropped here (on a copy of ``info``, so the script's own object is not
    touched) and a fresh one is generated. The per-atom uids are kept, so an output can still be
    matched atom for atom against its input.
    """
    if not isinstance(atoms, Atoms):
        msg = f"save() takes an ase.Atoms, not {type(atoms).__name__}"
        raise ScriptApiError(msg)
    ctx = context()
    copy = atoms.copy()  # type: ignore[no-untyped-call]
    copy.info = dict(atoms.info)
    extra = dict(copy.info.get(INFO_KEY) or {})
    extra.pop("id", None)
    if name is not None:
        extra["name"] = name
    copy.info[INFO_KEY] = extra
    structure = from_atoms(copy, name=name)
    ctx.structures.append(structure)
    return structure.id


def jsonable(value: Any) -> Any:  # noqa: ANN401
    """Coerce numpy scalars and arrays into something `json` can write.

    A thermochemistry or an ASE calculator result is a `numpy.float64`, which `json.dumps`
    refuses, so the first value most scripts emit would fail without this.
    """
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, (str, bool, int, float)) or value is None:
        return value
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [jsonable(v) for v in value]
    return str(value)


def value(key: str, item: Any) -> None:  # noqa: ANN401
    """Record a named result for the Scripts panel to show. Numbers, strings, lists, dicts."""
    context().values[str(key)] = jsonable(item)
