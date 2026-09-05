# ruff: noqa: E501, PLR0912, PLR0915, S603
"""Driver process for one CP-PAW run.

``python -m atomscope.backends.cppaw.runner <work_dir> <root> <paw_fast.x> [--wave paw_wave.x]
[--cube KIND=WAVEFILE ...] [--box ox oy oz lx ly lz]``

Why a driver instead of running ``paw_fast.x`` directly:
- soft stop: on SIGTERM it creates ``<root>.exit`` so CP-PAW finishes the step, writes its
  restart file and final reports, and exits cleanly (a hard kill loses up to NWRITE steps);
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


def main(argv: list[str]) -> int:  # noqa: PLR0915
    ap = argparse.ArgumentParser()
    ap.add_argument("work_dir")
    ap.add_argument("root")
    ap.add_argument("paw_fast")
    ap.add_argument("--wave", default=None)
    ap.add_argument("--cube", action="append", default=[], help="KIND=WAVEFILE")
    ap.add_argument(
        "--box", nargs=12, type=float, default=None, help="origin and three edge vectors (Bohr)"
    )
    ap.add_argument(
        "--stages",
        nargs="+",
        default=None,
        help="control files run in sequence (copied to <root>.cntl)",
    )
    args = ap.parse_args(argv[1:])
    work = Path(args.work_dir).resolve()
    root = args.root
    if not ROOT_RE.match(root):
        print(f"[atomscope] invalid root name {root!r}", flush=True)
        return 2
    for spec in args.cube:
        _, _, wave_file = spec.partition("=")
        if not ROOT_RE.match(Path(wave_file).stem) or "/" in wave_file:
            print(f"[atomscope] invalid wave file name {wave_file!r}", flush=True)
            return 2
    os.chdir(work)

    exit_file = work / f"{root}.exit"
    exit_file.unlink(missing_ok=True)
    out_path = work / f"{root}.out"
    print(f"[atomscope] starting {args.paw_fast} {root}.cntl in {work}", flush=True)
    t0 = time.monotonic()
    with out_path.open("ab") as out:
        proc = subprocess.Popen(
            [args.paw_fast, f"{root}.cntl"], stdout=out, stderr=subprocess.STDOUT
        )  # noqa: S603

        def soft_stop(signum: int, _frame: object) -> None:
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
    dt = time.monotonic() - t0
    print(f"[atomscope] paw_fast.x exited with code {code} after {dt:.1f} s", flush=True)
    if code != 0:
        tail = out_path.read_text(errors="replace").splitlines()[-15:]
        for line in tail:
            print(f"[paw_fast.x] {line}", flush=True)
        return code

    if args.wave and args.cube and args.box:
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
                rc = subprocess.call([args.wave, wcntl.name], stdout=wout, stderr=subprocess.STDOUT)  # noqa: S603
            if rc != 0:
                print(f"[atomscope] paw_wave.x failed with code {rc}", flush=True)
    print("[atomscope] done", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
