# ruff: noqa: S603
"""ASE calculator that obtains energy and forces from CP-PAW.

Each ``calculate`` call runs one CP-PAW "forces" job (wave-function optimization followed by a
few damped atomic steps, since CP-PAW prints forces only while atoms are propagated) in its own
sub-directory. From the second call on, the previous restart file is reused with
``START=F NEWSTRC=T`` so the electrons start from the converged wave functions of the last
geometry, which is how the CP-PAW course chains stages. Forces come from the last ATOMLIST
report (printed to 0.01 mH/Bohr ≈ 5e-4 eV/Å): adequate for optimizers with fmax ≥ 0.01 eV/Å.

This replaces the historical ``asecppaw`` calculator (shell strings, silent zero forces) with
an implementation on the modern plugin (`atomscope.backends.cppaw`).
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any

import numpy as np
from ase import Atoms
from ase.calculators.calculator import CalculationFailed, Calculator, all_changes

from atomscope.ase_bridge.convert import from_atoms
from atomscope.backends.cppaw import settings as cppaw_settings
from atomscope.backends.cppaw.cntl import cntl_text, force_stage_values
from atomscope.backends.cppaw.plugin import CppawPlugin
from atomscope.backends.cppaw.results import collect
from atomscope.backends.cppaw.schema import SCHEMA
from atomscope.backends.cppaw.strc import StrcOptions, strc_text
from atomscope.jobs.manager import build_env
from atomscope.schemas import merge_values


class CppawCalculator(Calculator):
    implemented_properties = ["energy", "forces"]  # noqa: RUF012

    def __init__(
        self,
        workdir: Path,
        values: dict[str, object] | None = None,
        *,
        settings: cppaw_settings.CppawSettings | None = None,
        timeout: float | None = None,
        keep_history: bool = True,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self.workdir = Path(workdir)
        self.workdir.mkdir(parents=True, exist_ok=True)
        self.plugin = CppawPlugin(settings)
        self.values: dict[str, object] = merge_values(SCHEMA, {"task": "forces"}, values or {})
        self.values["task"] = "forces"
        self.timeout = timeout
        self.keep_history = keep_history
        self.step = 0
        self.last_dir: Path | None = None
        self.history: list[dict[str, float]] = []
        self.last_warnings: list[str] = []

    def _prepare(self) -> None:
        if not self.plugin.settings.runtime_verified:
            problem = cppaw_settings.ensure_runtime(self.plugin.settings)
            if problem:
                raise CalculationFailed(problem)

    def calculate(
        self,
        atoms: Atoms | None = None,
        properties: list[str] | None = None,
        system_changes: list[str] = all_changes,
    ) -> None:
        super().calculate(atoms, properties or ["energy"], system_changes)
        assert self.atoms is not None  # noqa: S101
        self._prepare()
        exe = self.plugin.settings.find(cppaw_settings.MAIN_EXE)
        if exe is None:
            raise CalculationFailed("paw_fast.x not found")
        structure = from_atoms(self.atoms)
        step_dir = self.workdir / f"step_{self.step:04d}"
        step_dir.mkdir(exist_ok=True)
        values = dict(self.values)
        if self.last_dir is not None and (self.last_dir / "case.rstrt").is_file():
            shutil.copy2(self.last_dir / "case.rstrt", step_dir / "case.rstrt")
            values["start"] = "restart_new_structure"
        else:
            values["start"] = "scratch"
        (step_dir / "case.strc").write_text(strc_text(structure, StrcOptions.from_values(values)))
        env = build_env(self.plugin.settings.env())
        # stage 1: converge the electrons; stage 2: a few damped atomic steps to obtain forces
        for i, stage_values in enumerate((values, force_stage_values(values)), start=1):
            text = cntl_text("case", stage_values)
            (step_dir / f"case.stage{i}.cntl").write_text(text)  # provenance copy
            (step_dir / "case.cntl").write_text(text)
            with (step_dir / "case.out").open("ab") as out:
                proc = subprocess.run(
                    [str(exe), "case.cntl"],
                    cwd=step_dir,
                    env=env,
                    stdout=out,
                    stderr=subprocess.STDOUT,
                    timeout=self.timeout,
                    check=False,
                )
            if proc.returncode != 0:
                text = (step_dir / "case.out").read_text(errors="replace")
                hint = cppaw_settings.diagnose_output(text) or ""
                raise CalculationFailed(
                    f"CP-PAW exited with code {proc.returncode} in {step_dir}: {hint}"
                )
        bundle = collect(
            step_dir,
            "case",
            structure,
            expect_forces=True,
            analysis=[],
            forces_at_input_geometry=True,
        )
        self.last_warnings = list(bundle.warnings)
        final = bundle.final_structure
        if (
            final is None
            or "forces" not in final.atomic_vectors
            or "energy" not in bundle.properties
        ):
            raise CalculationFailed(f"no energy/forces in {step_dir}: {bundle.warnings}")
        energy = bundle.properties["energy"].value
        forces = np.array(final.atomic_vectors["forces"].values, dtype=float)
        self.results = {"energy": energy, "forces": forces}
        self.history.append(
            {
                "step": float(self.step),
                "energy": energy,
                "fmax": float(np.sqrt((forces**2).sum(axis=1).max())),
            }
        )
        if not self.keep_history and self.last_dir is not None:
            shutil.rmtree(self.last_dir, ignore_errors=True)
        self.last_dir = step_dir
        self.step += 1
