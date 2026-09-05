# ruff: noqa: E501, PLR0912, PLR0915, S603
"""The CP-PAW backend plugin (flagship backend)."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from ase.units import Bohr

from atomscope.backends.base import (
    BackendCapabilities,
    ExecutableReport,
    GeneratedFile,
    GeneratedInputs,
    Resources,
    ResultBundle,
    Values,
)
from atomscope.backends.cppaw import settings as cppaw_settings
from atomscope.backends.cppaw.cntl import analysis_files, cntl_text, force_stage_values
from atomscope.backends.cppaw.results import collect
from atomscope.backends.cppaw.schema import PRESETS, SCHEMA
from atomscope.backends.cppaw.strc import StrcOptions, molecule_box, strc_text
from atomscope.jobs.models import RunSpec
from atomscope.model import Structure
from atomscope.schemas import (
    ParameterSchema,
    Preset,
    ValidationIssue,
    ValidationReport,
    merge_values,
    validate,
)

Vec3 = tuple[float, float, float]


def _v3(row: object) -> Vec3:
    seq = list(row)  # type: ignore[call-overload]
    return (float(seq[0]), float(seq[1]), float(seq[2]))


class CppawPlugin:
    id = "cppaw"
    name = "CP-PAW"
    capabilities = BackendCapabilities(
        energy=True,
        forces=True,
        relaxation=True,
        molecular_dynamics=True,
        orbitals=True,
        density=True,
        dos=True,
        bands=True,
        periodic=True,
        molecular=True,
    )

    def __init__(self, settings: cppaw_settings.CppawSettings | None = None) -> None:
        self.settings = settings or cppaw_settings.CppawSettings.from_env()
        self.health: cppaw_settings.HealthReport | None = None

    def schema(self) -> ParameterSchema:
        return SCHEMA

    def presets(self) -> list[Preset]:
        return PRESETS

    def discover_executables(self) -> ExecutableReport:
        report = cppaw_settings.discover(self.settings)
        if self.health is not None:
            report.messages.append(
                ("healthy: " if self.health.ok else "unhealthy: ") + self.health.message
            )
        return report

    def restart_values(self, values: Values) -> Values:
        """Values for a calculation continuing from a copied restart file."""
        out = dict(values)
        if out.get("start") not in ("restart", "restart_new_structure"):
            out["start"] = "restart"
        return out

    def restart_files(self, generated: GeneratedInputs) -> list[str]:
        """Glob patterns (relative to work/) copied when continuing from a previous run."""
        return [f"{generated.root_name}.rstrt"]

    def health_check(self) -> cppaw_settings.HealthReport:
        self.health = cppaw_settings.health_check(self.settings)
        return self.health

    # ---- validation --------------------------------------------------------------------------
    def validate(self, structure: Structure, values: Values) -> ValidationReport:
        merged = merge_values(SCHEMA, values)
        report = validate(SCHEMA, merged)
        if structure.n_atoms == 0:
            report.issues.append(ValidationIssue(key=None, message="structure has no atoms"))
        if (
            merged.get("kpoint_mode") != "gamma"
            and not structure.is_periodic()
            and merged.get("kpoint_mode") == "grid"
        ):
            report.issues.append(
                ValidationIssue(
                    key="kpoint_mode",
                    message="k-point grids need a periodic cell",
                    severity="warning",
                )
            )
        if merged.get("write_spin_density") and not merged.get("spin_polarized"):
            report.issues.append(
                ValidationIssue(
                    key="write_spin_density",
                    message="requires a spin-polarized calculation",
                    severity="warning",
                )
            )
        if merged.get("occupations") == "mermin" and merged.get("safeortho"):
            report.issues.append(
                ValidationIssue(
                    key="safeortho",
                    message="Mermin occupations require SAFEORTHO=F (will be forced off)",
                    severity="warning",
                )
            )
        if merged.get("task") == "md" and merged.get("start") == "scratch":
            report.issues.append(
                ValidationIssue(
                    key="start",
                    message="MD from random wave functions is unphysical; converge the electrons first and start from the restart file",
                    severity="warning",
                )
            )
        return report

    # ---- inputs --------------------------------------------------------------------------------
    def generate_inputs(
        self, structure: Structure, values: Values, root_name: str
    ) -> GeneratedInputs:
        merged = merge_values(SCHEMA, values)
        opts = StrcOptions.from_values(merged)
        strc = strc_text(structure, opts)
        task = merged.get("task")
        files = [GeneratedFile(name=f"{root_name}.strc", text=strc, role="structure")]
        if task == "forces":
            # Two stages: converge the electrons, then a few damped atomic steps for forces.
            files.append(
                GeneratedFile(
                    name=f"{root_name}.stage1.cntl",
                    text=cntl_text(root_name, merged),
                    role="control",
                )
            )
            files.append(
                GeneratedFile(
                    name=f"{root_name}.stage2.cntl",
                    text=cntl_text(root_name, force_stage_values(merged)),
                    role="control",
                )
            )
        else:
            files.append(
                GeneratedFile(
                    name=f"{root_name}.cntl", text=cntl_text(root_name, merged), role="control"
                )
            )
        summary = f"CP-PAW {task} on {structure.formula()} ({'periodic' if structure.is_periodic() else 'molecule'})"
        return GeneratedInputs(files=files, root_name=root_name, summary=summary)

    def _structure_from_inputs(self, input_dir: Path) -> Structure:
        return Structure.model_validate_json(
            (input_dir / "structure.json").read_text(encoding="utf-8")
        )

    def run_spec(
        self, input_dir: Path, work_dir: Path, generated: GeneratedInputs, resources: Resources
    ) -> RunSpec:
        exe = self.settings.find(cppaw_settings.MAIN_EXE)
        if exe is None:
            msg = "paw_fast.x not found"
            raise FileNotFoundError(msg)
        if not self.settings.runtime_verified:
            problem = cppaw_settings.ensure_runtime(self.settings)
            if problem:
                raise RuntimeError(problem)
        structure = self._structure_from_inputs(input_dir)
        values = self._values_from_inputs(input_dir)
        argv = [
            sys.executable,
            "-m",
            "atomscope.backends.cppaw.runner",
            str(work_dir),
            generated.root_name,
            str(exe),
        ]
        wave = self.settings.find("paw_wave.x")
        analysis = analysis_files(generated.root_name, values)
        if wave is not None and analysis:
            argv += ["--wave", str(wave)]
            for kind, fname in analysis:
                argv += ["--cube", f"{kind}={fname}"]
            origin, vectors = self._view_box(structure, values)
            argv += [
                "--box",
                *[f"{x:.6f}" for x in origin],
                *[f"{x:.6f}" for row in vectors for x in row],
            ]
        env = self.settings.env()
        if resources.cores > 1:
            env["OMP_NUM_THREADS"] = "1"
        return RunSpec(
            argv=argv,
            cwd=work_dir,
            env=env,
            stdout_name="driver.log",
            stderr_name="driver.err",
            watch_files=[f"{generated.root_name}.prot"],
            description=generated.summary,
            soft_stop_seconds=120.0,  # runner touches ROOT.exit and waits for PROGRAM FINISHED
        )

    def _values_from_inputs(self, input_dir: Path) -> Values:
        import json  # noqa: PLC0415

        path = input_dir / "values.json"
        if path.is_file():
            values: Values = json.loads(path.read_text(encoding="utf-8"))
            return merge_values(SCHEMA, values)
        return merge_values(SCHEMA, {})

    def _view_box(
        self, structure: Structure, values: Values
    ) -> tuple[Vec3, tuple[Vec3, Vec3, Vec3]]:
        """View box (Bohr): the full cell (three edge vectors) for periodic systems, the
        molecule bounding box plus margin otherwise."""
        if structure.is_periodic() and structure.cell is not None:
            m = np.array(structure.cell.vectors) / Bohr
            return (0.0, 0.0, 0.0), (_v3(m[0]), _v3(m[1]), _v3(m[2]))
        margin = float(values.get("box_margin", 4.0))  # type: ignore[arg-type]
        pos = structure.positions()
        lo = (pos.min(axis=0) - margin) / Bohr
        cell = molecule_box(structure, margin)
        v = np.array(cell.vectors) / Bohr
        return (float(lo[0]), float(lo[1]), float(lo[2])), (_v3(v[0]), _v3(v[1]), _v3(v[2]))

    def diagnose_failure(self, work_dir: Path, root_name: str) -> str | None:
        """Called by the calculation service when a job fails; returns a human explanation."""
        text = ""
        for name in (f"{root_name}.out", "driver.log", "driver.err"):
            p = work_dir / name
            if p.is_file():
                text += p.read_text(errors="replace")[-20000:]
        return cppaw_settings.diagnose_output(text)

    # ---- results -------------------------------------------------------------------------------
    def parse_results(self, work_dir: Path, generated: GeneratedInputs) -> ResultBundle:
        input_dir = work_dir.parent / "input"
        structure = self._structure_from_inputs(input_dir)
        values = self._values_from_inputs(input_dir)
        task = str(values.get("task", "single_point"))
        return collect(
            work_dir,
            generated.root_name,
            structure,
            expect_forces=task in ("forces", "relax", "md"),
            analysis=analysis_files(generated.root_name, values),
            forces_at_input_geometry=task == "forces",
        )


plugin = CppawPlugin()
