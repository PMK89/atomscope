from pathlib import Path

import pytest

from atomscope.io.qc_outputs import detect_output_format, read_output

FIX = Path(__file__).resolve().parents[1] / "fixtures" / "qc_outputs"


def test_gaussian_benzene() -> None:
    out = read_output(FIX / "benzene.g03")
    assert out.program_format == "gaussian-out"
    assert out.structure.formula() == "C6H6"
    assert "energy" in out.structure.properties and out.structure.properties["energy"].unit == "eV"
    assert "forces" in out.structure.atomic_vectors
    assert len(out.structure.bonds) == 12


def test_gaussian_methane_optimization_has_trajectory() -> None:
    out = read_output(FIX / "methane.g03")
    assert out.structure.formula() == "CH4"
    if out.n_frames > 1:
        assert out.trajectory is not None and out.trajectory.n_frames == out.n_frames


def test_nwchem_methane() -> None:
    out = read_output(FIX / "methane.nwo")
    assert out.program_format == "nwchem-out" and out.structure.formula() == "CH4"


def test_detection_by_content(tmp_path: Path) -> None:
    p = tmp_path / "weird.txt"
    p.write_text((FIX / "benzene.g03").read_text()[:5000])
    assert detect_output_format(p) == "gaussian-out"
    (tmp_path / "x.txt").write_text("nothing here")
    with pytest.raises(ValueError, match="cannot determine"):
        detect_output_format(tmp_path / "x.txt")
