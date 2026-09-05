# ruff: noqa: E501, PLR0912, PLR0915, S603
"""Locating and health-checking the CP-PAW installation.

CP-PAW itself reads no environment variables; ``PAWDIR`` is only a convention of its shell
scripts. Atomscope looks for ``paw_fast.x`` in ``$ATOMSCOPE_CPPAW_DIR/bin/fast``, ``$PAWDIR/bin/fast``,
``~/cp-paw/bin/fast`` and on ``PATH``.

Known trap (docs/cppaw-analysis.md §7.1): the binaries built in 2025 abort at start-up with a
newer libgfortran ("Fortran runtime error: Missing comma between descriptors") while
``--version`` still succeeds. ``health_check`` therefore runs a real tiny deck and, on that
signature, retries with candidate older runtimes (e.g. conda package caches), remembering the
first ``LD_LIBRARY_PATH`` that works.
"""

from __future__ import annotations

import glob
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from importlib import resources
from pathlib import Path

from atomscope.backends.base import ExecutableReport

MAIN_EXE = "paw_fast.x"
PARALLEL_EXE = "ppaw_fast.x"
TOOL_EXES = ("paw_wave.x", "paw_dos.x", "paw_bands.x", "paw_tra.x", "paw_strc.x", "paw_toxyz.x")
RUNTIME_ERROR_SIGNATURE = "Missing comma between descriptors"


@dataclass
class CppawSettings:
    paw_dir: Path | None = None
    library_path: str | None = None
    mpirun: str | None = None
    library_path_candidates: list[str] = field(default_factory=list)
    runtime_verified: bool = False
    setups_file: Path | None = None

    @classmethod
    def from_env(cls) -> CppawSettings:
        env_dir = os.environ.get("ATOMSCOPE_CPPAW_DIR") or os.environ.get("PAWDIR")
        paw_dir = Path(env_dir).expanduser() if env_dir else None
        if paw_dir is None and (Path.home() / "cp-paw" / "bin" / "fast" / MAIN_EXE).exists():
            paw_dir = Path.home() / "cp-paw"
        candidates = sorted(
            glob.glob(str(Path.home() / "miniconda3" / "pkgs" / "libgfortran5-1[345]*" / "lib")),
            reverse=True,
        )
        candidates = [c for c in candidates if "13." in c] + [
            c for c in candidates if "13." not in c
        ]
        setups_env = os.environ.get("ATOMSCOPE_CPPAW_SETUPS_FILE")
        return cls(
            paw_dir=paw_dir,
            setups_file=Path(setups_env).expanduser() if setups_env else None,
            library_path=os.environ.get("ATOMSCOPE_CPPAW_LIBRARY_PATH"),
            mpirun=shutil.which("mpirun"),
            library_path_candidates=candidates,
        )

    def bin_dirs(self) -> list[Path]:
        dirs: list[Path] = []
        if self.paw_dir is not None:
            dirs += [self.paw_dir / "bin" / "fast", self.paw_dir / "bin" / "fast_parallel"]
        return dirs

    def find(self, name: str) -> Path | None:
        for d in self.bin_dirs():
            p = d / name
            if p.is_file() and os.access(p, os.X_OK):
                return p
        found = shutil.which(name)
        return Path(found) if found else None

    def env(self) -> dict[str, str]:
        env: dict[str, str] = {}
        if self.library_path:
            env["LD_LIBRARY_PATH"] = self.library_path
        return env


def version_info(exe: Path) -> dict[str, str]:
    """Parse ``paw_fast.x --version`` (``key= 'value'`` lines)."""
    try:
        out = subprocess.run(
            [str(exe), "--version"], capture_output=True, text=True, timeout=20, check=False
        )  # noqa: S603
    except (OSError, subprocess.TimeoutExpired):
        return {}
    info: dict[str, str] = {}
    for line in out.stdout.splitlines():
        if "=" in line:
            k, _, v = line.partition("=")
            info[k.strip().upper()] = v.strip().strip("'")
    return info


def discover(settings: CppawSettings) -> ExecutableReport:
    exes: dict[str, str] = {}
    messages: list[str] = []
    main = settings.find(MAIN_EXE)
    if main is None:
        messages.append(
            f"{MAIN_EXE} not found (set ATOMSCOPE_CPPAW_DIR or PAWDIR to the CP-PAW base directory)"
        )
        return ExecutableReport(available=False, messages=messages)
    exes["paw_fast"] = str(main)
    par = settings.find(PARALLEL_EXE)
    if par is not None:
        exes["ppaw_fast"] = str(par)
        if settings.mpirun:
            exes["mpirun"] = settings.mpirun
    for tool in TOOL_EXES:
        p = settings.find(tool)
        if p is not None:
            exes[tool.removesuffix(".x")] = str(p)
    info = version_info(main)
    if info.get("HASH"):
        messages.append(f"CP-PAW {info.get('HASH', '')[:10]} ({info.get('COMMITDATE', '?')})")
    if settings.library_path:
        messages.append(f"LD_LIBRARY_PATH={settings.library_path}")
    return ExecutableReport(available=True, executables=exes, messages=messages)


