"""Child process that runs one user script: ``python -m atomscope.scripting.runner script.py``.

Started by :class:`atomscope.scripting.service.ScriptService` through the job manager, so it
inherits that machinery's properties: an argv array with no shell, a validated absolute
interpreter, an explicit minimal environment, its own session so a runaway script can be
signalled as a group, and stdout/stderr streamed to files the panel reads.

The script runs with the privileges of whoever started Atomscope. This is not a sandbox -- see
docs/architecture/security-model.md.
"""

from __future__ import annotations

import json
import runpy
import sys
import traceback
from pathlib import Path

from atomscope.ase_bridge.convert import to_atoms
from atomscope.model.structure import Structure
from atomscope.scripting.api import RunContext, set_context
from atomscope.scripting.models import ScriptError, ScriptResult

RESULT_NAME = "result.json"
ERROR_NAME = "error.json"
CONTEXT_NAME = "context.json"


def _write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


def run(script: Path, run_dir: Path) -> int:
    """Run ``script`` and write ``result.json``, plus ``error.json`` if it raised."""
    settings = json.loads((run_dir / CONTEXT_NAME).read_text(encoding="utf-8"))
    context = RunContext(
        run_dir=run_dir,
        project_root=Path(settings["project_root"]),
        structure_id=settings.get("structure_id"),
    )
    set_context(context)

    atoms = None
    input_path = run_dir / "input" / "structure.json"
    if input_path.is_file():
        atoms = to_atoms(Structure.model_validate_json(input_path.read_text(encoding="utf-8")))

    status = 0
    try:
        # `runpy` gives the script a real ``__main__`` module, so ``if __name__ == '__main__':``
        # works in it as it does in a file run from a shell. `atoms` is predefined rather than
        # imported, which is how Avogadro's Python extensions receive their molecule.
        runpy.run_path(str(script), run_name="__main__", init_globals={"atoms": atoms})
    except BaseException as exc:  # noqa: BLE001 - a script may raise anything, including SystemExit
        if isinstance(exc, SystemExit) and not exc.code:
            pass
        else:
            text = "".join(traceback.format_exception(exc))
            # stderr is what the panel shows first, so the traceback goes there verbatim
            sys.stderr.write(text)
            _write(
                run_dir / ERROR_NAME,
                ScriptError(
                    type=type(exc).__name__, message=str(exc), traceback=text
                ).model_dump_json(indent=2),
            )
            status = 1
    finally:
        # written even on failure: a script that saved two structures and then raised keeps them
        result = ScriptResult(structures=context.structures, values=context.values)
        _write(run_dir / RESULT_NAME, result.model_dump_json(indent=2))
        set_context(None)
    return status


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        sys.stderr.write("usage: python -m atomscope.scripting.runner <script.py>\n")
        return 2
    script = Path(args[0])
    if not script.is_file():
        sys.stderr.write(f"no script at {script}\n")
        return 2
    return run(script, Path.cwd())


if __name__ == "__main__":
    raise SystemExit(main())
