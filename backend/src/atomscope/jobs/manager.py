"""Asynchronous local job manager.

Security properties (see docs/architecture/security-model.md):
- argv arrays only, ``shell=False``; argv[0] must be an existing executable file
- explicit working directory that must already exist
- explicit environment: a minimal base (PATH, HOME, LANG, TMPDIR if set) plus the spec's ``env``
- the child runs in its own session so cancellation can signal the whole process group
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import signal
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path

from atomscope.jobs.models import JobRecord, LogEvent, RunSpec, StatusEvent

Listener = Callable[[LogEvent | StatusEvent], Awaitable[None] | None]

BASE_ENV_KEYS = ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "USER")


class JobError(Exception):
    pass


def validate_executable(path: str) -> Path:
    p = Path(path)
    if not p.is_absolute():
        msg = f"executable must be an absolute path, got {path!r}"
        raise JobError(msg)
    if not p.is_file() or not os.access(p, os.X_OK):
        msg = f"{path} is not an executable file"
        raise JobError(msg)
    return p


def build_env(extra: dict[str, str]) -> dict[str, str]:
    env = {k: os.environ[k] for k in BASE_ENV_KEYS if k in os.environ}
    env.update(extra)
    return env


class JobManager:
    def __init__(self, *, max_parallel: int = 1, grace_seconds: float = 5.0) -> None:
        self.jobs: dict[str, JobRecord] = {}
        self._procs: dict[str, asyncio.subprocess.Process] = {}
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._listeners: list[Listener] = []
        self._sem = asyncio.Semaphore(max_parallel)
        self._grace = grace_seconds
        self._cancel_requested: set[str] = set()

    # ---- listeners --------------------------------------------------------------------------
    def add_listener(self, listener: Listener) -> None:
        self._listeners.append(listener)

    def remove_listener(self, listener: Listener) -> None:
        with contextlib.suppress(ValueError):
            self._listeners.remove(listener)

    async def _emit(self, event: LogEvent | StatusEvent) -> None:
        for listener in list(self._listeners):
            result = listener(event)
            if asyncio.iscoroutine(result):
                await result

    # ---- lifecycle --------------------------------------------------------------------------
    def submit(self, spec: RunSpec, *, calculation_id: str | None = None) -> JobRecord:
        validate_executable(spec.argv[0])
        if not spec.cwd.is_dir():
            msg = f"working directory {spec.cwd} does not exist"
            raise JobError(msg)
        record = JobRecord(spec=spec, calculation_id=calculation_id)
        self.jobs[record.id] = record
        self._persist(record)
        self._tasks[record.id] = asyncio.create_task(self._run(record))
        return record

    async def wait(self, job_id: str) -> JobRecord:
        task = self._tasks.get(job_id)
        if task is not None:
            await task
        return self.jobs[job_id]

    async def cancel(self, job_id: str) -> JobRecord:
        record = self.jobs[job_id]
        if not record.is_active:
            return record
        self._cancel_requested.add(job_id)
        proc = self._procs.get(job_id)
        if proc is not None and proc.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGTERM)
            try:
                await asyncio.wait_for(proc.wait(), timeout=self._grace)
            except TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(proc.pid, signal.SIGKILL)
        task = self._tasks.get(job_id)
        if task is not None:
            await task
        return self.jobs[job_id]

    async def shutdown(self) -> None:
        for job_id in list(self._tasks):
            await self.cancel(job_id)

    # ---- internals --------------------------------------------------------------------------
    async def _run(self, record: JobRecord) -> None:
        spec = record.spec
        async with self._sem:
            if record.id in self._cancel_requested:
                await self._finish(record, "cancelled", None, "cancelled before start")
                return
            stdout_path = spec.cwd / spec.stdout_name
            stderr_path = spec.cwd / spec.stderr_name
            try:
                proc = await asyncio.create_subprocess_exec(
                    *spec.argv,
                    cwd=str(spec.cwd),
                    env=build_env(spec.env),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    stdin=asyncio.subprocess.DEVNULL,
                    start_new_session=True,
                )
            except OSError as exc:
                await self._finish(record, "failed", None, f"could not start process: {exc}")
                return
            self._procs[record.id] = proc
            record.status = "running"
            record.pid = proc.pid
            record.started_at = datetime.now(tz=UTC)
            self._persist(record)
            await self._emit(StatusEvent(job_id=record.id, status="running"))

            done = asyncio.Event()
            watchers = [
                asyncio.create_task(self._watch_file(record.id, spec.cwd / name, name, done))
                for name in spec.watch_files
            ]
            assert proc.stdout is not None and proc.stderr is not None  # noqa: S101
            await asyncio.gather(
                self._pump(record.id, proc.stdout, "stdout", stdout_path),
                self._pump(record.id, proc.stderr, "stderr", stderr_path),
            )
            code = await proc.wait()
            done.set()
            await asyncio.gather(*watchers)
            self._procs.pop(record.id, None)
            if record.id in self._cancel_requested:
                await self._finish(record, "cancelled", code, None)
            elif code == 0:
                await self._finish(record, "completed", code, None)
            else:
                await self._finish(record, "failed", code, f"exit code {code}")

    async def _pump(self, job_id: str, stream: asyncio.StreamReader, name: str, path: Path) -> None:
        with path.open("ab") as fh:
            while True:
                raw = await stream.readline()
                if not raw:
                    break
                fh.write(raw)
                fh.flush()
                await self._emit(
                    LogEvent(
                        job_id=job_id, stream=name, line=raw.decode(errors="replace").rstrip("\n")
                    )
                )

    async def _watch_file(
        self, job_id: str, path: Path, name: str, done: asyncio.Event, interval: float = 0.5
    ) -> None:
        """Tail a file the program writes itself (e.g. CP-PAW's .prot) and stream new lines.

        Polls until ``done`` is set, then reads once more so nothing written just before exit
        is lost.
        """
        offset = 0
        buffer = b""

        async def read_new() -> None:
            nonlocal offset, buffer
            if not path.exists():
                return
            with path.open("rb") as fh:
                fh.seek(offset)
                chunk = fh.read()
            offset += len(chunk)
            buffer += chunk
            *lines, buffer = buffer.split(b"\n")
            for line in lines:
                await self._emit(
                    LogEvent(job_id=job_id, stream=name, line=line.decode(errors="replace"))
                )

        while not done.is_set():
            await read_new()
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(done.wait(), timeout=interval)
        await read_new()

    async def _finish(
        self, record: JobRecord, status: str, code: int | None, error: str | None
    ) -> None:
        record.status = status  # type: ignore[assignment]
        record.exit_code = code
        record.error = error
        record.finished_at = datetime.now(tz=UTC)
        self._persist(record)
        self._cancel_requested.discard(record.id)
        await self._emit(
            StatusEvent(job_id=record.id, status=record.status, exit_code=code, error=error)
        )

    def _persist(self, record: JobRecord) -> None:
        path = record.spec.cwd / "job.json"
        with contextlib.suppress(OSError):
            path.write_text(json.dumps(record.model_dump(mode="json"), indent=2, sort_keys=True))
