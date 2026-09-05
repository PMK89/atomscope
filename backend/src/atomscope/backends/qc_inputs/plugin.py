# ruff: noqa: E501, PLR0912, PLR0915
"""Quantum-chemistry input generators (Avogadro 1 "Input generators" equivalent).

Generates ready-to-run input decks for ORCA, Gaussian, NWChem, GAMESS-US, Quantum ESPRESSO and
ABINIT using ASE's ``ase.io`` writers. The plugin does not execute anything
(``capabilities.executes = False``); the generated files are stored with the calculation so the
user can run them elsewhere. Executing these codes through ASE calculators is a natural
extension once binaries are available.
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any

import ase.io
from ase.io.orca import write_orca

from atomscope.ase_bridge.convert import to_atoms
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

MOLECULAR = ("orca", "gaussian", "nwchem", "gamess")
PERIODIC = ("espresso", "abinit")

SCHEMA = ParameterSchema(
    id="qc_inputs",
    backend="qc_inputs",
    title="Quantum chemistry input generator",
    sections=[
        Section(
            id="program",
            label="Program",
            parameters=[
                ParameterSpec(
                    key="program",
                    label="Program",
                    type="enum",
                    default="orca",
                    choices=[
                        Choice(value="orca", label="ORCA"),
                        Choice(value="gaussian", label="Gaussian"),
                        Choice(value="nwchem", label="NWChem"),
                        Choice(value="gamess", label="GAMESS-US"),
                        Choice(value="espresso", label="Quantum ESPRESSO (pw.x)"),
                        Choice(value="abinit", label="ABINIT"),
                    ],
                ),
                ParameterSpec(
                    key="task",
                    label="Calculation type",
                    type="enum",
                    default="energy",
                    choices=[
                        Choice(value="energy", label="Single point energy"),
                        Choice(value="optimize", label="Geometry optimization"),
                        Choice(value="frequencies", label="Frequencies"),
                    ],
                ),
                ParameterSpec(
                    key="method",
                    label="Method / functional",
                    type="string",
                    default="B3LYP",
                    help="e.g. HF, B3LYP, PBE, MP2, CCSD(T)",
                    visible_when=[VisibleWhen(key="program", op="in", value=list(MOLECULAR))],
                ),
                ParameterSpec(
                    key="basis",
                    label="Basis set",
                    type="string",
                    default="def2-SVP",
                    help="e.g. def2-SVP, 6-31G*, cc-pVTZ",
                    visible_when=[VisibleWhen(key="program", op="in", value=list(MOLECULAR))],
                ),
                ParameterSpec(
                    key="multiplicity",
                    label="Spin multiplicity",
                    type="integer",
                    default=0,
                    minimum=0,
                    help="0 = take from the structure (or 1)",
                ),
                ParameterSpec(
                    key="nprocs", label="Processors", type="integer", default=1, minimum=1
                ),
                ParameterSpec(
                    key="memory_mb",
                    label="Memory per process (MB)",
                    type="integer",
                    default=2000,
                    minimum=100,
                    advanced=True,
                ),
                ParameterSpec(
                    key="extra_keywords",
                    label="Extra keywords",
                    type="string",
                    default="",
                    advanced=True,
                    help="appended to the route/keyword line",
                ),
            ],
        ),
        Section(
            id="planewave",
            label="Plane-wave settings",
            parameters=[
                ParameterSpec(
                    key="xc",
                    label="Functional",
                    type="string",
                    default="PBE",
                    visible_when=[VisibleWhen(key="program", op="in", value=list(PERIODIC))],
                ),
                ParameterSpec(
                    key="ecutwfc",
                    label="Wave-function cutoff",
                    type="number",
                    default=40.0,
                    minimum=5,
                    unit=Unit.RYDBERG,
                    visible_when=[VisibleWhen(key="program", op="in", value=list(PERIODIC))],
                ),
                ParameterSpec(
                    key="kpts",
                    label="k-point grid",
                    type="vector",
                    length=3,
                    integer_vector=True,
                    default=[4, 4, 4],
                    minimum=1,
                    visible_when=[VisibleWhen(key="program", op="in", value=list(PERIODIC))],
                ),
                ParameterSpec(
                    key="pseudo_dir",
                    label="Pseudopotential directory",
                    type="string",
                    default="./pseudo",
                    visible_when=[VisibleWhen(key="program", value="espresso")],
                ),
            ],
        ),
    ],
)

PRESETS = [
    Preset(
        id="orca_opt_b3lyp",
        name="ORCA: B3LYP/def2-SVP optimization",
        schema_id="qc_inputs",
        values={"program": "orca", "task": "optimize", "method": "B3LYP", "basis": "def2-SVP"},
    ),
    Preset(
        id="gaussian_freq",
        name="Gaussian: B3LYP/6-31G* opt+freq",
        schema_id="qc_inputs",
        values={"program": "gaussian", "task": "frequencies", "method": "B3LYP", "basis": "6-31G*"},
    ),
    Preset(
        id="espresso_scf",
        name="Quantum ESPRESSO: PBE SCF",
        schema_id="qc_inputs",
        values={"program": "espresso", "task": "energy"},
    ),
]


def _write(buf: io.StringIO, atoms: Any, fmt: str, **kw: Any) -> None:
    ase.io.write(buf, atoms, format=fmt, **kw)


def _multiplicity(structure: Structure, values: Values) -> int:
    raw = values.get("multiplicity", 0)
    m = int(raw) if isinstance(raw, int | float) else 0
    if m > 0:
        return m
    return int(structure.multiplicity or 1)


class QcInputsPlugin:
    id = "qc_inputs"
    name = "Quantum chemistry input generators"
    capabilities = BackendCapabilities(
        energy=True, forces=True, relaxation=True, vibrations=True, executes=False
    )

    def schema(self) -> ParameterSchema:
        return SCHEMA

    def presets(self) -> list[Preset]:
        return PRESETS

    def discover_executables(self) -> ExecutableReport:
        return ExecutableReport(
            available=True, messages=["input generation only; run the deck with the target program"]
        )

    def validate(self, structure: Structure, values: Values) -> ValidationReport:
        merged = merge_values(SCHEMA, values)
        report = validate(SCHEMA, merged)
        if structure.n_atoms == 0:
            report.issues.append(ValidationIssue(key=None, message="structure has no atoms"))
        program = str(merged.get("program"))
        if program in PERIODIC and not structure.is_periodic():
            report.issues.append(
                ValidationIssue(
                    key="program",
                    message="plane-wave codes need a periodic cell",
                    severity="warning",
                )
            )
        if program in MOLECULAR and structure.is_periodic():
            report.issues.append(
                ValidationIssue(
                    key="program",
                    message="molecular code: the periodic cell is ignored",
                    severity="warning",
                )
            )
        return report

    def generate_inputs(
        self, structure: Structure, values: Values, root_name: str
    ) -> GeneratedInputs:
        merged = merge_values(SCHEMA, values)
        program = str(merged["program"])
        atoms = to_atoms(structure)
        atoms.info = {}
        mult = _multiplicity(structure, merged)
        charge = int(round(structure.charge))
        task = str(merged["task"])
        method = str(merged.get("method", "B3LYP"))
        basis = str(merged.get("basis", "def2-SVP"))
        extra = str(merged.get("extra_keywords", "")).strip()
        nprocs_raw = merged.get("nprocs", 1)
        nprocs = int(nprocs_raw) if isinstance(nprocs_raw, int | float) else 1
        mem_raw = merged.get("memory_mb", 2000)
        memory_mb = int(mem_raw) if isinstance(mem_raw, int | float) else 2000
        buf = io.StringIO()
        if program == "orca":
            keyword = {"energy": "SP", "optimize": "Opt", "frequencies": "Opt Freq"}[task]
            simple = f"{method} {basis} {keyword} {extra}".strip()
            blocks = f"%pal nprocs {nprocs} end\n%maxcore {memory_mb}"
            write_orca(
                buf,
                atoms,
                {"charge": charge, "mult": mult, "orcasimpleinput": simple, "orcablocks": blocks},
            )
            name = f"{root_name}.inp"
        elif program == "gaussian":
            route = {"energy": "", "optimize": "opt", "frequencies": "opt freq"}[task]
            _write(
                buf,
                atoms,
                "gaussian-in",
                method=method,
                basis=basis,
                charge=charge,
                mult=mult,
                nprocshared=nprocs,
                mem=f"{int(merged.get('memory_mb', 2000))}MB",
                **({route.split()[0]: None} if route else {}),
                **({"freq": None} if task == "frequencies" else {}),
                extra=extra or None,
            )
            name = f"{root_name}.gjf"
        elif program == "nwchem":
            theory = (
                "scf"
                if method.upper() in ("HF", "RHF", "UHF")
                else ("mp2" if method.upper() == "MP2" else "dft")
            )
            task_kw = {"energy": "energy", "optimize": "optimize", "frequencies": "freq"}[task]
            kwargs: dict[str, object] = {
                "theory": theory,
                "basis": basis,
                "charge": charge,
                "task": task_kw,
                "label": root_name,
            }
            if theory == "dft":
                kwargs["xc"] = method
                kwargs["dft"] = {"mult": mult}
            elif mult != 1:
                kwargs["scf"] = {"nopen": mult - 1}
            _write(buf, atoms, "nwchem-in", **kwargs)
            name = f"{root_name}.nw"
        elif program == "gamess":
            runtyp = {"energy": "energy", "optimize": "optimize", "frequencies": "hessian"}[task]
            contrl = {"runtyp": runtyp, "icharg": charge, "mult": mult}
            if method.upper() not in ("HF", "RHF", "UHF"):
                contrl["dfttyp"] = method
            _write(buf, atoms, "gamess-us-in", contrl=contrl, basis={"gbasis": basis})
            name = f"{root_name}.inp"
        elif program == "espresso":
            calc = {"energy": "scf", "optimize": "relax", "frequencies": "scf"}[task]
            pseudos = {sym: f"{sym}.UPF" for sym in sorted(set(atoms.get_chemical_symbols()))}
            input_data: dict[str, dict[str, Any]] = {
                "control": {
                    "calculation": calc,
                    "prefix": root_name,
                    "pseudo_dir": str(merged.get("pseudo_dir", "./pseudo")),
                },
                "system": {
                    "ecutwfc": float(merged.get("ecutwfc", 40.0)),
                    "input_dft": str(merged.get("xc", "PBE")),
                    "tot_charge": charge,
                },
            }
            if mult > 1:
                input_data["system"]["nspin"] = 2
                input_data["system"]["tot_magnetization"] = mult - 1
            kpts = tuple(int(k) for k in merged.get("kpts", [4, 4, 4]))
            _write(
                buf,
                atoms,
                "espresso-in",
                input_data=input_data,
                pseudopotentials=pseudos,
                kpts=kpts,
            )
            name = f"{root_name}.pwi"
        elif program == "abinit":
            kpts = tuple(int(k) for k in merged.get("kpts", [4, 4, 4]))
            _write(
                buf,
                atoms,
                "abinit-in",
                param={
                    "ecut": float(merged.get("ecutwfc", 40.0)) * 0.5,
                    "ixc": 11 if str(merged.get("xc", "PBE")).upper() == "PBE" else 1,
                    "kptopt": 1,
                    "ngkpt": list(kpts),
                    "nsppol": 2 if mult > 1 else 1,
                    "charge": charge,
                    "optcell": 0,
                    "ionmov": 2 if task == "optimize" else 0,
                },
            )
            name = f"{root_name}.abi"
        else:
            msg = f"unknown program {program}"
            raise ValueError(msg)
        text = buf.getvalue()
        if not text.endswith("\n"):
            text += "\n"
        return GeneratedInputs(
            files=[GeneratedFile(name=name, text=text, role="input")],
            root_name=root_name,
            summary=f"{program} {task} input for {structure.formula()}",
        )

    def run_spec(
        self, input_dir: Path, work_dir: Path, generated: GeneratedInputs, resources: Resources
    ) -> RunSpec:
        msg = "this backend only generates input files; run them with the target program"
        raise RuntimeError(msg)

    def parse_results(self, work_dir: Path, generated: GeneratedInputs) -> ResultBundle:
        return ResultBundle(warnings=["input-generation-only backend: no results"])


plugin = QcInputsPlugin()
