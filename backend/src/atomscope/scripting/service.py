"""Storing, running and collecting user Python scripts.

Scripts are plain ``.py`` files in the project's ``scripts/`` directory, so they can be edited in
Atomscope, in an editor, or committed alongside the project. Each run gets its own directory
under ``script-runs/`` holding the copy of the script that ran, the input structure, the job's
logs and whatever the script handed back -- the same "everything a run needs is in one directory"
shape the calculations use, which is what lets a run be read back after a restart.

Execution goes through :class:`atomscope.jobs.JobManager`: argv array, no shell, an absolute
interpreter that must be executable, an explicit working directory and environment, and
cancellation that reaches the whole process group. The script still runs with the user's own
privileges; nothing here is a sandbox (docs/architecture/security-model.md).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from atomscope.jobs import JobManager
from atomscope.jobs.models import JobRecord, JobStatus, RunSpec
from atomscope.project import ProjectStore
from atomscope.scripting.models import Script, ScriptError, ScriptResult, ScriptRun
from atomscope.scripting.runner import CONTEXT_NAME, ERROR_NAME, RESULT_NAME

SCRIPTS_DIR = "scripts"
RUNS_DIR = "script-runs"
SCRIPT_NAME = "script.py"
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

#: Examples shipped with Atomscope, offered in the panel as a starting point (Avogadro ships an
#: `example.py` in its script directory for the same reason).
EXAMPLES_DIR = Path(__file__).resolve().parents[4] / "examples" / "scripts"


class ScriptServiceError(Exception):
    pass


def _check_id(value: str) -> str:
    if not _ID_RE.match(value):
        msg = f"{value!r} is not a valid script id (letters, digits, - and _)"
        raise ScriptServiceError(msg)
    return value


class ScriptService:
    def __init__(self, project: ProjectStore, jobs: JobManager) -> None:
        self.project = project
        self.jobs = jobs

    # ---- storage --------------------------------------------------------------------------
    def _dir(self, *parts: str) -> Path:
        d = self.project.path_in_project(*parts)
        d.mkdir(parents=True, exist_ok=True)
        return d

    def script_path(self, script_id: str) -> Path:
        return self._dir(SCRIPTS_DIR) / f"{_check_id(script_id)}.py"

    def list_scripts(self) -> list[Script]:
        return [
            Script(id=p.stem, source=p.read_text(encoding="utf-8"))
            for p in sorted(self._dir(SCRIPTS_DIR).glob("*.py"))
        ]

    def get(self, script_id: str) -> Script:
        path = self.script_path(script_id)
        if not path.is_file():
            msg = f"script {script_id} not found"
            raise ScriptServiceError(msg)
        return Script(id=script_id, source=path.read_text(encoding="utf-8"))

    def write(self, script_id: str, source: str) -> Script:
        self.script_path(script_id).write_text(source, encoding="utf-8")
        return Script(id=script_id, source=source)

    def delete(self, script_id: str) -> None:
        self.script_path(script_id).unlink(missing_ok=True)

    @staticmethod
    def examples() -> list[Script]:
        if not EXAMPLES_DIR.is_dir():
            return []
        return [
            Script(id=p.stem, source=p.read_text(encoding="utf-8"))
            for p in sorted(EXAMPLES_DIR.glob("*.py"))
        ]

    # ---- runs -----------------------------------------------------------------------------
    def run_dir(self, run_id: str) -> Path:
        return self.project.path_in_project(RUNS_DIR, _check_id(run_id))

    def _save_run(self, run: ScriptRun) -> None:
        (self.run_dir(run.id) / "run.json").write_text(
            run.model_dump_json(indent=2), encoding="utf-8"
        )

    def run(self, script_id: str, structure_id: str | None = None) -> ScriptRun:
        """Start ``script_id`` on ``structure_id`` (if given) and return the queued run."""
        script = self.get(script_id)
        run = ScriptRun(script_id=script_id, structure_id=structure_id)
        directory = self._dir(RUNS_DIR, run.id)
        (directory / SCRIPT_NAME).write_text(script.source, encoding="utf-8")
        if structure_id is not None:
            structure = self.project.load_structure(structure_id)
            inputs = directory / "input"
            inputs.mkdir(exist_ok=True)
            (inputs / "structure.json").write_text(
                structure.model_dump_json(indent=2), encoding="utf-8"
            )
        (directory / CONTEXT_NAME).write_text(
            json.dumps(
                {
                    "project_root": str(self.project.root),
                    "structure_id": structure_id,
                    "run_id": run.id,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        spec = RunSpec(
            argv=[sys.executable, "-m", "atomscope.scripting.runner", SCRIPT_NAME],
            cwd=directory,
            # a script that imports pyplot must not try to open a window and hang the job
            env={"MPLBACKEND": "Agg"},
            description=f"script {script_id}",
        )
        record = self.jobs.submit(spec)
        run.job_id = record.id
        run.status = record.status
        self._save_run(run)
        return run

    def list_runs(self) -> list[ScriptRun]:
        runs = [self.get_run(p.name) for p in sorted(self._dir(RUNS_DIR).iterdir()) if p.is_dir()]
        return sorted(runs, key=lambda r: r.created_at, reverse=True)

    def get_run(self, run_id: str) -> ScriptRun:
        """The run, with its status refreshed and its outputs imported once it has finished."""
        directory = self.run_dir(run_id)
        path = directory / "run.json"
        if not path.is_file():
            msg = f"script run {run_id} not found"
            raise ScriptServiceError(msg)
        run = ScriptRun.model_validate_json(path.read_text(encoding="utf-8"))
        status = self._status(run, directory)
        if status is not None and status != run.status:
            run.status = status
        if run.status in ("completed", "failed", "cancelled") and not run.imported:
            self._collect(run, directory)
            run.imported = True
        self._save_run(run)
        return run

    def _status(self, run: ScriptRun, directory: Path) -> JobStatus | None:
        """The job's status: from the manager if it is still this process's, else from disk."""
        if run.job_id is None:
            return None
        record = self.jobs.jobs.get(run.job_id)
        if record is not None:
            return record.status
        # the server restarted while the script ran; job.json is the manager's own last word
        job_path = directory / "job.json"
        if not job_path.is_file():
            return None
        try:
            return JobRecord.model_validate_json(job_path.read_text(encoding="utf-8")).status
        except ValueError:
            return None

    def _collect(self, run: ScriptRun, directory: Path) -> None:
        """Import what the script handed back: structures into the project, values onto the run."""
        error_path = directory / ERROR_NAME
        if error_path.is_file():
            run.error = ScriptError.model_validate_json(error_path.read_text(encoding="utf-8"))
        result_path = directory / RESULT_NAME
        if not result_path.is_file():
            return
        try:
            result = ScriptResult.model_validate_json(result_path.read_text(encoding="utf-8"))
        except ValueError as exc:
            run.error = run.error or ScriptError(
                type="ValidationError", message=str(exc), traceback=""
            )
            return
        for structure in result.structures:
            self.project.save_structure(structure)
            run.structure_ids.append(structure.id)
        run.values = dict(result.values)

    async def cancel_run(self, run_id: str) -> ScriptRun:
        run = self.get_run(run_id)
        if run.job_id is not None and run.job_id in self.jobs.jobs:
            await self.jobs.cancel(run.job_id)
        return self.get_run(run_id)

    def log(self, run_id: str, stream: str = "stdout", tail: int = 500) -> list[str]:
        if stream not in ("stdout", "stderr"):
            msg = "stream must be 'stdout' or 'stderr'"
            raise ScriptServiceError(msg)
        path = self.run_dir(run_id) / f"{stream}.log"
        if not path.is_file():
            return []
        return path.read_text(errors="replace").splitlines()[-tail:]