def _run_deck(exe: Path, env_extra: dict[str, str], timeout: float) -> tuple[int, str]:
    with tempfile.TemporaryDirectory(prefix="atomscope-cppaw-health-") as tmp:
        d = Path(tmp)
        data = resources.files("atomscope.backends.cppaw") / "data"
        for name in ("si2.cntl", "si2.strc"):
            (d / name).write_text((data / name).read_text())
        env = {k: os.environ[k] for k in ("PATH", "HOME", "LANG", "TMPDIR") if k in os.environ}
        env.update(env_extra)
        try:
            proc = subprocess.run(  # noqa: S603
                [str(exe), "si2.cntl"],
                cwd=d,
                env=env,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return -1, "timeout"
        prot = (d / "si2.prot").read_text(errors="replace") if (d / "si2.prot").exists() else ""
        ok = proc.returncode == 0 and "PROGRAM FINISHED" in prot
        return (0 if ok else proc.returncode or 1), proc.stdout + proc.stderr


def runtime_probe(exe: Path, env_extra: dict[str, str], timeout: float = 15.0) -> tuple[bool, str]:
    """Cheap start-up probe (~0.2 s): run paw_fast.x on a missing control file.

    A healthy binary reaches its own input error; a runtime-incompatible one dies earlier with
    the libgfortran FORMAT signature. Returns (runtime_ok, combined output).
    """
    with tempfile.TemporaryDirectory(prefix="atomscope-cppaw-probe-") as tmp:
        env = {k: os.environ[k] for k in ("PATH", "HOME", "LANG", "TMPDIR") if k in os.environ}
        env.update(env_extra)
        try:
            proc = subprocess.run(  # noqa: S603
                [str(exe), "missing.cntl"],
                cwd=tmp,
                env=env,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return False, "timeout"
        out = proc.stdout + proc.stderr
        return RUNTIME_ERROR_SIGNATURE not in out, out


def ensure_runtime(settings: CppawSettings) -> str | None:
    """Make sure ``settings.library_path`` lets the binary start; returns a diagnostic or None.

    Called before every launch when no health check has established a working runtime. Tries
    the current setting, then the candidate library directories.
    """
    exe = settings.find(MAIN_EXE)
    if exe is None:
        return f"{MAIN_EXE} not found"
    attempts: list[str | None] = [settings.library_path] + [
        c for c in settings.library_path_candidates if c != settings.library_path
    ]
    for lib in attempts:
        ok, _ = runtime_probe(exe, {"LD_LIBRARY_PATH": lib} if lib else {})
        if ok:
            settings.library_path = lib
            settings.runtime_verified = True
            return None
    return (
        f"{MAIN_EXE} cannot start with the available libgfortran runtimes ({RUNTIME_ERROR_SIGNATURE!r}); "
        "set ATOMSCOPE_CPPAW_LIBRARY_PATH or rebuild CP-PAW (docs/cppaw-analysis.md §7.1)"
    )


def diagnose_output(text: str) -> str | None:
    """Explain a failed run from CP-PAW's captured stdout/stderr, if the cause is recognizable."""
    if RUNTIME_ERROR_SIGNATURE in text:
        return (
            "CP-PAW aborted at start-up: the binary was built against an older libgfortran "
            "(see docs/cppaw-analysis.md §7.1; set ATOMSCOPE_CPPAW_LIBRARY_PATH or rebuild)"
        )
    if "CORRUPTED DATA FIELD ON INPUT" in text:
        return "CP-PAW could not parse an input value (CORRUPTED DATA FIELD ON INPUT)"
    for line in text.splitlines():
        if line.strip().startswith("STOP IN "):
            return f"CP-PAW stopped with an error: {line.strip()}"
    return None


@dataclass
class HealthReport:
    ok: bool
    message: str
    library_path: str | None = None
    seconds: float | None = None


def health_check(settings: CppawSettings, timeout: float = 120.0) -> HealthReport:
    """Run the si2 example. Updates ``settings.library_path`` if a fallback runtime was needed."""
    import time  # noqa: PLC0415

    exe = settings.find(MAIN_EXE)
    if exe is None:
        return HealthReport(ok=False, message=f"{MAIN_EXE} not found")
    attempts: list[str | None] = [settings.library_path] + [
        c for c in settings.library_path_candidates if c != settings.library_path
    ]
    last = ""
    for lib in attempts:
        env = {"LD_LIBRARY_PATH": lib} if lib else {}
        t0 = time.monotonic()
        code, out = _run_deck(exe, env, timeout)
        dt = time.monotonic() - t0
        if code == 0:
            settings.library_path = lib
            settings.runtime_verified = True
            return HealthReport(
                ok=True, message=f"si2 example ran in {dt:.1f} s", library_path=lib, seconds=dt
            )
        last = out
        if RUNTIME_ERROR_SIGNATURE not in out:
            break  # a different failure; trying other runtimes will not help
    hint = ""
    if RUNTIME_ERROR_SIGNATURE in last:
        hint = (
            " — the binaries were built against an older libgfortran; set "
            "ATOMSCOPE_CPPAW_LIBRARY_PATH to a directory with a compatible libgfortran.so.5, "
            "or rebuild CP-PAW (see docs/cppaw-analysis.md §7.1)"
        )
    return HealthReport(ok=False, message=f"si2 example failed{hint}: {last.strip()[-400:]}")
