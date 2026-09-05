import asyncio
import json
import sys
from pathlib import Path

import pytest

from atomscope.jobs import JobManager, RunSpec
from atomscope.jobs.manager import JobError, build_env
from atomscope.jobs.models import LogEvent, StatusEvent

PY = sys.executable


def spec(tmp_path: Path, code: str, **kw: object) -> RunSpec:
    return RunSpec(argv=[PY, "-u", "-c", code], cwd=tmp_path, **kw)  # type: ignore[arg-type]


async def test_streams_stdout_and_completes(tmp_path: Path) -> None:
    jm = JobManager()
    events: list[LogEvent | StatusEvent] = []
    jm.add_listener(events.append)
    rec = jm.submit(
        spec(tmp_path, "print('hello'); import sys; print('warn', file=sys.stderr); print('bye')")
    )
    rec = await jm.wait(rec.id)
    assert rec.status == "completed" and rec.exit_code == 0 and rec.pid
    logs = [e for e in events if isinstance(e, LogEvent)]
    assert [e.line for e in logs if e.stream == "stdout"] == ["hello", "bye"]
    assert [e.line for e in logs if e.stream == "stderr"] == ["warn"]
    statuses = [e.status for e in events if isinstance(e, StatusEvent)]
    assert statuses == ["running", "completed"]
    assert (tmp_path / "stdout.log").read_text() == "hello\nbye\n"
    saved = json.loads((tmp_path / "job.json").read_text())
    assert saved["status"] == "completed"
    assert rec.elapsed_seconds is not None and rec.elapsed_seconds >= 0


async def test_failure_exit_code(tmp_path: Path) -> None:
    jm = JobManager()
    rec = await jm.wait(jm.submit(spec(tmp_path, "raise SystemExit(3)")).id)
    assert rec.status == "failed" and rec.exit_code == 3 and "3" in (rec.error or "")


async def test_cancel_running_job(tmp_path: Path) -> None:
    jm = JobManager(grace_seconds=1.0)
    rec = jm.submit(spec(tmp_path, "import time\nprint('start')\ntime.sleep(30)"))
    for _ in range(100):
        await asyncio.sleep(0.05)
        if rec.status == "running":
            break
    rec = await jm.cancel(rec.id)
    assert rec.status == "cancelled"
    assert rec.finished_at is not None


async def test_watch_file_is_streamed(tmp_path: Path) -> None:
    jm = JobManager()
    lines: list[str] = []
    jm.add_listener(
        lambda e: (
            lines.append(e.line) if isinstance(e, LogEvent) and e.stream == "run.prot" else None
        )
    )
    code = (
        "import time\nf=open('run.prot','w')\n"
        "for i in range(3):\n f.write(f'step {i}\\n'); f.flush(); time.sleep(0.3)\n"
    )
    rec = await jm.wait(jm.submit(spec(tmp_path, code, watch_files=["run.prot"])).id)
    assert rec.status == "completed"
    assert lines == ["step 0", "step 1", "step 2"]


async def test_rejects_bad_executable_and_cwd(tmp_path: Path) -> None:
    jm = JobManager()
    with pytest.raises(JobError, match="absolute"):
        jm.submit(RunSpec(argv=["python3"], cwd=tmp_path))
    with pytest.raises(JobError, match="not an executable"):
        jm.submit(RunSpec(argv=[str(tmp_path / "nope")], cwd=tmp_path))
    with pytest.raises(JobError, match="does not exist"):
        jm.submit(RunSpec(argv=[PY], cwd=tmp_path / "missing"))


def test_env_is_minimal_plus_extra(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SECRET_TOKEN", "x")
    env = build_env({"PAWDIR": "/opt/paw"})
    assert "SECRET_TOKEN" not in env and env["PAWDIR"] == "/opt/paw" and "PATH" in env


async def test_parallel_limit_serializes(tmp_path: Path) -> None:
    jm = JobManager(max_parallel=1)
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    code = "import time; time.sleep(0.4); print('done')"
    r1 = jm.submit(RunSpec(argv=[PY, "-c", code], cwd=tmp_path / "a"))
    r2 = jm.submit(RunSpec(argv=[PY, "-c", code], cwd=tmp_path / "b"))
    await jm.wait(r1.id)
    await jm.wait(r2.id)
    assert r1.finished_at is not None and r2.started_at is not None
    assert r2.started_at >= r1.finished_at
