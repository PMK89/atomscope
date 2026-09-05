from pathlib import Path

import numpy as np
import pytest
from ase.build import bulk

from atomscope.ase_bridge.cppaw_calculator import CppawCalculator
from atomscope.backends.cppaw import plugin


@pytest.mark.cppaw
def test_cppaw_calculator_energy_forces_and_restart(tmp_path: Path) -> None:
    if not plugin.discover_executables().available:
        pytest.skip("paw_fast.x not found")
    atoms = bulk("Si")
    atoms.positions[1] += [0.05, 0.0, 0.0]  # break symmetry so forces are non-zero
    calc = CppawCalculator(
        tmp_path / "calc",
        values={"kpoint_r": 8.0, "empty_bands": 2, "nstep": 400, "force_steps": 3, "epwpsi": 25.0},
        timeout=600,
    )
    atoms.calc = calc
    e0 = atoms.get_potential_energy()
    f0 = atoms.get_forces()
    assert -8.0 * 27.2 < e0 < -7.0 * 27.2
    assert f0.shape == (2, 3) and np.abs(f0).max() > 1e-3
    # Converged electrons: net force small (egg-box effects and 0.01 mH/Bohr print precision)
    assert np.abs(f0.sum(axis=0)).max() < 0.05
    assert not [w for w in calc.last_warnings if "unconverged" in w]
    # second geometry reuses the restart file
    atoms.positions[1] -= [0.02, 0.0, 0.0]
    e1 = atoms.get_potential_energy()
    assert (tmp_path / "calc" / "step_0001" / "case.rstrt").exists()
    assert "NEWSTRC=T" in (tmp_path / "calc" / "step_0001" / "case.stage1.cntl").read_text()
    assert abs(e1 - e0) < 1.0
    assert len(calc.history) == 2
