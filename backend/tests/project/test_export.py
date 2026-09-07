"""Exporting a project without the files that are big and reproducible."""

from pathlib import Path

import ase.db
import pytest
from ase.build import molecule

from atomscope.ase_bridge import from_atoms
from atomscope.backends.registry import default_registry
from atomscope.calculations import CalculationService
from atomscope.jobs import JobManager
from atomscope.project import ProjectStore
from atomscope.project.database import DB_NAME
from atomscope.project.export import DEFAULT_EXCLUDED, export_project
from atomscope.project.export_cli import main


def _project(tmp_path: Path) -> ProjectStore:
    store = ProjectStore.create(tmp_path / "p", "export")
    store.save_structure(from_atoms(molecule("H2O"), name="h2o"))
    # a calculation directory shaped like a real one: inputs, a protocol, a grid, a restart
    work = store.register_calculation("c1") / "work"
    work.mkdir(parents=True, exist_ok=True)
    (work / "case.cntl").write_text("!CONTROL\n")
    (work / "case.prot").write_text("PROGRAM STARTED\n")
    (work / "case_density.cub").write_bytes(b"grid" * 1000)
    (work / "case.rstrt").write_bytes(b"wavefunctions" * 5000)
    (work / "case_stpforz8.myxml").write_bytes(b"setup" * 2000)
    (work / "case_r.tra").write_bytes(b"tape" * 1000)
    return store


def test_the_restart_file_is_left_out_and_everything_readable_is_kept(tmp_path: Path) -> None:
    store = _project(tmp_path)
    report = export_project(store, tmp_path / "out")

    out = tmp_path / "out"
    assert (out / "project.json").is_file()
    assert (out / "calculations" / "c1" / "work" / "case.cntl").is_file()
    assert (out / "calculations" / "c1" / "work" / "case.prot").is_file()
    # the grid is the picture, and without the restart it cannot be recomputed -- so it is kept
    assert (out / "calculations" / "c1" / "work" / "case_density.cub").is_file()
    # and the three defaults are gone
    assert not (out / "calculations" / "c1" / "work" / "case.rstrt").exists()
    assert not (out / "calculations" / "c1" / "work" / "case_stpforz8.myxml").exists()

    assert set(report.skipped) == {"restart", "setup_reports"}
    assert report.skipped["restart"] == (1, len(b"wavefunctions" * 5000))
    assert report.bytes_skipped > report.bytes_copied  # that is the whole point


def test_the_copy_says_what_it_is_missing(tmp_path: Path) -> None:
    store = _project(tmp_path)
    export_project(store, tmp_path / "out")
    note = (tmp_path / "out" / "EXPORT.md").read_text()

    assert "case.rstrt" not in note  # the category, not a file list
    assert "restart" in note and "MB" in note
    # someone will try to extract an orbital from the copy, so it has to say this
    assert "cannot be **continued from**" in note
    assert "no *new* orbital" in note


def test_a_complete_copy_is_possible_and_says_so(tmp_path: Path) -> None:
    store = _project(tmp_path)
    report = export_project(store, tmp_path / "out", exclude=frozenset())

    assert (tmp_path / "out" / "calculations" / "c1" / "work" / "case.rstrt").is_file()
    assert report.skipped == {}
    assert "Nothing was left out" in (tmp_path / "out" / "EXPORT.md").read_text()


def test_grids_can_be_dropped_for_a_thin_copy_but_are_not_by_default(tmp_path: Path) -> None:
    """Two tiers: a working copy that still draws, and a thin one that has to be re-run.

    Grids stay by default because once the restart file is gone they cannot be recomputed without
    running the calculation again -- and they are the pictures.
    """
    store = _project(tmp_path)
    kept = export_project(store, tmp_path / "full")
    assert (tmp_path / "full" / "calculations" / "c1" / "work" / "case_density.cub").is_file()
    assert "grids" not in kept.skipped

    thin = export_project(store, tmp_path / "thin", exclude=DEFAULT_EXCLUDED | {"grids"})
    assert not (tmp_path / "thin" / "calculations" / "c1" / "work" / "case_density.cub").exists()
    assert thin.skipped["grids"][0] == 1
    assert thin.bytes_copied < kept.bytes_copied
    # and the copy says a surface will not draw until the example is re-run
    assert "regenerates them" in (tmp_path / "thin" / "EXPORT.md").read_text()


