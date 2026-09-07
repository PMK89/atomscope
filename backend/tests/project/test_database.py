"""The project's ASE database: one row per finished calculation, selected by chemistry.

Uses the `ase_builtin` backend so the tests run without CP-PAW. What is under test is the
indexing and the query surface, not the physics.
"""

from pathlib import Path
from unittest.mock import patch

import ase.db
import pytest
from ase.build import bulk, molecule

from atomscope.ase_bridge import from_atoms
from atomscope.backends.registry import default_registry
from atomscope.calculations import CalculationService
from atomscope.jobs import JobManager
from atomscope.project import ProjectStore
from atomscope.project.database import DB_NAME, ProjectDatabase, scalar_values


def _service(tmp_path: Path) -> CalculationService:
    project = ProjectStore.create(tmp_path / "p", "db")
    return CalculationService(project, default_registry(), JobManager())


async def _run(svc: CalculationService, name: str, structure: object, **values: object) -> str:
    svc.project.save_structure(structure)  # type: ignore[arg-type]
    calc = svc.create(
        name=name,
        backend_id="ase_builtin",
        structure=structure,  # type: ignore[arg-type]
        values={"task": "single_point", **values},
    )
    started = svc.run(calc.id)
    assert started.job is not None
    await svc.jobs.wait(started.job.id)
    svc.collect_results(calc.id)
    return calc.id


async def test_finished_calculations_are_selectable_by_element(tmp_path: Path) -> None:
    svc = _service(tmp_path)
    await _run(svc, "water", from_atoms(molecule("H2O"), name="h2o"))
    await _run(svc, "copper", from_atoms(bulk("Cu", cubic=True), name="cu"))
    await _run(svc, "methane", from_atoms(molecule("CH4"), name="ch4"))

    db = ase.db.connect(svc.project.root / DB_NAME)
    assert db.count() == 3
    # ASE's own selection language, which is the point of using ASE's database
    assert {r.name for r in db.select("H")} == {"water", "methane"}
    assert {r.name for r in db.select("Cu")} == {"copper"}
    assert {r.name for r in db.select("C,H")} == {"methane"}
    assert {r.name for r in db.select("natoms=3")} == {"water"}
    # the total energy is on the row as ASE stores energies, so it can be selected on
    assert all(isinstance(r.energy, float) for r in db.select("Cu"))


async def test_parameters_are_queryable_and_results_are_carried(tmp_path: Path) -> None:
    svc = _service(tmp_path)
    await _run(svc, "loose", from_atoms(molecule("H2O"), name="a"), fmax=0.01)
    await _run(svc, "tight", from_atoms(molecule("CH4"), name="b"), fmax=0.5)

    db = ase.db.connect(svc.project.root / DB_NAME)
    assert {r.name for r in db.select(max_steps=200)} == {"loose", "tight"}
    assert {r.name for r in db.select(backend="ase_builtin")} == {"loose", "tight"}
    # data carries what ASE does not index, so a query can be followed by a read
    row = next(iter(db.select(name="tight")))
    assert row.data["values"]["fmax"] == 0.5
    assert "energy" in row.data["properties"]
    assert row.data["properties"]["energy"]["unit"] == "eV"


async def test_collecting_again_replaces_the_row_rather_than_adding_one(tmp_path: Path) -> None:
    svc = _service(tmp_path)
    calc_id = await _run(svc, "water", from_atoms(molecule("H2O"), name="h2o"))

    db = ase.db.connect(svc.project.root / DB_NAME)
    assert db.count() == 1
    first = next(iter(db.select(calculation_id=calc_id))).id

    svc.collect_results(calc_id)  # a parser improvement, a --recollect
    assert db.count() == 1
    assert next(iter(db.select(calculation_id=calc_id))).id != first  # replaced, not merged


async def test_a_forgotten_calculation_leaves_the_database(tmp_path: Path) -> None:
    svc = _service(tmp_path)
    calc_id = await _run(svc, "water", from_atoms(molecule("H2O"), name="h2o"))
    ProjectDatabase(svc.project.root).forget(calc_id)
    assert ase.db.connect(svc.project.root / DB_NAME).count() == 0


async def test_the_database_can_be_rebuilt_from_the_project(tmp_path: Path) -> None:
    """The directories are the source of truth; the database is an index over them.

    This is the path that gives an existing project a database it never had.
    """
    svc = _service(tmp_path)
    await _run(svc, "water", from_atoms(molecule("H2O"), name="h2o"))
    await _run(svc, "copper", from_atoms(bulk("Cu", cubic=True), name="cu"))

    (svc.project.root / DB_NAME).unlink()
    assert svc.reindex() == (2, [])
    assert ase.db.connect(svc.project.root / DB_NAME).count() == 2


async def test_a_draft_is_not_indexed(tmp_path: Path) -> None:
    svc = _service(tmp_path)
    water = from_atoms(molecule("H2O"), name="h2o")
    svc.project.save_structure(water)
    svc.create(name="never run", backend_id="ase_builtin", structure=water, values={})
    assert svc.reindex() == (0, [])
    assert not (svc.project.root / DB_NAME).exists()


@pytest.mark.parametrize(
    ("values", "expected"),
    [
        ({"epwpsi": 30.0, "spin_polarized": False}, {"epwpsi": 30.0, "spin_polarized": False}),
        ({"occupation_states": ""}, {}),  # an empty string is not worth a column
        ({"kpoint_path": [1, 2, 3]}, {}),  # nothing to select on a list with
        ({"nested": {"a": 1}}, {}),
        ({"energy": 1.0, "formula": "X", "calculator": "emt"}, {}),  # ASE keeps these
        ({"2bad": 1, "with-dash": 2}, {}),  # not legal key-value-pair names
    ],
)
def test_only_indexable_parameters_become_columns(
    values: dict[str, object], expected: dict[str, object]
) -> None:
    assert scalar_values(values) == expected


async def test_an_unindexable_calculation_is_reported_not_swallowed(tmp_path: Path) -> None:
    """A parameter ASE keeps for itself must not silently cost the whole row.

    `scalar_values` drops reserved names, so this cannot happen through the normal path; the test
    forces it, because an index quietly missing rows answers a query with the wrong ones.
    """
    svc = _service(tmp_path)
    calc_id = await _run(svc, "water", from_atoms(molecule("H2O"), name="h2o"))

    calc = svc.get(calc_id)
    calc.values["natoms"] = 3  # reserved by ASE, and reserved names are filtered out
    svc.save(calc)
    assert svc.index(calc_id) is None  # so this still succeeds

    with patch("atomscope.project.database.scalar_values", return_value={"natoms": 3}):
        problem = svc.index(calc_id)
    assert problem is not None
    assert "water" in problem and "natoms" in problem
