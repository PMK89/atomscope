"""``python -m atomscope.project.export_cli <project> <destination> [--exclude a,b]``.

What ``make course-export`` runs. A module rather than a shell one-liner in the Makefile so that
the argument handling is testable and the reasons live next to the exclusion rules.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from atomscope.project import ProjectStore
from atomscope.project.export import BY_KEY, DEFAULT_EXCLUDED, export_project


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument(
        "--exclude",
        default=None,
        help=(
            f"comma-separated exclusion keys ({', '.join(sorted(BY_KEY))}); empty string for a"
            f" complete copy; omit for the default ({', '.join(sorted(DEFAULT_EXCLUDED))})"
        ),
    )
    args = parser.parse_args(argv)

    exclude = None
    if args.exclude is not None:
        exclude = frozenset(k for k in (p.strip() for p in args.exclude.split(",")) if k)

    report = export_project(ProjectStore.open(args.project), args.destination, exclude=exclude)
    print(f"{report.files} files, {report.bytes_copied / 2**20:.1f} MB -> {report.destination}")
    for key, (files, size) in sorted(report.skipped.items()):
        print(f"  left out {key}: {files} files, {size / 2**20:.1f} MB")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
