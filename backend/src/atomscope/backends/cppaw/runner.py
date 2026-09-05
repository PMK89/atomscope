# ruff: noqa: E501, PLR0912, PLR0915, S603
"""Driver process for one CP-PAW run.

``python -m atomscope.backends.cppaw.runner <work_dir> <root> <paw_fast.x> [--stages A.cntl B.cntl]
[--wave paw_wave.x] [--cube KIND=WAVEFILE ...] [--box ox oy oz  ax ay az  bx by bz  cx cy cz]``

Why a driver instead of running ``paw_fast.x`` directly:
- soft stop: on SIGTERM it creates ``<root>.exit`` so CP-PAW finishes the step, writes its
  restart file and final reports, and exits cleanly (a hard kill loses up to NWRITE steps);
- stages: multi-stage tasks (e.g. converge electrons, then a short force run) are separate
  control files run in sequence, each copied to ``<root>.cntl`` so CP-PAW keeps one root;
- completion: exit code 0 is not enough, the protocol must end with ``PROGRAM FINISHED``;
- post-processing: requested densities/orbitals (``.wv``) are converted to Gaussian cubes with
  ``paw_wave.x`` right after the run, in the same job;
- stdout of CP-PAW (developer noise plus error text) goes to ``<root>.out``; the driver's own
  stdout is a short, human-readable status log streamed by the JobManager.
"""

from __future__ import annotations

import argparse
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path

from atomscope.backends.cppaw.cntl import wcntl_text

SOFT_STOP_GRACE = 90.0
ROOT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def protocol_finished(prot: Path) -> bool:
    """CP-PAW's own completion marker: the last run in the (append-mode) protocol ended normally."""
    if not prot.is_file():
        return False
    text = prot.read_text(errors="replace")
    return "PROGRAM FINISHED" in text.rsplit("PROGRAM STARTED", 1)[-1]


def run_stage(
    paw_fast: str, work: Path, root: str, launcher: list[str] | None = None
) -> tuple[int, bool]:
    """Run ``paw_fast.x <root>.cntl`` (optionally through an MPI launcher) with soft-stop handling.
    Returns (exit code, stop requested)."""
    exit_file = work / f"{root}.exit"
    exit_file.unlink(missing_ok=True)
    out_path = work / f"{root}.out"
    stopped = False
    print(f"[atomscope] starting {paw_fast} {root}.cntl in {work}", flush=True)
    t0 = time.monotonic()
    with out_path.open("ab") as out:
        proc = subprocess.Popen(
            [*(launcher or []), paw_fast, f"{root}.cntl"], stdout=out, stderr=subprocess.STDOUT
        )

        def soft_stop(signum: int, _frame: object) -> None:
            nonlocal stopped
            stopped = True
            print(
                f"[atomscope] signal {signum}: requesting soft stop via {exit_file.name}",
                flush=True,
            )
            exit_file.touch()
            deadline = time.monotonic() + SOFT_STOP_GRACE
            while proc.poll() is None and time.monotonic() < deadline:
                time.sleep(0.5)
            if proc.poll() is None:
                print("[atomscope] soft stop timed out, terminating", flush=True)
                proc.terminate()

        signal.signal(signal.SIGTERM, soft_stop)
        signal.signal(signal.SIGINT, soft_stop)
        code = proc.wait()
    signal.signal(signal.SIGTERM, signal.SIG_DFL)
    signal.signal(signal.SIGINT, signal.SIG_DFL)
    print(
        f"[atomscope] paw_fast.x exited with code {code} after {time.monotonic() - t0:.1f} s",
        flush=True,
    )
    if code != 0:
        for line in out_path.read_text(errors="replace").splitlines()[-15:]:
            print(f"[paw_fast.x] {line}", flush=True)
    return code, stopped


def make_cubes(args: argparse.Namespace, work: Path, root: str) -> None:
    b = args.box
    origin = (b[0], b[1], b[2])
    vectors = ((b[3], b[4], b[5]), (b[6], b[7], b[8]), (b[9], b[10], b[11]))
    for spec in args.cube:
        kind, _, wave_file = spec.partition("=")
        if not (work / wave_file).exists():
            print(f"[atomscope] {wave_file} not written (kind {kind}); skipping", flush=True)
            continue
        stem = Path(wave_file).stem
        cube_file = f"{stem}.cub"
        wcntl = work / f"{stem}.wcntl"
        wcntl.write_text(wcntl_text(root, wave_file, cube_file, origin, vectors))
        print(f"[atomscope] paw_wave.x {wcntl.name} -> {cube_file}", flush=True)
        with (work / f"{stem}.wave.out").open("wb") as wout:
            rc = subprocess.call([args.wave, wcntl.name], stdout=wout, stderr=subprocess.STDOUT)
        if rc != 0:
            print(f"[atomscope] paw_wave.x failed with code {rc}", flush=True)


def main(argv: list[str]) -> int:  # noqa: PLR0911
    ap = argparse.ArgumentParser()
    ap.add_argument("work_dir")
    ap.add_argument("root")
    ap.add_argument("paw_fast")
    ap.add_argument(
        "--stages",
        nargs="+",
        default=None,
        help="control files run in sequence (copied to <root>.cntl)",
    )
    ap.add_argument("--wave", default=None)
    ap.add_argument("--cube", action="append", default=[], help="KIND=WAVEFILE")
    ap.add_argument(
        "--box", nargs=12, type=float, default=None, help="origin and three edge vectors (Bohr)"
    )
    ap.add_argument("--mpirun", default=None, help="MPI launcher executable (used with --np)")
    ap.add_argument("--np", type=int, default=1, help="MPI ranks")
    args = ap.parse_args(argv[1:])
    work = Path(args.work_dir).resolve()
    root = args.root
    if not ROOT_RE.match(root):
        print(f"[atomscope] invalid root name {root!r}", flush=True)
        return 2
    for spec in args.cube:
        _, _, wave_file = spec.partition("=")
        if "/" in wave_file or not ROOT_RE.match(Path(wave_file).stem):
            print(f"[atomscope] invalid wave file name {wave_file!r}", flush=True)
            return 2
    os.chdir(work)

    for stage in args.stages or [f"{root}.cntl"]:
        if stage != f"{root}.cntl":
            if "/" in stage or not (work / stage).is_file():
                print(f"[atomscope] stage file {stage!r} missing", flush=True)
                return 2
            (work / f"{root}.cntl").write_text((work / stage).read_text())
            print(f"[atomscope] stage {stage} -> {root}.cntl", flush=True)
        launcher = (
            [args.mpirun, "-np", str(args.np), "--oversubscribe"]
            if args.mpirun and args.np > 1
            else None
        )
        code, stopped = run_stage(args.paw_fast, work, root, launcher)
        if code != 0:
            return code
        if not protocol_finished(work / f"{root}.prot"):
            print(
                "[atomscope] protocol lacks PROGRAM FINISHED: treating the run as failed",
                flush=True,
            )
            return 3
        if stopped:
            print("[atomscope] stop requested: skipping remaining stages", flush=True)
            return 0

    if args.wave and args.cube and args.box:
        make_cubes(args, work, root)
    print("[atomscope] done", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
