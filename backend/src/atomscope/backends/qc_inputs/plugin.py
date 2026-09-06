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
from atomscope.backends.qc_inputs.gamess import BASIS_CHOICES as GAMESS_BASIS_CHOICES
from atomscope.backends.qc_inputs.gamess import GBASIS_CHOICES as GAMESS_GBASIS_CHOICES
from atomscope.backends.qc_inputs.gamess import THEORY_CHOICES as GAMESS_THEORIES
from atomscope.backends.qc_inputs.gamess import DetailedBasis, gamess_deck
from atomscope.backends.qc_inputs.gaussian import gaussian_deck
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

MOLECULAR = ("orca", "gaussian", "nwchem", "gamess", "mopac")
"""Semi-empirical Hamiltonians MOPAC understands; the method is the first keyword of the deck."""
MOPAC_METHODS = ("AM1", "PM3", "PM6", "PM7", "RM1", "MNDO", "MNDOD")
"""MOPAC spells the multiplicity as a word (a closed shell is SINGLET and needs no UHF)."""
MOPAC_MULTIPLICITY = {
    1: "SINGLET",
    2: "DOUBLET",
    3: "TRIPLET",
    4: "QUARTET",
    5: "QUINTET",
    6: "SEXTET",
    7: "SEPTET",
    8: "OCTET",
    9: "NONET",
}
"""Programs whose method and basis set are typed in. MOPAC has a Hamiltonian instead, and
GAMESS-US has lists of its own, from the dialog Avogadro ported from MacMolPlt."""
_FREE_METHOD = ("orca", "gaussian", "nwchem")
PERIODIC = ("espresso", "abinit")

