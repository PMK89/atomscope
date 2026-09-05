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
from atomscope.chem.forcefield import FORCE_FIELD_CANDIDATES, FFConstraint, available_force_fields
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

_FF_HELP = {
    "MMFF94": "Merck molecular force field (organic molecules, kcal/mol)",
    "MMFF94s": "MMFF94 static variant (planar N geometries)",
    "UFF": "Universal force field (whole periodic table, kJ/mol)",
    "GAFF": "General AMBER force field",
    "Ghemical": "Ghemical force field (historical)",
}


def _force_field_choices() -> list[Choice]:
    names = available_force_fields() or list(FORCE_FIELD_CANDIDATES)
    return [Choice(value=n, label=n, help=_FF_HELP.get(n, "")) for n in names]


SCHEMA = ParameterSchema(
    id="openbabel_ff",
    backend="openbabel_ff",
    title="Open Babel force fields",
    sections=[
        Section(
            id="model",
            label="Force field",
            parameters=[
                ParameterSpec(
                    key="force_field",
                    label="Force field",
                    type="enum",
                    default="MMFF94",
                    choices=_force_field_choices(),
                    help="Discovered from the Open Babel plugin list at startup.",
                    reference="https://open-babel.readthedocs.io/en/latest/Forcefields/Overview.html",
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
                    default="optimize",
                    choices=[
                        Choice(value="single_point", label="Calculate energy (and forces)"),
                        Choice(value="optimize", label="Optimize geometry"),
                        Choice(value="conformer_search", label="Conformer search"),
                    ],
                ),
                ParameterSpec(
                    key="algorithm",
                    label="Algorithm",
                    type="enum",
                    default="steepest_descent",
                    choices=[
                        Choice(value="steepest_descent", label="Steepest descent"),
                        Choice(value="conjugate_gradients", label="Conjugate gradients"),
                    ],
                    visible_when=[VisibleWhen(key="task", value="optimize")],
                ),
                ParameterSpec(
                    key="max_steps",
                    label="Number of steps",
                    type="integer",
                    default=500,
                    minimum=1,
                    visible_when=[VisibleWhen(key="task", value="optimize")],
                ),
                ParameterSpec(
                    key="convergence",
                    label="Convergence (energy change)",
                    type="number",
                    default=1e-6,
                    minimum=0,
                    exclusive_minimum=True,
                    help="in the force field's own unit",
                    visible_when=[VisibleWhen(key="task", value="optimize")],
                ),
                ParameterSpec(
                    key="record_every",
                    label="Record a frame every N steps",
                    type="integer",
                    default=10,
                    minimum=1,
                    advanced=True,
                    visible_when=[VisibleWhen(key="task", value="optimize")],
                ),
                ParameterSpec(
                    key="conformer_method",
                    label="Search method",
                    type="enum",
                    default="weighted",
                    choices=[
                        Choice(value="systematic", label="Systematic rotor search"),
                        Choice(value="random", label="Random rotor search"),
                        Choice(value="weighted", label="Weighted rotor search"),
                    ],
                    visible_when=[VisibleWhen(key="task", value="conformer_search")],
                ),
                ParameterSpec(
                    key="n_conformers",
                    label="Number of conformers",
                    type="integer",
                    default=10,
                    minimum=1,
                    help="random / weighted searches",
                    visible_when=[VisibleWhen(key="task", value="conformer_search")],
                ),
                ParameterSpec(
                    key="conformer_steps",
                    label="Optimization steps per conformer",
                    type="integer",
                    default=100,
                    minimum=1,
                    visible_when=[VisibleWhen(key="task", value="conformer_search")],
                ),
                ParameterSpec(
                    key="constraints_json",
                    label="Extra constraints (JSON)",
                    type="text",
                    default="",
                    advanced=True,
                    help='[{"kind": "distance", "atoms": [0, 1], "value": 1.5}, ...]; '
                    "fixed atoms of the structure are always honoured",
                ),
            ],
        ),
    ],
)

PRESETS = [
    Preset(
        id="mmff94_optimize",
        name="MMFF94 optimization",
        schema_id="openbabel_ff",
        values={"force_field": "MMFF94", "task": "optimize"},
    ),
    Preset(
        id="uff_optimize",
        name="UFF optimization",
        schema_id="openbabel_ff",
        values={"force_field": "UFF", "task": "optimize", "algorithm": "conjugate_gradients"},
    ),
    Preset(
        id="mmff94_conformers",
        name="MMFF94 conformer search",
        schema_id="openbabel_ff",
        values={"force_field": "MMFF94", "task": "conformer_search"},
    ),
]


def parse_constraints(text: object) -> list[FFConstraint]:
    if not isinstance(text, str) or not text.strip():
        return []
    data = json.loads(text)
    if not isinstance(data, list):
        raise ValueError("constraints_json must be a JSON list")
    return [FFConstraint.model_validate(c) for c in data]


class OpenBabelFFPlugin:
    id = "openbabel_ff"
    name = "Open Babel force fields"
    capabilities = BackendCapabilities(
        energy=True, forces=True, relaxation=True, periodic=False, molecular=True
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
        if structure.is_periodic():
            report.issues.append(
                ValidationIssue(
                    key=None,
                    message="Open Babel force fields ignore the periodic cell",
                    severity="warning",
                )
            )
        if not structure.bonds and structure.n_atoms > 1:
            report.issues.append(
                ValidationIssue(
                    key=None,
                    message="structure has no bonds; atom typing needs connectivity",
                    severity="warning",
                )
            )
        try:
            parse_constraints(merged.get("constraints_json"))
        except (ValueError, TypeError) as exc:
            report.issues.append(ValidationIssue(key="constraints_json", message=str(exc)))
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
            summary=f"{merged['force_field']} / {merged['task']} on {structure.formula()}",
        )

    def run_spec(
        self, input_dir: Path, work_dir: Path, generated: GeneratedInputs, resources: Resources
    ) -> RunSpec:
        return RunSpec(
            argv=[
                sys.executable,
                "-m",
                "atomscope.backends.openbabel_ff.runner",
                str(input_dir / f"{generated.root_name}.json"),
                str(work_dir),
            ],
            cwd=work_dir,
            watch_files=["progress.log"],
            description=generated.summary,
        )

    def parse_results(self, work_dir: Path, generated: GeneratedInputs) -> ResultBundle:
        path = work_dir / "results.json"
        if not path.is_file():
            return ResultBundle(warnings=["results.json not found (job failed or still running)"])
        return ResultBundle.model_validate_json(path.read_text(encoding="utf-8"))


plugin = OpenBabelFFPlugin()
