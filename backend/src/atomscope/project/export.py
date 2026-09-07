"""Copy a project somewhere else without the files that are big and reproducible.

A finished project is mostly restart file. Measured on the CP-PAW hands-on course project -- 22
calculations, water through iron and silicon -- 926 MB of which 683 MB (74%) is ``case.rstrt`` and
another 92 MB is setup reports that are byte-identical between runs sharing a setup. What is left,
the inputs, the protocols, the parsed results, the densities and the orbitals, is 150 MB.

So the export is a copy with named exclusions, each with a reason, and it reports what it left
behind rather than quietly shrinking the project. The distinction that matters is not size but
what the file *is*:

* an **input** or a **protocol** cannot be regenerated -- it is the record of what was run;
* a **grid** (a ``.cub``, a materialized ``.f32``) is the picture, and once the restart file is
  gone it cannot be recomputed, so it is kept even though it is large;
* a **restart file** is the wave functions. It is the one thing a continuation needs and the one
  thing nothing else can be derived from, which is exactly why it is both huge and excluded: an
  archive is for reading, a restart is for continuing.

A project exported without restart files can be opened, read, plotted and queried. It cannot be
continued from, and no *new* orbital or band structure can be extracted -- those read the restart.
``EXPORT.md`` in the copy says so, because someone will try.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

from atomscope.project.database import DB_NAME

if TYPE_CHECKING:  # pragma: no cover
    from atomscope.project import ProjectStore


@dataclass(frozen=True)
class Exclusion:
    """One category of file the export can leave out, and why it is safe to."""

    key: str
    patterns: tuple[str, ...]
    reason: str


EXCLUSIONS: tuple[Exclusion, ...] = (
    Exclusion(
        key="restart",
        patterns=("*.rstrt",),
        reason="the wave functions; needed only to continue a run or extract a new orbital,"
        " and by far the largest thing in a project",
    ),
    Exclusion(
        key="setup_reports",
        patterns=("*.myxml",),
        reason="the setup (pseudopotential) report, identical between every run that shares a"
        " setup and regenerable from the setups file",
    ),
    Exclusion(
        key="grids",
        patterns=("*.cub", "*.f32", "*.wv"),
        reason="the volumetric grids -- densities, orbitals, and their materialized form. These"
        " are the pictures, so leaving them out gives a project that reads but cannot draw a"
        " surface; re-running an example from its inputs regenerates them",
    ),
    Exclusion(
        key="trajectories",
        patterns=("*_r.tra", "*_e.tra"),
        reason="the raw trajectory tapes; the frames Atomscope plots are already in results.json",
    ),
)

BY_KEY = {e.key: e for e in EXCLUSIONS}
DEFAULT_EXCLUDED = frozenset({"restart", "setup_reports"})

# Job records, calculation manifests and driver logs carry the absolute paths of whatever ran:
# the executable, the interpreter, the work directory, the library path. An export is a copy made
# to be shared, so it should not carry the exporting machine's home directory around with it --
# `~/cp-paw/bin/fast/paw_fast.x` says everything the record was for without naming a user. Only
# these three text formats are touched; the code's own output (.prot, .dos, .banddata) is copied
# byte for byte, because a parser fixture that has been edited is not a fixture.
SCRUBBED = frozenset({".json", ".log", ".md"})


@dataclass
class ExportReport:
    """What was copied and what was left out, in bytes, so the numbers can be reported."""

    destination: Path
    files: int = 0
    bytes_copied: int = 0
    scrubbed: int = 0
    skipped: dict[str, tuple[int, int]] = field(default_factory=dict)  # key -> (files, bytes)

    @property
    def bytes_skipped(self) -> int:
        return sum(b for _, b in self.skipped.values())

    def note(self, key: str, size: int) -> None:
        files, total = self.skipped.get(key, (0, 0))
        self.skipped[key] = (files + 1, total + size)


def _tilde(path: Path) -> str:
    """``~/...`` where a path is under the home directory. See :data:`SCRUBBED`."""
    home = Path.home()
    try:
        return f"~/{path.relative_to(home)}"
    except ValueError:
        return str(path)


def _copy_scrubbed(source: Path, target: Path, home: str) -> bool:
    """Copy a text record with the home directory written as ``~``. False if it was not one.

    Returns False rather than raising for anything that is not decodable text: a file with a
    scrubbable suffix but binary content is copied verbatim by the caller instead of corrupted.
    """
    if source.suffix not in SCRUBBED or not home:
        return False
    try:
        text = source.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return False
    if home not in text:
        return False
    target.write_text(text.replace(home, "~"), encoding="utf-8")
    shutil.copystat(source, target)
    return True


def _matches(path: Path, exclusion: Exclusion) -> bool:
    return any(path.match(pattern) for pattern in exclusion.patterns)


def _readme(report: ExportReport, excluded: frozenset[str], source: Path) -> str:
    lines = [
        "# Exported Atomscope project",
        "",
        f"Copied from `{_tilde(source)}`.",
        "",
        f"{report.files} files, {report.bytes_copied / 2**20:.1f} MB.",
        "",
    ]
    if not excluded:
        lines += ["Nothing was left out: this is a complete copy.", ""]
        return "\n".join(lines)
    lines += [
        "## What was left out",
        "",
        "| what | files | size | why |",
        "|------|-------|------|-----|",
    ]
    for key in sorted(excluded):
        files, size = report.skipped.get(key, (0, 0))
        lines.append(f"| `{key}` | {files} | {size / 2**20:.1f} MB | {BY_KEY[key].reason} |")
    lines += [
        "",
        f"Total left out: {report.bytes_skipped / 2**20:.1f} MB.",
        "",
        "## What that means",
        "",
        "This copy opens, reads, plots and queries like any project. Everything already",
        "computed is here: the inputs, the protocols, the parsed results and the grids.",
        "",
    ]
    if "restart" in excluded:
        lines += [
            "It cannot be **continued from**, and no *new* orbital, band structure or density",
            "can be extracted, because all of those read the restart file. Re-run the",
            "calculation from its inputs if you need one.",
            "",
        ]
    return "\n".join(lines)


def export_project(
    store: ProjectStore,
    destination: Path,
    *,
    exclude: frozenset[str] | None = None,
) -> ExportReport:
    """Copy the project to ``destination``, leaving out the named categories.

    A directory rather than an archive: it can be opened straight away, diffed, grepped and
    rsynced, and ``tar`` is one command away for anyone who wants a single file.
    """
    excluded = DEFAULT_EXCLUDED if exclude is None else exclude
    unknown = excluded - BY_KEY.keys()
    if unknown:
        msg = f"unknown exclusion(s): {', '.join(sorted(unknown))}"
        raise ValueError(msg)

    source = store.root
    destination = destination.resolve()
    if destination == source or source in destination.parents:
        msg = f"cannot export a project into itself ({destination})"
        raise ValueError(msg)
    if destination.exists() and any(destination.iterdir()):
        msg = f"{destination} is not empty"
        raise ValueError(msg)

    rules = [BY_KEY[key] for key in excluded]
    report = ExportReport(destination=destination)
    home = str(Path.home())
    if len(home) < 2:  # "/" or "" would rewrite every path in every file
        home = ""
    for path in sorted(source.rglob("*")):
        if path.is_dir():
            continue
        relative = path.relative_to(source)
        hit = next((rule for rule in rules if _matches(path, rule)), None)
        if hit is not None:
            report.note(hit.key, path.stat().st_size)
            continue
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if not _copy_scrubbed(path, target, home):
            shutil.copy2(path, target)
        else:
            report.scrubbed += 1
        report.files += 1
        report.bytes_copied += target.stat().st_size

    (destination / "EXPORT.md").write_text(_readme(report, excluded, source), encoding="utf-8")
    return report


__all__ = ["BY_KEY", "DB_NAME", "DEFAULT_EXCLUDED", "EXCLUSIONS", "ExportReport", "export_project"]
