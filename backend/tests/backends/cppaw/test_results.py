# ruff: noqa: E501, PLC0415
import shutil
from pathlib import Path

import numpy as np
import pytest
from ase.units import Bohr, Hartree

from atomscope.backends.cppaw.results import collect, last_run
from atomscope.backends.cppaw.strc import read_strc_geometry
from atomscope.backends.cppaw.tra import iter_records, read_position_trajectory
from atomscope.model import Atom, Cell, Structure

FIX = Path(__file__).resolve().parents[2] / "fixtures" / "cppaw"


def structure_from_strc(path: Path, symbols: list[str]) -> Structure:
    geo = read_strc_geometry(path.read_text())
    return Structure(
        name=path.stem,
        atoms=[
            Atom(element=s, position=tuple(map(float, p)))
            for s, p in zip(symbols, geo.positions_ang, strict=True)
        ],
        cell=Cell(
            vectors=tuple(tuple(float(x) for x in row) for row in geo.cell_ang),
            pbc=(True, True, True),
        ),
    )


def test_tra_records_h2o() -> None:
    recs = list(iter_records(FIX / "h2o" / "case_r.tra"))
    assert recs and recs[0].istep == 1 and recs[0].data.size == 9 + 8 * 3
    tra = read_position_trajectory(FIX / "h2o" / "case_r.tra", 3)
    assert len(tra.steps) == len(recs)
    geo = read_strc_geometry((FIX / "h2o" / "case.strc").read_text())
    np.testing.assert_allclose(tra.cells_ang[0], geo.cell_ang, atol=1e-4)
    np.testing.assert_allclose(tra.positions_ang[0], geo.positions_ang, atol=0.05)
    assert tra.times_fs[0] > 0 and tra.times_fs[-1] > tra.times_fs[0]


def test_last_run_splits_appended_protocols() -> None:
    text = "PROGRAM STARTED A\nfoo\nPROGRAM STARTED B\nbar\n"
    assert last_run(text).startswith("PROGRAM STARTED B")
    from atomscope.backends.cppaw.results import split_runs

    assert [r.splitlines()[0] for r in split_runs(text)] == [
        "PROGRAM STARTED A",
        "PROGRAM STARTED B",
    ]
    assert split_runs("no marker") == ["no marker"]


def test_collect_si2_rdyn(tmp_path: Path) -> None:
    work = tmp_path / "work"
    shutil.copytree(FIX / "si2_rdyn", work)
    s = structure_from_strc(work / "si2.strc", ["Si", "Si"])
    bundle = collect(work, "si2", s, expect_forces=True, analysis=[])
    assert bundle.final_structure is not None
    assert abs(bundle.properties["energy"].value - (-7.9050265 * Hartree)) < 1e-4
    assert bundle.properties["energy"].unit == "eV"
    forces = bundle.final_structure.atomic_vectors["forces"]
    assert forces.unit == "eV/angstrom"
    # forces are the last ATOMLIST force triple converted from mH/Bohr to eV/Å
    from atomscope.backends.cppaw.protocol import parse_protocol

    last = parse_protocol(work / "si2.prot").final_atom_list.atoms[1].force_mh_per_bohr
    assert abs(forces.values[1][2] - last[2] * 1e-3 * Hartree / Bohr) < 1e-9
    assert any(abs(f) > 0 for v in forces.values for f in v)
    assert bundle.converged is True  # autopilot stop
    assert bundle.trajectory is not None and bundle.trajectory.n_frames > 1
    assert any(s.name == "energy" for s in bundle.series)
    assert "band_gap" in bundle.properties
    assert bundle.final_structure.cell is not None
    assert not [w for w in bundle.warnings if "no forces" in w]


def test_collect_h2o_without_forces(tmp_path: Path) -> None:
    work = tmp_path / "work"
    shutil.copytree(FIX / "h2o", work)
    s = structure_from_strc(work / "case.strc", ["O", "H", "H"])
    s.cell.pbc = (False, False, False)
    bundle = collect(work, "case", s, expect_forces=True, analysis=[])
    assert any("no forces" in w for w in bundle.warnings)
    assert "forces" not in bundle.final_structure.atomic_vectors
    assert bundle.trajectory is not None and bundle.trajectory.symbols == ["O", "H", "H"]
    assert bundle.extra["eigenvalues_ev"][0]["spin"] == 1


def test_collect_missing_protocol(tmp_path: Path) -> None:
    s = Structure(atoms=[Atom(element="H", position=(0, 0, 0))])
    bundle = collect(tmp_path, "case", s, expect_forces=False, analysis=[])
    assert bundle.warnings == ["case.prot not found"]


@pytest.mark.skipif(not (FIX / "h2o" / "case_total_density.cub.gz").exists(), reason="fixture")
def test_collect_reads_cube(tmp_path: Path) -> None:
    import gzip

    work = tmp_path / "work"
    shutil.copytree(FIX / "h2o", work)
    (work / "case_density.cub").write_bytes(
        gzip.decompress((work / "case_total_density.cub.gz").read_bytes())
    )
    s = structure_from_strc(work / "case.strc", ["O", "H", "H"])
    bundle = collect(
        work, "case", s, expect_forces=False, analysis=[("electron_density", "case_density.wv")]
    )
    assert len(bundle.grids) == 1 and bundle.grids[0].kind == "electron_density"
    assert bundle.grids[0].data_ref == "case_density.cub" and bundle.grids[0].shape == (80, 80, 80)


def test_thermostat_friction_series(tmp_path: Path) -> None:
    """The two friction traces the course plots in ch. 5.5 (Figs 5.1, 5.2).

    Both are parsed from the ``!>`` rows; the atom thermostat's is emitted only when it is
    actually doing something, so a wave-function-only run does not gain an all-zero series.
    """
    work = tmp_path / "work"
    shutil.copytree(FIX / "si2_rdyn", work)
    s = structure_from_strc(work / "si2.strc", ["Si", "Si"])
    bundle = collect(work, "si2", s, expect_forces=True, analysis=[])

    from atomscope.backends.cppaw.protocol import parse_protocol

    steps = parse_protocol(work / "si2.prot").steps
    by_name = {series.name: series for series in bundle.series}

    for name, values in (
        ("friction_psi", [step.friction_psi for step in steps]),
        ("friction_atoms", [step.friction_atoms for step in steps]),
    ):
        if any(v != 0.0 for v in values):
            assert by_name[name].y == values
            assert by_name[name].x == [step.time_ps for step in steps]
            assert by_name[name].x_unit == "ps"
        else:
            assert name not in by_name
    # the wave thermostat is always on in these runs, so this one has to be there
    assert "friction_psi" in by_name
