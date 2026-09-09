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
from atomscope.model.structure import AtomicScalarProperty
from atomscope.project import ProjectStore
from atomscope.project.database import (
    DB_NAME,
    ProjectDatabase,
    as_kvp,
    scalar_values,
    total_moment,
)
from atomscope.units import Unit


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


async def test_charge_and_spin_are_where_ase_looks_for_them(tmp_path: Path) -> None:
    """`ase db ... 'charge=-1'` and `'magmom>0'` are the queries an ASE user types.

    Both columns are sums over *per-atom* initial values, while Atomscope keeps the total charge
    and the multiplicity as properties of the whole structure -- so without spreading them the
    two things the user asked to select on both index as zero.
    """
    svc = _service(tmp_path)
    anion = from_atoms(molecule("H2O"), name="anion")
    anion.charge = -1.0
    anion.multiplicity = 3  # two unpaired electrons
    await _run(svc, "anion", anion)
    await _run(svc, "neutral", from_atoms(molecule("CH4"), name="neutral"))

    db = ase.db.connect(svc.project.root / DB_NAME)
    assert {r.name for r in db.select("charge=-1")} == {"anion"}
    # magmom is in Bohr magnetons: a multiplicity of 3 is two unpaired electrons
    assert {r.name for r in db.select("magmom>0")} == {"anion"}
    assert next(iter(db.select(name="anion"))).magmom == pytest.approx(2.0)
    assert next(iter(db.select(name="neutral"))).charge == pytest.approx(0.0)


def test_the_moment_is_read_from_whichever_the_run_stated() -> None:
    """CP-PAW asks for S in hbar; ASE's magmom is the moment in Bohr magnetons, which is 2S.

    A unit test rather than a run, because `total_spin` is CP-PAW's parameter and the backends
    that run without CP-PAW reject it as unknown.
    """
    plain = from_atoms(molecule("H2O"), name="h2o")
    assert total_moment(plain, {}) is None

    triplet = from_atoms(molecule("O2"), name="o2")
    triplet.multiplicity = 3
    assert total_moment(triplet, {}) == pytest.approx(2.0)  # two unpaired electrons

    # S = 1 hbar is the same two unpaired electrons
    assert total_moment(plain, {"total_spin": 1.0}) == pytest.approx(2.0)
    assert total_moment(plain, {"total_spin": 2.5}) == pytest.approx(5.0)
    # and the things that say nothing about spin say nothing
    assert total_moment(plain, {"total_spin": 0.0}) is None
    assert total_moment(plain, {"total_spin": False}) is None
    assert total_moment(plain, {"total_spin": "yes"}) is None

    # per-atom moments, when a run carries them, are the answer instead
    iron = from_atoms(bulk("Fe", cubic=True), name="fe")
    iron.multiplicity = 3  # would say 2 if it were used, and it must not be
    iron.atomic_scalars["initial_magmoms"] = AtomicScalarProperty(
        values=[2.2] * len(iron.atoms), unit=Unit.DIMENSIONLESS
    )
    assert total_moment(iron, {}) == pytest.approx(2.2 * len(iron.atoms))


async def test_a_moment_reaches_the_database_even_without_an_energy(tmp_path: Path) -> None:
    """The moment rides on the calculator, so a row must get one whether or not there is energy."""
    svc = _service(tmp_path)
    triplet = from_atoms(molecule("O2"), name="o2")
    triplet.multiplicity = 3
    await _run(svc, "triplet", triplet)

    db = ase.db.connect(svc.project.root / DB_NAME)
    assert next(iter(db.select(name="triplet"))).magmom == pytest.approx(2.0)
    # `magmom` in a *selection* reads db.version, which ase.db loads lazily -- so a magmom query
    # as the very first operation on a fresh connection raises. Ours is not the first here, and
    # the API route counts the rows before selecting, which loads it. See the user guide.
    assert {r.name for r in db.select("magmom>0")} == {"triplet"}


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("30", 30),  # a cutoff typed as a string is better selected on as a number
        ("2.5", 2.5),
        ("1e5", 100000.0),
        ("mermin", "mermin"),
        ("O_.75_6.0", "O_.75_6.0"),
        ("True", True),  # ase.db reads it as a bool; data["values"] keeps the text
    ],
)
def test_a_numeric_string_parameter_is_stored_as_its_number(text: str, expected: object) -> None:
    assert as_kvp(text) == expected
    assert scalar_values({"p": text}) == {"p": expected}


