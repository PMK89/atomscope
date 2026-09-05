"""Benchmark runner.

    python -m benchmarks.run --quick            # small/medium sizes, a couple of minutes
    python -m benchmarks.run --full             # every size, including 1e5 atoms and 256^3 grids
    python -m benchmarks.run --full --tag after --compare .scratch/bench/results-baseline.json

Every case runs in its own child process: ``resource.getrusage`` reports a process-lifetime
high-water mark, so peak RSS would otherwise be the maximum over all cases run before it. The
child prints one JSON object on stdout; the parent collects, times out and reports.
"""

from __future__ import annotations

import argparse
import json
import math
import resource
import subprocess
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any

from benchmarks._timing import Case, Measurement, registry, run_case

BACKEND_DIR = Path(__file__).resolve().parents[1]
DEFAULT_OUT = BACKEND_DIR.parent / ".scratch" / "bench"


def _load_cases() -> dict[str, Case]:
    from benchmarks import cases_data, cases_structures  # noqa: PLC0415

    if not registry():
        cases_structures.register_all()
        cases_data.register_all()
    return registry()


def _prepare(*, full: bool) -> None:
    """Generate all cached fixtures in a child process; case timeouts then measure real work."""
    from benchmarks import fixtures  # noqa: PLC0415

    print(f"preparing fixtures in {fixtures.root()} ...", flush=True)  # noqa: T201
    cmd = [sys.executable, "-c", f"from benchmarks import fixtures; fixtures.prepare(full={full})"]
    proc = subprocess.run(cmd, cwd=BACKEND_DIR, capture_output=True, text=True, check=False)  # noqa: S603
    if proc.returncode != 0:
        print("fixture preparation failed:\n" + proc.stderr[-2000:])  # noqa: T201


#: address-space cap for a benchmark child; a runaway case must not swap the workstation
CHILD_MEMORY_LIMIT = 24 << 30


def _child(name: str) -> int:
    resource.setrlimit(resource.RLIMIT_AS, (CHILD_MEMORY_LIMIT, CHILD_MEMORY_LIMIT))
    cases = _load_cases()
    case = cases.get(name)
    if case is None:
        print(json.dumps({"error": f"unknown case {name}"}))  # noqa: T201
        return 2
    print("__RESULT__" + json.dumps(asdict(run_case(case))))  # noqa: T201
    return 0