"""The Advanced Basis tab is one control per keyword, and replaces the Basic tab's list."""
_GAMESS_DETAIL = [
    VisibleWhen(key="program", value="gamess"),
    VisibleWhen(key="gamess_theory", op="not_in", value=["am1", "pm3"]),
    VisibleWhen(key="gamess_detail", op="truthy"),
]

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
                        Choice(value="mopac", label="MOPAC (semi-empirical)"),
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
                        Choice(value="transition_state", label="Transition state"),
                        Choice(value="frequencies", label="Frequencies"),
                    ],
                ),
                ParameterSpec(
                    key="method",
                    label="Method / functional",
                    type="string",
                    default="B3LYP",
                    help="e.g. HF, B3LYP, PBE, MP2, CCSD(T); AM1 and PM3 take no basis set",
                    visible_when=[VisibleWhen(key="program", op="in", value=list(_FREE_METHOD))],
                ),
                ParameterSpec(
                    key="basis",
                    label="Basis set",
                    type="string",
                    default="def2-SVP",
                    help="e.g. def2-SVP, 6-31G(d), 6-31G(d,p), STO-3G, 3-21G, LANL2DZ, cc-pVTZ",
                    visible_when=[VisibleWhen(key="program", op="in", value=list(_FREE_METHOD))],
                ),
                ParameterSpec(
                    key="mopac_method",
                    label="Hamiltonian",
                    type="enum",
                    default="PM7",
                    # MOPAC's keyword is MNDOD; everyone writes the method MNDO-d
                    choices=[
                        Choice(value=m, label="MNDO-d" if m == "MNDOD" else m)
                        for m in MOPAC_METHODS
                    ],
                    help="MOPAC's semi-empirical Hamiltonian; there is no basis set to choose.",
                    visible_when=[VisibleWhen(key="program", value="mopac")],
                ),
                ParameterSpec(
                    key="gamess_theory",
                    label="Theory",
                    type="enum",
                    default="rhf",
                    choices=[
                        Choice(value=key, label=label) for key, label in GAMESS_THEORIES.items()
                    ],
                    help="AM1 and PM3 are Hamiltonians and replace the basis set",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_basis",
                    label="Basis set",
                    type="enum",
                    default="n31d",
                    choices=[
                        Choice(value=key, label=choice.label)
                        for key, choice in GAMESS_BASIS_CHOICES.items()
                    ],
                    visible_when=[
                        VisibleWhen(key="program", value="gamess"),
                        VisibleWhen(key="gamess_theory", op="not_in", value=["am1", "pm3"]),
                        VisibleWhen(key="gamess_detail", op="falsy"),
                    ],
                ),
                ParameterSpec(
                    key="gamess_detail",
                    label="Set the basis in detail",
                    type="boolean",
                    default=False,
                    advanced=True,
                    help=(
                        "Avogadro's Advanced Basis tab: the basis set and the functions added to"
                        " it, one control each, instead of the list above"
                    ),
                    visible_when=[
                        VisibleWhen(key="program", value="gamess"),
                        VisibleWhen(key="gamess_theory", op="not_in", value=["am1", "pm3"]),
                    ],
                ),
                ParameterSpec(
                    key="gamess_gbasis",
                    label="Basis set (detailed)",
                    type="enum",
                    default="n31_6",
                    advanced=True,
                    choices=[
                        Choice(value=key, label=choice.label)
                        for key, choice in GAMESS_GBASIS_CHOICES.items()
                    ],
                    visible_when=_GAMESS_DETAIL,
                ),
                ParameterSpec(
                    key="gamess_ndfunc",
                    label="#D heavy-atom polarization functions",
                    type="integer",
                    default=0,
                    minimum=0,
                    maximum=3,
                    advanced=True,
                    visible_when=_GAMESS_DETAIL,
                ),
                ParameterSpec(
                    key="gamess_nffunc",
                    label="#F heavy-atom polarization functions",
                    type="integer",
                    default=0,
                    minimum=0,
                    maximum=3,
                    advanced=True,
                    visible_when=_GAMESS_DETAIL,
                ),
                ParameterSpec(
                    key="gamess_npfunc",
                    label="#P light-atom polarization functions",
                    type="integer",
                    default=0,
                    minimum=0,
                    maximum=3,
                    advanced=True,
                    visible_when=_GAMESS_DETAIL,
                ),
                ParameterSpec(
                    key="gamess_polarization",
                    label="Polarization functions from",
                    type="enum",
                    default="default",
                    advanced=True,
                    choices=[
                        Choice(value="default", label="Default"),
                        Choice(value="pople", label="Pople"),
                        Choice(value="popn311", label="Pople N311"),
                        Choice(value="dunning", label="Dunning"),
                        Choice(value="huzinaga", label="Huzinaga"),
                        Choice(value="hondo7", label="Hondo7"),
                    ],
                    help="which set the exponents come from; ignored without any of them",
                    visible_when=_GAMESS_DETAIL,
                ),
                ParameterSpec(
                    key="gamess_ecp",
                    label="Effective core potential",
                    type="enum",
                    default="none",
                    advanced=True,
                    choices=[
                        Choice(value="none", label="None"),
                        Choice(value="read", label="Read from the deck"),
                        Choice(value="sbkjc", label="SBKJC"),
                        Choice(value="hay_wadt", label="Hay-Wadt"),
                    ],
                    help="SBKJC and Hay/Wadt basis sets bring their own unless another is chosen",
                    visible_when=_GAMESS_DETAIL,
                ),
                ParameterSpec(
                    key="gamess_diffuse_sp",
                    label="Diffuse L-shell on heavy atoms",
                    type="boolean",
                    default=False,
                    advanced=True,
                    visible_when=_GAMESS_DETAIL,
                ),
                ParameterSpec(
                    key="gamess_diffuse_s",
                    label="Diffuse S-shell on heavy atoms",
                    type="boolean",
                    default=False,
                    advanced=True,
                    visible_when=_GAMESS_DETAIL,
                ),
                ParameterSpec(
                    key="gamess_solvent",
                    label="Solvent",
                    type="enum",
                    default="gas",
                    choices=[
                        Choice(value="gas", label="Gas"),
                        Choice(value="water", label="Water (PCM)"),
                    ],
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="coordinates",
                    label="Format",
                    type="enum",
                    default="cartesian",
                    choices=[
                        Choice(value="cartesian", label="Cartesian"),
                        Choice(value="zmatrix", label="Z-matrix"),
                        Choice(value="zmatrix_compact", label="Z-matrix (compact)"),
                    ],
                    help="how the geometry is written into the deck",
                    visible_when=[VisibleWhen(key="program", value="gaussian")],
                ),
                ParameterSpec(
                    key="gaussian_output",
                    label="Output",
                    type="enum",
                    default="standard",
                    choices=[
                        Choice(value="standard", label="Standard"),
                        Choice(value="molden", label="Molden"),
                        Choice(value="molekel", label="Molekel"),
                    ],
                    help=(
                        "Molden and Molekel add the keywords that print the basis and the"
                        " orbitals, which is what makes the log readable as a wavefunction"
                    ),
                    visible_when=[VisibleWhen(key="program", value="gaussian")],
                ),
                ParameterSpec(
                    key="gaussian_checkpoint",
                    label="Write a checkpoint file",
                    type="boolean",
                    default=False,
                    help="%Chk, named after the deck; formchk turns it into a .fchk to read here",
                    visible_when=[VisibleWhen(key="program", value="gaussian")],
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
                    help="appended to the route or keyword line; a line of its own for GAMESS",
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
        id="mopac_pm7_opt",
        name="MOPAC: PM7 optimization",
        schema_id="qc_inputs",
        values={"program": "mopac", "task": "optimize", "mopac_method": "PM7"},
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


def _mopac_deck(
    atoms: Any,
    title: str,
    *,
    hamiltonian: str,
    keyword: str,
    charge: int,
    mult: int,
    extra: str,
) -> str:
    """
    A MOPAC deck: one keyword line, a title line, a comment line, then the atoms with an
    optimization flag after each coordinate (1 = this coordinate may move; the flags are read but
    inert for a 1SCF deck). An open shell needs UHF next to the multiplicity word.
    """
    words = [hamiltonian]
    if keyword:
        words.append(keyword)
    if charge:
        words.append(f"CHARGE={charge}")
    word = MOPAC_MULTIPLICITY.get(mult)
    if word is None:
        msg = f"MOPAC spells the multiplicity up to a nonet; this structure says {mult}"
        raise ValueError(msg)
    words.append(word)
    if mult > 1:
        words.append("UHF")
    if extra:
        words.append(extra)
    lines = [" ".join(words), title, ""]
    for symbol, (x, y, z) in zip(atoms.get_chemical_symbols(), atoms.positions, strict=True):
        lines.append(f" {symbol:<2} {x:14.8f} 1 {y:14.8f} 1 {z:14.8f} 1")
    return "\n".join(lines) + "\n"


def _count(value: object) -> int:
    """A number of polarization functions, whatever the form put in the values."""
    return int(value) if isinstance(value, int | float) else 0


def _gamess_detailed(values: Values) -> DetailedBasis | None:
    """The Advanced Basis tab's values, or None when the Basic tab's list is the one in use."""
    if not values.get("gamess_detail"):
        return None
    return DetailedBasis(
        gbasis=str(values.get("gamess_gbasis", "n31_6")),
        ndfunc=_count(values.get("gamess_ndfunc")),
        nffunc=_count(values.get("gamess_nffunc")),
        npfunc=_count(values.get("gamess_npfunc")),
        polarization=str(values.get("gamess_polarization", "default")),
        ecp=str(values.get("gamess_ecp", "none")),
        diffuse_s=bool(values.get("gamess_diffuse_s")),
        diffuse_sp=bool(values.get("gamess_diffuse_sp")),
    )


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
        if merged.get("task") == "transition_state" and program != "gamess":
            report.issues.append(
                ValidationIssue(
                    key="task",
                    message="only the GAMESS-US generator writes a transition-state deck so far",
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
        if merged["task"] == "transition_state" and program != "gamess":
            msg = (
                f"the {program} generator has no transition-state deck yet;"
                " GAMESS-US is the one that writes RUNTYP=SADPOINT"
            )
            raise ValueError(msg)
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
            name = f"{root_name}.gjf"
            buf.write(
                gaussian_deck(
                    structure,
                    title=structure.name or root_name,
                    method=method,
                    basis=basis,
                    task=task,
                    charge=charge,
                    multiplicity=mult,
                    nprocs=nprocs,
                    memory_mb=memory_mb,
                    extra=extra,
                    output=str(merged.get("gaussian_output", "standard")),
                    checkpoint=(f"{root_name}.chk" if merged.get("gaussian_checkpoint") else ""),
                    coordinates=str(merged.get("coordinates", "cartesian")),
                )
            )
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
            name = f"{root_name}.inp"
            buf.write(
                gamess_deck(
                    structure,
                    title=structure.name or root_name,
                    theory=str(merged.get("gamess_theory", "rhf")),
                    basis=str(merged.get("gamess_basis", "n31d")),
                    detailed=_gamess_detailed(merged),
                    task=task,
                    charge=charge,
                    multiplicity=mult,
                    solvent=str(merged.get("gamess_solvent", "gas")),
                    memory_mb=memory_mb,
                    extra=extra,
                )
            )
        elif program == "mopac":
            hamiltonian = str(merged.get("mopac_method", "PM7"))
            # 1SCF is a single point; an optimization is MOPAC's default; FORCE is the Hessian
            keyword = {"energy": "1SCF", "optimize": "", "frequencies": "FORCE"}[task]
            buf.write(
                _mopac_deck(
                    atoms,
                    root_name,
                    hamiltonian=hamiltonian,
                    keyword=keyword,
                    charge=charge,
                    mult=mult,
                    extra=extra,
                )
            )
            name = f"{root_name}.mop"
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