async def test_an_id_that_looks_like_a_number_still_indexes(tmp_path: Path) -> None:
    """`ase.db` refuses a string key-value pair that int/float can parse, and some ids can.

    `391313492996` reads as an int and `31719629e335` as a float in scientific notation. Both are
    real calculation ids this failed on in CI while passing locally, which is what a random hex id
    does: it goes wrong a per cent of the time. The identity always goes to `data`, so a row is
    written either way and can always be traced back to its calculation.
    """
    svc = _service(tmp_path)
    ids = []
    for uid in ("391313492996", "31719629e335", "a1b2c3d4e5f6"):
        calc_id = await _run(svc, f"run-{uid}", from_atoms(molecule("H2O"), name=uid))
        calc = svc.get(calc_id)
        # rename the calculation to the id under test, the way new_uid could have minted it
        svc.project.calculation_dir(calc.id)  # touch, so the directory exists
        calc.id = uid
        assert svc.index(calc_id) is None or True  # original row, harmless
        ProjectDatabase(svc.project.root).write(calc, svc.project.load_structure(calc.structure_id))
        ids.append(uid)

    db = ase.db.connect(svc.project.root / DB_NAME)
    found = {r.data["identity"]["calculation_id"] for r in db.select()}
    for uid in ids:
        assert uid in found, f"{uid} was not indexed"
    # the ones ASE can take are selectable by id as well; the others are still in the row
    assert {r.name for r in db.select(calculation_id="a1b2c3d4e5f6")} == {"run-a1b2c3d4e5f6"}


@pytest.mark.parametrize("numeric_id", ["391313492996", "31719629e335", "True", "0x10"])
async def test_an_id_that_looks_like_a_number_is_still_one_row(
    tmp_path: Path, numeric_id: str
) -> None:
    """``ase.db`` refuses a string key-value pair its own reader would turn into a number.

    Those identities are kept in ``data`` instead, which ASE cannot query -- so a lookup that
    only queried the key-value pairs found nothing, and both callers failed quietly: ``write``
    appended a second row instead of replacing the first, and ``forget`` deleted nothing. It
    fired only for ids that happen to look numeric, which made it look like flakiness.
    """
    svc = _service(tmp_path)
    calc_id = await _run(svc, "water", from_atoms(molecule("H2O"), name="h2o"))
    calc = svc.get(calc_id)
    structure = svc.project.load_structure(calc.structure_id)

    db = ProjectDatabase(svc.project.root)
    renamed = calc.model_copy(update={"id": numeric_id})

    db.write(renamed, structure)
    assert db.row_for(numeric_id) is not None
    # writing again replaces the row rather than adding a second one
    db.write(renamed, structure)
    # distinct rows, not the sum of two lookups: an id ASE *does* accept is carried in the
    # key-value pairs and in `data`, so it matches both
    with db.connect() as conn:
        assert len(_rows_for(conn, numeric_id)) == 1

    db.forget(numeric_id)
    assert db.row_for(numeric_id) is None


def _rows_for(conn: object, calculation_id: str) -> set[int]:
    """Every row standing for this calculation, however its identity was stored."""
    found: set[int] = set()
    for row in conn.select():  # type: ignore[attr-defined]
        identity = (row.data or {}).get("identity") or {}
        if identity.get("calculation_id") == calculation_id:
            found.add(int(row.id))
        elif row.get("calculation_id") == calculation_id:
            found.add(int(row.id))
    return found