def _run_child(case: Case) -> Measurement:
    cmd = [sys.executable, "-m", "benchmarks.run", "--child", "--case", case.name]
    try:
        proc = subprocess.run(  # noqa: S603
            cmd,
            cwd=BACKEND_DIR,
            capture_output=True,
            text=True,
            timeout=case.timeout_s,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return _failed(case, f"timed out after {case.timeout_s:.0f} s", timed_out=True)
    for line in proc.stdout.splitlines():
        if line.startswith("__RESULT__"):
            return Measurement(**json.loads(line[len("__RESULT__") :]))
    tail = (proc.stderr or proc.stdout).strip().splitlines()[-3:]
    return _failed(case, "child produced no result: " + " | ".join(tail))


def _failed(case: Case, error: str, *, timed_out: bool = False) -> Measurement:
    return Measurement(
        name=case.name,
        group=case.group,
        items_label=case.items_label,
        wall_s=float("nan"),
        wall_min_s=float("nan"),
        repeats=0,
        items=0,
        note="",
        rss_setup_mb=0.0,
        peak_rss_mb=0.0,
        error=error,
        timed_out=timed_out,
    )


def _fmt_time(seconds: float) -> str:
    if math.isnan(seconds):
        return "-"
    if seconds < 1e-3:
        return f"{seconds * 1e6:.0f} µs"
    if seconds < 1.0:
        return f"{seconds * 1e3:.1f} ms"
    return f"{seconds:.2f} s"


def _fmt_rate(m: Measurement) -> str:
    rate = m.throughput
    if rate is None:
        return "-"
    if rate >= 1e6:
        return f"{rate / 1e6:.1f}M {m.items_label}/s"
    if rate >= 1e3:
        return f"{rate / 1e3:.1f}k {m.items_label}/s"
    return f"{rate:.0f} {m.items_label}/s"


def _before_column(before: Measurement | None, m: Measurement) -> str:
    """The 'before' and 'speed-up' cells of a comparison table."""
    if before is None:
        return " - | - |"
    if before.error:
        # a baseline that failed outright is the headline: show why
        return f" {before.error} | now {_fmt_time(m.wall_s)} |"
    if math.isnan(before.wall_s) or m.wall_s <= 0:
        return " - | - |"
    return f" {_fmt_time(before.wall_s)} | {before.wall_s / m.wall_s:.1f}x |"


def _load_results(path: Path) -> dict[str, Measurement]:
    raw: list[dict[str, Any]] = json.loads(path.read_text(encoding="utf-8"))
    return {r["name"]: Measurement(**r) for r in raw}


def _markdown(results: list[Measurement], baseline: dict[str, Measurement] | None) -> str:
    lines: list[str] = []
    groups: dict[str, list[Measurement]] = {}
    for m in results:
        groups.setdefault(m.group, []).append(m)
    for group, entries in groups.items():
        lines.append(f"### {group}\n")
        header = "| case | items | wall (median) | throughput | peak RSS | note |"
        sep = "| --- | ---: | ---: | ---: | ---: | --- |"
        if baseline is not None:
            header = header[:-1] + " before | speed-up |"
            sep = sep[:-1] + " ---: | ---: |"
        lines += [header, sep]
        for m in entries:
            if m.error:
                row = f"| `{m.name}` | - | **{m.error}** | - | - | - |"
                if baseline is not None:
                    row = row[:-1] + " - | - |"
                lines.append(row)
                continue
            row = (
                f"| `{m.name}` | {m.items:,} | {_fmt_time(m.wall_s)} | {_fmt_rate(m)} "
                f"| {m.peak_rss_mb:.0f} MB | {m.note} |"
            )
            if baseline is not None:
                row = row[:-1] + _before_column(baseline.get(m.name), m)
            lines.append(row)
        lines.append("")
    return "\n".join(lines)


def _select(cases: dict[str, Case], *, full: bool, pattern: str | None) -> list[Case]:
    out = [c for c in cases.values() if full or c.quick]
    if pattern:
        out = [c for c in out if pattern in c.name]
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Atomscope backend benchmarks")
    parser.add_argument("--quick", action="store_true", help="small/medium sizes only (default)")
    parser.add_argument("--full", action="store_true", help="every size, including 1e5 / 256^3")
    parser.add_argument("--filter", default=None, help="substring of the case name")
    parser.add_argument("--tag", default=None, help="output file suffix (default: quick/full)")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="output directory")
    parser.add_argument("--compare", default=None, help="results JSON to compare against")
    parser.add_argument("--list", action="store_true", help="print case names and exit")
    parser.add_argument("--no-prepare", action="store_true", help="skip fixture generation")
    parser.add_argument("--report", default=None, help="re-render Markdown from a results JSON")
    parser.add_argument("--child", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--case", default=None, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    if args.child:
        if not args.case:
            parser.error("--child needs --case")
        return _child(args.case)

    cases = _load_cases()
    if args.list:
        for c in cases.values():
            print(f"{c.name}\t{c.group}\t{'quick' if c.quick else 'full'}")  # noqa: T201
        return 0

    selected = _select(cases, full=args.full, pattern=args.filter)
    tag = args.tag or ("full" if args.full else "quick")
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    baseline: dict[str, Measurement] | None = None
    if args.compare:
        baseline = _load_results(Path(args.compare))

    if args.report:
        return _write(list(_load_results(Path(args.report)).values()), out_dir, tag, baseline)

    if not args.no_prepare:
        _prepare(full=bool(args.full))

    results: list[Measurement] = []
    for i, case in enumerate(selected, 1):
        print(f"[{i}/{len(selected)}] {case.name} ...", end=" ", flush=True)  # noqa: T201
        m = _run_child(case)
        results.append(m)
        print(m.error or f"{_fmt_time(m.wall_s)}  {m.peak_rss_mb:.0f} MB")  # noqa: T201

    return _write(results, out_dir, tag, baseline)


def _write(
    results: list[Measurement],
    out_dir: Path,
    tag: str,
    baseline: dict[str, Measurement] | None,
) -> int:
    """Write results-<tag>.json and summary-<tag>.md."""
    (out_dir / f"results-{tag}.json").write_text(
        json.dumps([asdict(m) for m in results], indent=2) + "\n", encoding="utf-8"
    )
    summary = out_dir / f"summary-{tag}.md"
    summary.write_text(
        f"# Atomscope benchmark results ({tag})\n\n" + _markdown(results, baseline),
        encoding="utf-8",
    )
    print(f"\nwrote {summary} and results-{tag}.json")  # noqa: T201
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