def test_trajectory_tapes_can_be_dropped_too(tmp_path: Path) -> None:
    store = _project(tmp_path)
    report = export_project(store, tmp_path / "out", exclude=DEFAULT_EXCLUDED | {"trajectories"})
    assert not (tmp_path / "out" / "calculations" / "c1" / "work" / "case_r.tra").exists()
    assert report.skipped["trajectories"][0] == 1


def test_an_export_refuses_to_eat_its_own_project(tmp_path: Path) -> None:
    store = _project(tmp_path)
    with pytest.raises(ValueError, match="into itself"):
        export_project(store, store.root)
    with pytest.raises(ValueError, match="into itself"):
        export_project(store, store.root / "inside")


def test_an_export_refuses_a_directory_that_is_already_in_use(tmp_path: Path) -> None:
    store = _project(tmp_path)
    (tmp_path / "out").mkdir()
    (tmp_path / "out" / "something").write_text("mine")
    with pytest.raises(ValueError, match="not empty"):
        export_project(store, tmp_path / "out")


def test_an_unknown_exclusion_is_refused_rather_than_ignored(tmp_path: Path) -> None:
    store = _project(tmp_path)
    with pytest.raises(ValueError, match="unknown exclusion"):
        export_project(store, tmp_path / "out", exclude=frozenset({"restart", "everything"}))


async def test_an_exported_project_opens_and_keeps_its_results(tmp_path: Path) -> None:
    """The point of the whole thing: the copy is a project, not an archive of one."""
    store = ProjectStore.create(tmp_path / "p", "export")
    svc = CalculationService(store, default_registry(), JobManager())
    water = from_atoms(molecule("H2O"), name="h2o")
    store.save_structure(water)
    calc = svc.create(
        name="water", backend_id="ase_builtin", structure=water, values={"task": "single_point"}
    )
    started = svc.run(calc.id)
    assert started.job is not None
    await svc.jobs.wait(started.job.id)
    svc.collect_results(calc.id)
    energy = svc.get(calc.id).results.properties["energy"].value  # type: ignore[union-attr]

    export_project(store, tmp_path / "out")

    reopened = CalculationService(
        ProjectStore.open(tmp_path / "out"), default_registry(), JobManager()
    )
    copied = next(c for c in reopened.list() if c.name == "water")
    assert copied.status == "completed"
    assert copied.results is not None
    assert copied.results.properties["energy"].value == energy
    # and the database came with it, so the copy is queryable without rebuilding
    assert ase.db.connect(tmp_path / "out" / DB_NAME).count() == 1


def test_the_cli_takes_the_exclusions_make_passes_it(tmp_path: Path) -> None:
    """`make course-export EXCLUDE=...` goes through this, so the parsing is worth pinning."""
    store = _project(tmp_path)
    assert main([str(store.root), str(tmp_path / "a"), "--exclude", "restart,grids"]) == 0
    assert not (tmp_path / "a" / "calculations" / "c1" / "work" / "case_density.cub").exists()
    # a setup report is *not* excluded here: the flag replaces the default, it does not add to it
    assert (tmp_path / "a" / "calculations" / "c1" / "work" / "case_stpforz8.myxml").is_file()

    # EXCLUDE= means a complete copy, and whitespace or a trailing comma is not an unknown key
    assert main([str(store.root), str(tmp_path / "b"), "--exclude", ""]) == 0
    assert (tmp_path / "b" / "calculations" / "c1" / "work" / "case.rstrt").is_file()
    assert main([str(store.root), str(tmp_path / "c"), "--exclude", " restart , "]) == 0
    assert not (tmp_path / "c" / "calculations" / "c1" / "work" / "case.rstrt").exists()

    # omitting it entirely is the default pair
    assert main([str(store.root), str(tmp_path / "d")]) == 0
    assert not (tmp_path / "d" / "calculations" / "c1" / "work" / "case_stpforz8.myxml").exists()
    assert (tmp_path / "d" / "calculations" / "c1" / "work" / "case_density.cub").is_file()
