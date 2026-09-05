import gzip
import shutil
from pathlib import Path

import numpy as np
import pytest

from atomscope.backends.base import ResultBundle
from atomscope.calculations.grids import (
    compute_stats,
    find_grid,
    import_cube,
    list_grids,
    load_values,
    materialize_grids,
)
from atomscope.calculations.models import Calculation
from atomscope.calculations.service import CalculationService
from atomscope.jobs import JobManager
from atomscope.model import VolumetricGrid, new_uid
from atomscope.parsers.cube import read_cube
from atomscope.project import ProjectStore
from atomscope.units import Unit

FIX = Path(__file__).resolve().parents[1] / "fixtures" / "cppaw" / "h2o"
CUBE_GZ = FIX / "case_total_density.cub.gz"


def gunzip(target: Path) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(CUBE_GZ, "rb") as src, target.open("wb") as dst:
        shutil.copyfileobj(src, dst)
    return target


def test_materialize_grids_writes_float32_sidecar(tmp_path: Path) -> None:
    project = ProjectStore.create(tmp_path / "p", "demo")
    calc_dir = project.register_calculation("calc1")
    work = calc_dir / "work"
    gunzip(work / "case_total_density.cub")
    data = read_cube(work / "case_total_density.cub", kind="electron_density")
    grid = data.grid
    grid.data_ref = "case_total_density.cub"
    missing = grid.model_copy(update={"id": new_uid(), "data_ref": "nope.cub"})
    bundle = ResultBundle(grids=[grid, missing])

    materialize_grids(bundle, work, "calc1", project)

    assert [g.id for g in bundle.grids] == [grid.id]
    assert any("nope.cub" in w for w in bundle.warnings)
    assert grid.data_ref == f"calculations/calc1/results/{grid.id}.f32"
    assert grid.dtype == "float32"
    sidecar = project.root / grid.data_ref
    assert sidecar.stat().st_size == 80 * 80 * 80 * 4
    assert (work / "case_total_density.cub").is_file()  # cube kept in work/
    back = load_values(project, grid)
    assert back.shape == (80, 80, 80)
    np.testing.assert_allclose(back, data.values, rtol=1e-6)
    # C order: the raw bytes are the float32 values in shape order
    raw = np.fromfile(sidecar, dtype="<f4")
    np.testing.assert_allclose(raw.reshape(80, 80, 80), data.values, rtol=1e-6)


def test_import_cube_dataset_and_lookup(tmp_path: Path) -> None:
    project = ProjectStore.create(tmp_path / "p", "demo")
    grid, structure = import_cube(project, CUBE_GZ, kind="electron_density")
    assert grid.data_ref == f"datasets/{grid.id}.f32"
    assert (project.root / grid.data_ref).stat().st_size == 80**3 * 4
    assert project.manifest.dataset_ids == [grid.id]
    assert structure.n_atoms == 27 and structure.id in project.manifest.structure_ids
    assert grid.structure_id == structure.id
    reopened = ProjectStore.open(tmp_path / "p")
    assert reopened.load_dataset(grid.id) == grid
    assert find_grid(reopened, [], grid.id) is not None
    assert find_grid(reopened, [], "missing") is None


def test_lookup_across_calculations(tmp_path: Path) -> None:
    project = ProjectStore.create(tmp_path / "p", "demo")
    svc = CalculationService(project, None, JobManager())  # type: ignore[arg-type]
    grid = VolumetricGrid(
        id="g1",
        name="d",
        kind="electron_density",
        origin=(0, 0, 0),
        axes=((1, 0, 0), (0, 1, 0), (0, 0, 1)),
        shape=(2, 2, 2),
        unit=Unit.E_PER_BOHR3,
        inline_values=[0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0],
    )
    calc = Calculation(
        name="c", backend_id="x", structure_id="s", results=ResultBundle(grids=[grid])
    )
    svc.save(calc)
    refs = list_grids(project, svc.list())
    assert [(r.grid.id, r.calculation_id) for r in refs] == [("g1", calc.id)]
    np.testing.assert_array_equal(load_values(project, grid).reshape(-1), np.arange(8))


def test_stats_rules() -> None:
    density = np.zeros((4, 4, 4))
    density[1, 1, 1] = 100.0  # cusp
    density[2, 2, 2] = 10.0
    density[3, 3, 3] = 5.0
    s = compute_stats(density, "electron_density")
    assert s.max == 100.0 and s.min == 0.0 and not s.has_negative
    assert s.abs_max == 100.0
    # 80 % of 115 = 92 is reached by the cusp alone: the isovalue is the cusp value
    assert s.suggested_isovalue == 100.0
    assert "80%" in s.rule
    orbital = np.linspace(-0.2, 0.3, 27).reshape(3, 3, 3)
    o = compute_stats(orbital, "orbital")
    assert o.has_negative and o.suggested_isovalue == pytest.approx(0.05)
    small = compute_stats(orbital * 0.1, "orbital")
    assert small.suggested_isovalue == pytest.approx(0.015)


def test_stats_of_fixture() -> None:
    data = read_cube(CUBE_GZ, kind="electron_density")
    s = compute_stats(data.values, "electron_density")
    assert s.min >= -1e-6 and s.max > s.suggested_isovalue > 0
    assert s.mean == pytest.approx(float(data.values.mean()))
