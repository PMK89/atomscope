from __future__ import annotations

import json
import sys
from pathlib import Path

from atomscope.backends.base import (
    BackendCapabilities,
    ExecutableReport,
    GeneratedFile,
    GeneratedInputs,
    Resources,
    ResultBundle,
    Values,
)
from atomscope.jobs.models import RunSpec
from atomscope.model import Structure
from atomscope.schemas import (
    ParameterSchema,
    ParameterSpec,
    Preset,
    Section,
    ValidationIssue,
    ValidationReport,
    VisibleWhen,
    merge_values,
    validate,
)
from atomscope.schemas.engine import Choice
from atomscope.units import Unit

EMT_ELEMENTS = {"Al", "Cu", "Ag", "Au", "Ni", "Pd", "Pt", "H", "C", "N", "O"}

SCHEMA = ParameterSchema(
    id="ase_builtin",
    backend="ase_builtin",
    title="ASE built-in calculators",
    sections=[
        Section(
            id="model",
            label="Model",
            parameters=[
                ParameterSpec(
                    key="calculator",
                    label="Calculator",
                    type="enum",
                    default="emt",
                    choices=[
                        Choice(
                            value="emt",
                            label="EMT (effective medium theory)",
                            help="Al, Cu, Ag, Au, Ni, Pd, Pt (+ H, C, N, O approximate)",
                        ),
                        Choice(value="lj", label="Lennard-Jones"),
                        Choice(value="morse", label="Morse"),
                    ],
                    help="Analytic potentials shipped with ASE; no external program needed.",
                    reference="https://wiki.fysik.dtu.dk/ase/ase/calculators/calculators.html",
                ),
                ParameterSpec(
                    key="lj_epsilon",
                    label="ε",
                    type="number",
                    default=1.0,
                    unit=Unit.EV,
                    minimum=0,
                    exclusive_minimum=True,
                    visible_when=[VisibleWhen(key="calculator", value="lj")],
                ),
                ParameterSpec(
                    key="lj_sigma",
                    label="σ",
                    type="number",
                    default=1.0,
                    unit=Unit.ANGSTROM,
                    minimum=0,
                    exclusive_minimum=True,
                    visible_when=[VisibleWhen(key="calculator", value="lj")],
                ),
                ParameterSpec(
                    key="lj_rc",
                    label="Cutoff",
                    type="number",
                    default=3.0,
                    unit=Unit.ANGSTROM,
                    minimum=0,
                    exclusive_minimum=True,
                    advanced=True,
                    visible_when=[VisibleWhen(key="calculator", value="lj")],
                ),
            ],
        ),
        Section(
            id="task",
            label="Task",
            parameters=[
                ParameterSpec(
                    key="task",
                    label="Task",
                    type="enum",
                    default="single_point",
                    choices=[
                        Choice(value="single_point", label="Single point (energy and forces)"),
                        Choice(value="relax", label="Geometry optimization (BFGS)"),
                        Choice(value="md", label="Molecular dynamics (Langevin)"),
                    ],
                ),
                ParameterSpec(
                    key="fmax",
                    label="Force convergence",
                    type="number",
                    default=0.05,
                    unit=Unit.EV_PER_ANGSTROM,
                    minimum=0,
                    exclusive_minimum=True,
                    visible_when=[VisibleWhen(key="task", value="relax")],
                ),
                ParameterSpec(
                    key="max_steps",
                    label="Maximum steps",
                    type="integer",
                    default=200,
                    minimum=1,
                    visible_when=[VisibleWhen(key="task", op="in", value=["relax", "md"])],
                ),
                ParameterSpec(
                    key="temperature",
                    label="Temperature",
                    type="number",
                    default=300.0,
                    unit=Unit.KELVIN,
                    minimum=0,
                    visible_when=[VisibleWhen(key="task", value="md")],
                ),
                ParameterSpec(
                    key="timestep",
                    label="Time step",
                    type="number",
                    default=1.0,
                    unit=Unit.FEMTOSECOND,
                    minimum=0,
                    exclusive_minimum=True,
                    visible_when=[VisibleWhen(key="task", value="md")],
                ),
                ParameterSpec(
                    key="friction",
                    label="Langevin friction",
                    type="number",
                    default=0.02,
                    minimum=0,
                    advanced=True,
                    help="1/fs",
                    visible_when=[VisibleWhen(key="task", value="md")],
                ),
                ParameterSpec(
                    key="seed",
                    label="Random seed",
                    type="integer",
                    default=42,
                    advanced=True,
                    visible_when=[VisibleWhen(key="task", value="md")],
                ),
            ],
        ),
    ],
)

PRESETS = [
    Preset(
        id="emt_relax",
        name="EMT relaxation",
        schema_id="ase_builtin",
        values={"calculator": "emt", "task": "relax"},
    ),
    Preset(
        id="lj_md",
        name="Lennard-Jones MD",
        schema_id="ase_builtin",
        values={"calculator": "lj", "task": "md", "max_steps": 500},
    ),
]


class AseBuiltinPlugin:
    id = "ase_builtin"
    name = "ASE built-in calculators"
    capabilities = BackendCapabilities(
        energy=True, forces=True, stress=True, relaxation=True, molecular_dynamics=True
    )

    def schema(self) -> ParameterSchema:
        return SCHEMA

    def presets(self) -> list[Preset]:
        return PRESETS

    def discover_executables(self) -> ExecutableReport:
        return ExecutableReport(available=True, executables={"python": sys.executable})

    def validate(self, structure: Structure, values: Values) -> ValidationReport:
        merged = merge_values(SCHEMA, values)
        report = validate(SCHEMA, merged)
        if structure.n_atoms == 0:
            report.issues.append(ValidationIssue(key=None, message="structure has no atoms"))
        if merged.get("calculator") == "emt":
            bad = sorted(set(structure.symbols()) - EMT_ELEMENTS)
            if bad:
                report.issues.append(
                    ValidationIssue(key="calculator", message=f"EMT has no parameters for {bad}")
                )
        return report

    def generate_inputs(
        self, structure: Structure, values: Values, root_name: str
    ) -> GeneratedInputs:
        merged = merge_values(SCHEMA, values)
        payload = {
            "structure": structure.model_dump(mode="json"),
            "parameters": merged,
            "root_name": root_name,
        }
        text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
        return GeneratedInputs(
            files=[GeneratedFile(name=f"{root_name}.json", text=text, role="input")],
            root_name=root_name,
            summary=f"{merged['calculator']} / {merged['task']} on {structure.formula()}",
        )

    def run_spec(
        self, input_dir: Path, work_dir: Path, generated: GeneratedInputs, resources: Resources
    ) -> RunSpec:
        return RunSpec(
            argv=[
                sys.executable,
                "-m",
                "atomscope.backends.ase_builtin.runner",
                str(input_dir / f"{generated.root_name}.json"),
                str(work_dir),
            ],
            cwd=work_dir,
            env={"PYTHONPATH": ":".join(sys.path[1:])} if False else {},
            watch_files=["progress.log"],
            description=generated.summary,
        )

    def parse_results(self, work_dir: Path, generated: GeneratedInputs) -> ResultBundle:
        path = work_dir / "results.json"
        if not path.is_file():
            return ResultBundle(warnings=["results.json not found (job failed or still running)"])
        return ResultBundle.model_validate_json(path.read_text(encoding="utf-8"))


plugin = AseBuiltinPlugin()
