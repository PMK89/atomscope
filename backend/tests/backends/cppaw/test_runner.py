"""The CP-PAW driver's soft stop, exercised with a stand-in for paw_fast.x.

A cancelled calculation must end as soon as CP-PAW has written its restart file, not after the
90 s grace period: the grace period exists for a code that ignores the exit file.
"""

from __future__ import annotations

import os
import signal
import threading
import time
from pathlib import Path

import pytest

from atomscope.backends.cppaw.runner import SOFT_STOP_GRACE, run_stage

FAKE_PAW = """#!/bin/sh
# stands in for paw_fast.x: run until the exit file appears, then stop cleanly
while [ ! -f case.exit ]; do sleep 0.05; done
sleep 0.1
exit 0
"""

STUBBORN_PAW = """#!/bin/sh
# ignores the exit file, like a code without soft-stop support
sleep 30
"""


def executable(path: Path, text: str) -> str:
    path.write_text(text)
    path.chmod(0o755)
    return str(path)


def send_sigterm_after(delay: float) -> threading.Thread:
    def fire() -> None:
        time.sleep(delay)
        os.kill(os.getpid(), signal.SIGTERM)

    thread = threading.Thread(target=fire, daemon=True)
    thread.start()
    return thread


@pytest.fixture(autouse=True)
def _in_work_dir(tmp_path: Path) -> object:
    previous = Path.cwd()
    os.chdir(tmp_path)
    yield
    os.chdir(previous)
    signal.signal(signal.SIGTERM, signal.SIG_DFL)
    signal.signal(signal.SIGINT, signal.SIG_DFL)


def test_soft_stop_returns_when_the_child_exits(tmp_path: Path) -> None:
    """The regression: waiting inside the signal handler could never observe the exit, because
    the handler runs inside the interrupted ``proc.wait()`` frame, which holds the waitpid lock."""
    paw = executable(tmp_path / "fake_paw.sh", FAKE_PAW)
    send_sigterm_after(0.3)

    started = time.monotonic()
    code, stopped = run_stage(paw, tmp_path, "case")
    elapsed = time.monotonic() - started

    assert (code, stopped) == (0, True)
    assert (tmp_path / "case.exit").exists()
    assert elapsed < 5.0, f"soft stop took {elapsed:.1f} s, close to the {SOFT_STOP_GRACE} s grace"


def test_a_child_that_ignores_the_exit_file_is_terminated(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("atomscope.backends.cppaw.runner.SOFT_STOP_GRACE", 0.5)
    paw = executable(tmp_path / "stubborn_paw.sh", STUBBORN_PAW)
    send_sigterm_after(0.2)

    started = time.monotonic()
    code, stopped = run_stage(paw, tmp_path, "case")
    elapsed = time.monotonic() - started

    assert stopped and code != 0  # killed by the signal
    assert elapsed < 10.0


def test_a_run_that_finishes_on_its_own_is_not_marked_stopped(tmp_path: Path) -> None:
    paw = executable(tmp_path / "quick.sh", "#!/bin/sh\nexit 0\n")
    assert run_stage(paw, tmp_path, "case") == (0, False)
