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
from atomscope.backends.qc_inputs.gamess import AXIS_ORDER_GROUPS as GAMESS_AXIS_GROUPS
from atomscope.backends.qc_inputs.gamess import BASIS_CHOICES as GAMESS_BASIS_CHOICES
from atomscope.backends.qc_inputs.gamess import DFT_FUNCTIONALS as GAMESS_FUNCTIONALS
from atomscope.backends.qc_inputs.gamess import (
    GAMESS_RUN_TYPES,
    RUN_TYPES,
    ControlOptions,
    DataOptions,
    DetailedBasis,
    GuessOptions,
    HessianOptions,
    MiscOptions,
    MP2Options,
    SCFOptions,
    StatPointOptions,
    SystemOptions,
    gamess_deck,
)
from atomscope.backends.qc_inputs.gamess import GBASIS_CHOICES as GAMESS_GBASIS_CHOICES
from atomscope.backends.qc_inputs.gamess import POINT_GROUPS as GAMESS_POINT_GROUPS
from atomscope.backends.qc_inputs.gamess import THEORY_CHOICES as GAMESS_THEORIES
from atomscope.backends.qc_inputs.gamessuk import BASIS_LABELS as GAMESSUK_BASIS_LABELS
from atomscope.backends.qc_inputs.gamessuk import FUNCTIONALS as GAMESSUK_FUNCTIONALS
from atomscope.backends.qc_inputs.gamessuk import THEORY_LABELS as GAMESSUK_THEORY_LABELS
from atomscope.backends.qc_inputs.gamessuk import gamessuk_deck
from atomscope.backends.qc_inputs.gaussian import gaussian_deck
from atomscope.backends.qc_inputs.molpro import BASIS_LABELS as MOLPRO_BASIS_LABELS
from atomscope.backends.qc_inputs.molpro import THEORY_LABELS as MOLPRO_THEORY_LABELS
from atomscope.backends.qc_inputs.molpro import VERSIONS as MOLPRO_VERSIONS
from atomscope.backends.qc_inputs.molpro import molpro_deck
from atomscope.backends.qc_inputs.nwchem import BASIS_LABELS as NWCHEM_BASIS_LABELS
from atomscope.backends.qc_inputs.nwchem import THEORY_LABELS as NWCHEM_THEORY_LABELS
from atomscope.backends.qc_inputs.nwchem import nwchem_deck
from atomscope.backends.qc_inputs.psi4 import BASIS_LABELS as PSI4_BASIS_LABELS
from atomscope.backends.qc_inputs.psi4 import SAPT_THEORIES as PSI4_SAPT
from atomscope.backends.qc_inputs.psi4 import THEORY_LABELS as PSI4_THEORY_LABELS
from atomscope.backends.qc_inputs.psi4 import psi4_deck
from atomscope.backends.qc_inputs.qchem import BASIS_LABELS as QCHEM_BASIS_LABELS
from atomscope.backends.qc_inputs.qchem import THEORY_LABELS as QCHEM_THEORY_LABELS
from atomscope.backends.qc_inputs.qchem import qchem_deck
from atomscope.chem.bonds import perceive_bonds
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

MOLECULAR = (
    "orca",
    "gaussian",
    "nwchem",
    "gamess",
    "gamessuk",
    "molpro",
    "qchem",
    "psi4",
    "mopac",
)

OPTIMIZE_BEFORE_FREQUENCIES = ("orca", "molpro")
"""The two whose frequency deck runs an optimization first -- ORCA's route says `Opt Freq` and
Molpro's writes `{optg}` above `{frequencies}` (`molproinputdialog.cpp:453-455`). A frequency at
a geometry that is not stationary is not one, so both are kept and both are said."""

TS_PROGRAMS = ("gamess", "gamessuk")
"""The generators that write a transition-state deck: GAMESS-US punches RUNTYP=SADPOINT and
GAMESS-UK `runtype saddle`. Everything else says so rather than writing a lesser search."""
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
_FREE_METHOD = ("orca", "gaussian")
"""The two whose method and basis are still free text. Every generator written from its own
Avogadro dialog has that dialog's lists instead, in a section of its own."""

_COORDINATE_BOX = ("gaussian", "qchem", "gamessuk", "molpro", "nwchem")
"""The dialogs with a Format box. GAMESS-UK's offers two of the three layouts (there is no
compact Z-matrix there), and `validate` says so when the third is chosen."""
PERIODIC = ("espresso", "abinit")

"""The Advanced Basis tab is one control per keyword, and replaces the Basic tab's list."""
_GAMESS_DETAIL = [
    VisibleWhen(key="program", value="gamess"),
    VisibleWhen(key="gamess_theory", op="not_in", value=["am1", "pm3"]),
    VisibleWhen(key="gamess_detail", op="truthy"),
]
_GAMESS_MP2 = [
    VisibleWhen(key="program", value="gamess"),
    VisibleWhen(key="gamess_theory", value="mp2"),
]
"""$MP2 is Avogadro's MPLEVL=2 condition, so the tab has nothing to say about another run."""

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
                        Choice(value="gamessuk", label="GAMESS-UK"),
                        Choice(value="molpro", label="Molpro"),
                        Choice(value="qchem", label="Q-Chem"),
                        Choice(value="psi4", label="Psi4"),
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
                    visible_when=[VisibleWhen(key="program", op="in", value=_COORDINATE_BOX)],
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
                    help="appended to the route or keyword line; a line of its own for GAMESS, lines inside $rem for Q-Chem, and directives of their own before Psi4's molecule, Molpro's basis, NWChem's task and GAMESS-UK's `enter`",
                ),
            ],
        ),
        Section(
            id="qchem",
            label="Q-Chem",
            help="the theory and basis lists of Avogadro's Q-Chem dialog",
            parameters=[
                ParameterSpec(
                    key="qchem_theory",
                    label="Theory",
                    type="enum",
                    default="b3lyp",
                    choices=[
                        Choice(value=key, label=label) for key, label in QCHEM_THEORY_LABELS.items()
                    ],
                    visible_when=[VisibleWhen(key="program", value="qchem")],
                ),
                ParameterSpec(
                    key="qchem_basis",
                    label="Basis set",
                    type="enum",
                    default="b631gd",
                    choices=[
                        Choice(value=key, label=label) for key, label in QCHEM_BASIS_LABELS.items()
                    ],
                    visible_when=[VisibleWhen(key="program", value="qchem")],
                ),
            ],
        ),
        Section(
            id="psi4",
            label="Psi4",
            help="the theory and basis lists of Avogadro's Psi4 dialog",
            parameters=[
                ParameterSpec(
                    key="psi4_theory",
                    label="Theory",
                    type="enum",
                    # Avogadro opens on SAPT0, which is an interaction energy and needs two
                    # fragments; the first entry is the one that makes a deck for one molecule
                    default="scf",
                    choices=[
                        Choice(value=key, label=label) for key, label in PSI4_THEORY_LABELS.items()
                    ],
                    visible_when=[VisibleWhen(key="program", value="psi4")],
                ),
                ParameterSpec(
                    key="psi4_basis",
                    label="Basis set",
                    type="enum",
                    default="jundz",
                    choices=[
                        Choice(value=key, label=label) for key, label in PSI4_BASIS_LABELS.items()
                    ],
                    visible_when=[VisibleWhen(key="program", value="psi4")],
                ),
            ],
        ),
        Section(
            id="nwchem",
            label="NWChem",
            help="the theory and basis lists of Avogadro's NWChem dialog",
            parameters=[
                ParameterSpec(
                    key="nwchem_theory",
                    label="Theory",
                    type="enum",
                    default="b3lyp",
                    choices=[
                        Choice(value=key, label=label)
                        for key, label in NWCHEM_THEORY_LABELS.items()
                    ],
                    visible_when=[VisibleWhen(key="program", value="nwchem")],
                ),
                ParameterSpec(
                    key="nwchem_basis",
                    label="Basis set",
                    type="enum",
                    default="b631gd",
                    choices=[
                        Choice(value=key, label=label) for key, label in NWCHEM_BASIS_LABELS.items()
                    ],
                    help="the combo's spelling; the deck asks for the same sets as 6-31G* and so on",
                    visible_when=[VisibleWhen(key="program", value="nwchem")],
                ),
            ],
        ),
        Section(
            id="molpro",
            label="Molpro",
            help="the theory, basis and version lists of Avogadro's Molpro dialog",
            parameters=[
                ParameterSpec(
                    key="molpro_theory",
                    label="Theory",
                    type="enum",
                    default="rhf",
                    choices=[
                        Choice(value=key, label=label)
                        for key, label in MOLPRO_THEORY_LABELS.items()
                    ],
                    visible_when=[VisibleWhen(key="program", value="molpro")],
                ),
                ParameterSpec(
                    key="molpro_basis",
                    label="Basis set",
                    type="enum",
                    default="b631gd",
                    choices=[
                        Choice(value=key, label=label) for key, label in MOLPRO_BASIS_LABELS.items()
                    ],
                    visible_when=[VisibleWhen(key="program", value="molpro")],
                ),
                ParameterSpec(
                    key="molpro_version",
                    label="Molpro version",
                    type="enum",
                    default="pre2009",
                    choices=[
                        Choice(value=key, label=label) for key, label in MOLPRO_VERSIONS.items()
                    ],
                    help=(
                        "2009.1 dropped the `geomtyp=xyz` header and the atom count, and moved"
                        " the symmetry statement above the geometry block"
                    ),
                    visible_when=[VisibleWhen(key="program", value="molpro")],
                ),
            ],
        ),
        Section(
            id="gamessuk",
            label="GAMESS-UK",
            help="the theory, functional and basis lists of Avogadro's GAMESS-UK dialog",
            parameters=[
                ParameterSpec(
                    key="gamessuk_theory",
                    label="Theory",
                    type="enum",
                    default="rhf",
                    choices=[
                        Choice(value=key, label=label)
                        for key, label in GAMESSUK_THEORY_LABELS.items()
                    ],
                    visible_when=[VisibleWhen(key="program", value="gamessuk")],
                ),
                ParameterSpec(
                    key="gamessuk_functional",
                    label="DFT functional",
                    type="enum",
                    default="b3lyp",
                    choices=[Choice(value=f, label=f.upper()) for f in GAMESSUK_FUNCTIONALS],
                    visible_when=[
                        VisibleWhen(key="program", value="gamessuk"),
                        VisibleWhen(key="gamessuk_theory", value="dft"),
                    ],
                ),
                ParameterSpec(
                    key="gamessuk_basis",
                    label="Basis set",
                    type="enum",
                    default="b321g",
                    choices=[
                        Choice(value=key, label=label)
                        for key, label in GAMESSUK_BASIS_LABELS.items()
                    ],
                    help=(
                        "each entry is named after the keyword the deck asks for; Avogadro's own"
                        " combo called two of them 6-31G(d) and 6-31G(d,p) while writing 6-31G"
                        " and 6-31G*"
                    ),
                    visible_when=[VisibleWhen(key="program", value="gamessuk")],
                ),
                ParameterSpec(
                    key="gamessuk_direct",
                    label="Run in direct mode",
                    type="boolean",
                    default=False,
                    help="integrals are recalculated as needed rather than stored on disk",
                    visible_when=[VisibleWhen(key="program", value="gamessuk")],
                ),
            ],
        ),
        Section(
            id="gamess_basis_detail",
            label="GAMESS: Basis",
            help="the Advanced Basis tab: $BASIS, keyword by keyword",
            advanced=True,
            parameters=[
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
            ],
        ),
        Section(
            id="gamess_control",
            label="GAMESS: Control",
            help="the Advanced Control tab, as far as $CONTRL carries it",
            advanced=True,
            parameters=[
                ParameterSpec(
                    key="gamess_runtyp",
                    label="Run type",
                    type="enum",
                    default="",
                    advanced=True,
                    choices=[
                        Choice(value="", label="From the calculation type"),
                        *(
                            Choice(value=key, label=label)
                            for key, (_, label) in GAMESS_RUN_TYPES.items()
                        ),
                    ],
                    help="GAMESS's own RUNTYP list; anything but the first wins over the box above",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_scftyp",
                    label="SCF type",
                    type="enum",
                    default="",
                    advanced=True,
                    choices=[
                        Choice(value="", label="From the multiplicity (RHF or ROHF)"),
                        Choice(value="rhf", label="RHF"),
                        Choice(value="uhf", label="UHF"),
                        Choice(value="rohf", label="ROHF"),
                        Choice(value="gvb", label="GVB"),
                        Choice(value="mcscf", label="MCSCF"),
                        Choice(value="none", label="None (CI)"),
                    ],
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_ci",
                    label="CI",
                    type="enum",
                    default="none",
                    advanced=True,
                    choices=[
                        Choice(value="none", label="None"),
                        Choice(value="guga", label="GUGA"),
                        Choice(value="aldet", label="Ames Lab. determinant"),
                        Choice(value="ormas", label="Occupation restricted multiple active space"),
                        Choice(value="cis", label="CI singles"),
                        Choice(value="fsoci", label="Full second-order CI"),
                        Choice(value="genci", label="General CI"),
                    ],
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_cc",
                    label="Coupled cluster",
                    type="enum",
                    default="",
                    advanced=True,
                    choices=[
                        Choice(value="", label="From the theory box"),
                        Choice(value="none", label="None"),
                        Choice(value="lccd", label="LCCD: linearized CC"),
                        Choice(value="ccd", label="CCD: CC with doubles"),
                        Choice(value="ccsd", label="CCSD: CC with singles and doubles"),
                        Choice(value="ccsd_t", label="CCSD(T)"),
                        Choice(value="r_cc", label="R-CC"),
                        Choice(value="cr_cc", label="CR-CC"),
                        Choice(value="eom_ccsd", label="EOM-CCSD"),
                        Choice(value="cr_eom", label="CR-EOM"),
                    ],
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_localization",
                    label="Localization method",
                    type="enum",
                    default="none",
                    advanced=True,
                    choices=[
                        Choice(value="none", label="None"),
                        Choice(value="boys", label="Foster-Boys"),
                        Choice(value="ruednbrg", label="Edmiston-Ruedenberg"),
                        Choice(value="pop", label="Pipek-Mezey"),
                    ],
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_maxit",
                    label="Max SCF iterations",
                    type="integer",
                    default=0,
                    minimum=0,
                    advanced=True,
                    help="0 leaves GAMESS its own default",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_exec",
                    label="Exec type",
                    type="enum",
                    default="run",
                    advanced=True,
                    choices=[
                        Choice(value="run", label="Normal run"),
                        Choice(value="check", label="Check"),
                        Choice(value="debug", label="Debug"),
                    ],
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
            ],
        ),
        Section(
            id="gamess_dft",
            label="GAMESS: DFT",
            help="the DFT tab: $DFT and the functional in $CONTRL",
            advanced=True,
            parameters=[
                ParameterSpec(
                    key="gamess_functional",
                    label="DFT functional",
                    type="enum",
                    default="",
                    advanced=True,
                    choices=[
                        Choice(value="", label="From the theory box"),
                        *(
                            Choice(value=key, label=label)
                            for key, (label, _) in GAMESS_FUNCTIONALS.items()
                        ),
                    ],
                    help="choosing one turns DFT on, whatever the theory box says",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_dft_method",
                    label="DFT method",
                    type="enum",
                    default="grid",
                    advanced=True,
                    choices=[
                        Choice(value="grid", label="Grid"),
                        Choice(value="gridfree", label="Grid-free"),
                    ],
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
            ],
        ),
        Section(
            id="gamess_data",
            label="GAMESS: Data",
            help="the Data tab: the shape of the $DATA block, and four $CONTRL keywords",
            advanced=True,
            parameters=[
                ParameterSpec(
                    key="gamess_title",
                    label="Title",
                    type="string",
                    default="",
                    advanced=True,
                    help="empty names the deck after the structure",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_point_group",
                    label="Point group",
                    type="enum",
                    default="c1",
                    advanced=True,
                    choices=[
                        Choice(value=key, label=label) for key, label in GAMESS_POINT_GROUPS.items()
                    ],
                    help="anything but C1 needs the symmetry-unique atoms, or COORD=CART",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_axis_order",
                    label="Order of the principal axis",
                    type="integer",
                    default=2,
                    minimum=2,
                    advanced=True,
                    visible_when=[
                        VisibleWhen(key="program", value="gamess"),
                        VisibleWhen(
                            key="gamess_point_group", op="in", value=list(GAMESS_AXIS_GROUPS)
                        ),
                    ],
                ),
                ParameterSpec(
                    key="gamess_coord_type",
                    label="Coordinate type",
                    type="enum",
                    default="default",
                    advanced=True,
                    choices=[
                        Choice(value="default", label="GAMESS's own (unique)"),
                        Choice(value="unique", label="Unique Cartesian coordinates"),
                        Choice(value="cartesian", label="Cartesian coordinates"),
                    ],
                    help="COORD=CART is the one that reads every atom of a symmetric molecule",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_units",
                    label="Units",
                    type="enum",
                    default="angstrom",
                    advanced=True,
                    choices=[
                        Choice(value="angstrom", label="\u00c5ngstr\u00f6m"),
                        Choice(value="bohr", label="Bohr"),
                    ],
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_nzvar",
                    label="Z-matrix variables",
                    type="integer",
                    default=0,
                    minimum=0,
                    advanced=True,
                    help="NZVAR; the $ZMAT group itself has to be added to the deck",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_use_symmetry",
                    label="Use symmetry during the calculation",
                    type="boolean",
                    default=True,
                    advanced=True,
                    help="unchecking it writes NOSYM=1",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
            ],
        ),
        Section(
            id="gamess_misc",
            label="GAMESS: Misc",
            help="the Misc tab: the interfaces to other codes, which are $CONTRL keywords",
            advanced=True,
            parameters=[
                ParameterSpec(
                    key="gamess_friend",
                    label="Write input for",
                    type="enum",
                    default="none",
                    advanced=True,
                    choices=[
                        Choice(value="none", label="None"),
                        Choice(value="hondo", label="Hondo 8.2"),
                        Choice(value="meldf", label="MELDF"),
                        Choice(value="gamessuk", label="GAMESS (UK version)"),
                        Choice(value="gaussian", label="Gaussian 9x"),
                        Choice(value="all", label="All"),
                    ],
                    help="FRIEND, which makes the run a check run whatever the Control tab says",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_molplt",
                    label="Write a MolPlt file",
                    type="boolean",
                    default=False,
                    advanced=True,
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_pltorb",
                    label="Write a PltOrb file",
                    type="boolean",
                    default=False,
                    advanced=True,
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_aimpac",
                    label="Write an AIMPAC file",
                    type="boolean",
                    default=False,
                    advanced=True,
                    help="written at the end of a real run, so a check run leaves it out",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_rpac",
                    label="Write an RPAC file",
                    type="boolean",
                    default=False,
                    advanced=True,
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
            ],
        ),
        Section(
            id="gamess_guess",
            label="GAMESS: MO Guess",
            help="the MO Guess tab: where the initial orbitals come from ($GUESS)",
            advanced=True,
            parameters=[
                ParameterSpec(
                    key="gamess_guess",
                    label="Initial guess",
                    type="enum",
                    default="huckel",
                    advanced=True,
                    choices=[
                        Choice(value="huckel", label="H\u00fcckel"),
                        Choice(value="hcore", label="HCore"),
                        Choice(value="moread", label="MO read ($VEC)"),
                        Choice(value="mosaved", label="MO saved (DICTNRY)"),
                        Choice(value="skip", label="Skip"),
                    ],
                    help="H\u00fcckel is GAMESS's own, and writes no keyword",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_guess_orbitals",
                    label="Orbitals to read",
                    type="integer",
                    default=0,
                    minimum=0,
                    advanced=True,
                    help="NORB; the $VEC group itself has to be added to the deck by hand",
                    visible_when=[
                        VisibleWhen(key="program", value="gamess"),
                        VisibleWhen(key="gamess_guess", value="moread"),
                    ],
                ),
                ParameterSpec(
                    key="gamess_guess_print",
                    label="Print the initial guess",
                    type="boolean",
                    default=False,
                    advanced=True,
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_guess_mix",
                    label="Rotate alpha and beta orbitals",
                    type="boolean",
                    default=False,
                    advanced=True,
                    help="MIX, which pushes a singlet UHF run off the closed shell",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
            ],
        ),
        Section(
            id="gamess_scf",
            label="GAMESS: SCF",
            help="the SCF tab: how the SCF is converged ($SCF)",
            advanced=True,
            parameters=[
                ParameterSpec(
                    key="gamess_direct_scf",
                    label="Direct SCF",
                    type="boolean",
                    default=False,
                    advanced=True,
                    help="recompute the two-electron integrals instead of storing them",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_fock_diff",
                    label="Compute only what changed in the Fock matrix",
                    type="boolean",
                    default=True,
                    advanced=True,
                    help="GAMESS's default under a direct SCF; unchecking it writes FDIFF=.FALSE.",
                    visible_when=[
                        VisibleWhen(key="program", value="gamess"),
                        VisibleWhen(key="gamess_direct_scf", op="truthy"),
                    ],
                ),
                ParameterSpec(
                    key="gamess_uhf_no",
                    label="Generate UHF natural orbitals",
                    type="boolean",
                    default=False,
                    advanced=True,
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_nconv",
                    label="Density convergence (decimal places)",
                    type="integer",
                    default=0,
                    minimum=0,
                    maximum=12,
                    advanced=True,
                    help="0 leaves it to GAMESS; Avogadro's writer had NCONV, its dialog no box",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
            ],
        ),
        Section(
            id="gamess_mp2",
            label="GAMESS: MP2",
            help="the MP2 tab: how the correction is computed ($MP2)",
            advanced=True,
            parameters=[
                ParameterSpec(
                    key="gamess_mp2_core",
                    label="Frozen core electrons",
                    type="integer",
                    default=-1,
                    minimum=-1,
                    advanced=True,
                    help="-1 leaves the frozen core to GAMESS; a UHF run gets NBCORE as well",
                    visible_when=_GAMESS_MP2,
                ),
                ParameterSpec(
                    key="gamess_mp2_memory",
                    label="Memory (words)",
                    type="integer",
                    default=0,
                    minimum=0,
                    advanced=True,
                    help="NWORD, in GAMESS words of eight bytes; 0 leaves it to GAMESS",
                    visible_when=_GAMESS_MP2,
                ),
                ParameterSpec(
                    key="gamess_mp2_cutoff",
                    label="Integral retention cutoff",
                    type="number",
                    default=0.0,
                    minimum=0.0,
                    advanced=True,
                    help="0 leaves it to GAMESS, whose own default is 1e-9",
                    visible_when=_GAMESS_MP2,
                ),
                ParameterSpec(
                    key="gamess_mp2_localized",
                    label="Use localized orbitals",
                    type="boolean",
                    default=False,
                    advanced=True,
                    help="LMOMP2, which GAMESS has for a closed-shell run only",
                    visible_when=_GAMESS_MP2,
                ),
                ParameterSpec(
                    key="gamess_mp2_properties",
                    label="Compute MP2 properties",
                    type="boolean",
                    default=False,
                    advanced=True,
                    help="MP2PRP, written for an energy run and ignored by GAMESS in any other",
                    visible_when=_GAMESS_MP2,
                ),
                ParameterSpec(
                    key="gamess_mp2_transformation",
                    label="Transformation method",
                    type="enum",
                    default="segmented",
                    advanced=True,
                    choices=[
                        Choice(value="segmented", label="Segmented transformation"),
                        Choice(value="two_phase", label="Two-phase bin sort"),
                    ],
                    visible_when=[
                        *_GAMESS_MP2,
                        VisibleWhen(key="gamess_mp2_localized", op="falsy"),
                    ],
                ),
                ParameterSpec(
                    key="gamess_mp2_ao_storage",
                    label="AO integral storage",
                    type="enum",
                    default="default",
                    advanced=True,
                    choices=[
                        Choice(value="default", label="Leave to GAMESS"),
                        Choice(value="duplicated", label="Duplicated on each node"),
                        Choice(value="distributed", label="Distributed across all nodes"),
                    ],
                    visible_when=_GAMESS_MP2,
                ),
            ],
        ),
        Section(
            id="gamess_statpt",
            label="GAMESS: Stat Point",
            help="the Stat Point tab: how a stationary point is searched for ($STATPT)",
            advanced=True,
            parameters=[
                ParameterSpec(
                    key="gamess_opt_method",
                    label="Optimization method",
                    type="enum",
                    default="qa",
                    advanced=True,
                    choices=[
                        Choice(value="nr", label="Newton-Raphson"),
                        Choice(value="rfo", label="Rational function optimization"),
                        Choice(value="qa", label="Quadratic approximation"),
                        Choice(value="schlegel", label="Schlegel (quasi-NR)"),
                        Choice(value="conopt", label="Constrained optimization"),
                    ],
                    help="$STATPT, for an optimization or a saddle-point search",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_opttol",
                    label="Gradient convergence",
                    type="number",
                    default=0.0001,
                    minimum=0.0,
                    exclusive_minimum=True,
                    advanced=True,
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_nstep",
                    label="Max optimization steps",
                    type="integer",
                    default=20,
                    minimum=1,
                    advanced=True,
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_initial_hessian",
                    label="Initial Hessian",
                    type="enum",
                    default="",
                    advanced=True,
                    choices=[
                        Choice(value="", label="GAMESS's own"),
                        Choice(value="guess", label="Guess"),
                        Choice(value="read", label="Read (from $HESS)"),
                        Choice(value="calculate", label="Calculate"),
                    ],
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_hess_recalc",
                    label="Recalculate the Hessian every",
                    type="integer",
                    default=0,
                    minimum=0,
                    advanced=True,
                    help="steps; 0 never",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_initial_radius",
                    label="Initial step size",
                    type="number",
                    default=0.0,
                    minimum=0.0,
                    advanced=True,
                    help="0 leaves GAMESS its own",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_min_radius",
                    label="Minimum step size",
                    type="number",
                    default=0.05,
                    minimum=0.0,
                    advanced=True,
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_max_radius",
                    label="Maximum step size",
                    type="number",
                    default=0.0,
                    minimum=0.0,
                    advanced=True,
                    help="0 leaves GAMESS its own",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_update_radius",
                    label="Update the step size",
                    type="boolean",
                    default=True,
                    advanced=True,
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_follow_mode",
                    label="Follow mode",
                    type="integer",
                    default=1,
                    minimum=1,
                    advanced=True,
                    help="which vibrational mode a saddle-point search climbs",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_stationary",
                    label="Stationary point",
                    type="boolean",
                    default=False,
                    advanced=True,
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_jump_size",
                    label="Jump size",
                    type="number",
                    default=0.01,
                    minimum=0.0,
                    advanced=True,
                    visible_when=[
                        VisibleWhen(key="program", value="gamess"),
                        VisibleWhen(key="gamess_stationary", op="truthy"),
                    ],
                ),
                ParameterSpec(
                    key="gamess_print_orbitals",
                    label="Print the orbitals every iteration",
                    type="boolean",
                    default=False,
                    advanced=True,
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
            ],
        ),
        Section(
            id="gamess_hessian",
            label="GAMESS: Hessian",
            help="the Hessian tab: how the force constants are computed ($FORCE)",
            advanced=True,
            parameters=[
                ParameterSpec(
                    key="gamess_hessian_method",
                    label="Method",
                    type="enum",
                    default="analytic",
                    advanced=True,
                    choices=[
                        Choice(value="analytic", label="Analytic"),
                        Choice(value="numeric", label="Numeric"),
                    ],
                    help="GAMESS has analytic force constants for RHF, ROHF and GVB without MP2",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_hessian_vibanl",
                    label="Vibrational analysis",
                    type="boolean",
                    default=True,
                    advanced=True,
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_hessian_scale",
                    label="Frequency scale factor",
                    type="number",
                    default=1.0,
                    minimum=0.0,
                    exclusive_minimum=True,
                    advanced=True,
                    visible_when=[
                        VisibleWhen(key="program", value="gamess"),
                        VisibleWhen(key="gamess_hessian_vibanl", op="truthy"),
                    ],
                ),
                ParameterSpec(
                    key="gamess_hessian_double",
                    label="Double differenced Hessian",
                    type="boolean",
                    default=False,
                    advanced=True,
                    help="a numerical Hessian's; twice the displacements for a better one",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_hessian_displacement",
                    label="Displacement size (bohr)",
                    type="number",
                    default=0.01,
                    minimum=0.0,
                    exclusive_minimum=True,
                    advanced=True,
                    help="a numerical Hessian's; GAMESS's own is 0.01",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_hessian_purify",
                    label="Purify the Hessian",
                    type="boolean",
                    default=False,
                    advanced=True,
                    help="project the translations and rotations out of it",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_hessian_print_fc",
                    label="Print internal force constants",
                    type="boolean",
                    default=False,
                    advanced=True,
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
            ],
        ),
        Section(
            id="gamess_system",
            label="GAMESS: System",
            help="the System tab: what the run is allowed to use ($SYSTEM)",
            advanced=True,
            parameters=[
                ParameterSpec(
                    key="gamess_timlim",
                    label="Time limit (minutes)",
                    type="integer",
                    default=0,
                    minimum=0,
                    advanced=True,
                    help="$SYSTEM; 0 leaves GAMESS its own",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_memddi_mb",
                    label="Distributed memory (MB)",
                    type="integer",
                    default=0,
                    minimum=0,
                    advanced=True,
                    help="MEMDDI, the memory spread over the nodes of a parallel run",
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_parallel",
                    label="Force parallel methods",
                    type="boolean",
                    default=False,
                    advanced=True,
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_core_file",
                    label="Produce a core file on abort",
                    type="boolean",
                    default=False,
                    advanced=True,
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_kdiag",
                    label="Diagonalization",
                    type="enum",
                    default="default",
                    advanced=True,
                    choices=[
                        Choice(value="default", label="Default"),
                        Choice(value="evvrsp", label="EVVRSP"),
                        Choice(value="giveis", label="GIVEIS"),
                        Choice(value="jacobi", label="JACOBI"),
                    ],
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_balance",
                    label="Load balance",
                    type="enum",
                    default="loop",
                    advanced=True,
                    choices=[
                        Choice(value="loop", label="Loop"),
                        Choice(value="nxtval", label="Next value"),
                    ],
                    visible_when=[VisibleWhen(key="program", value="gamess")],
                ),
                ParameterSpec(
                    key="gamess_xdr",
                    label="External data representation",
                    type="boolean",
                    default=False,
                    advanced=True,
                    visible_when=[VisibleWhen(key="program", value="gamess")],
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


def _gamess_control(values: Values) -> ControlOptions:
    """The Advanced Control tab's values."""
    return ControlOptions(
        runtyp=str(values.get("gamess_runtyp", "")),
        scftyp=str(values.get("gamess_scftyp", "")),
        localization=str(values.get("gamess_localization", "none")),
        max_iterations=_count(values.get("gamess_maxit")),
        exec_type=str(values.get("gamess_exec", "run")),
        ci=str(values.get("gamess_ci", "none")),
        cc=str(values.get("gamess_cc", "")),
        functional=str(values.get("gamess_functional", "")),
        dft_method=str(values.get("gamess_dft_method", "grid")),
    )


def _gamess_stat_point(values: Values) -> StatPointOptions:
    """The Stat Point tab's values."""
    return StatPointOptions(
        convergence=_number(values.get("gamess_opttol"), 0.0001),
        max_steps=_count(values.get("gamess_nstep")) or 20,
        method=str(values.get("gamess_opt_method", "qa")),
        initial_radius=_number(values.get("gamess_initial_radius"), 0.0),
        min_radius=_number(values.get("gamess_min_radius"), 0.05),
        max_radius=_number(values.get("gamess_max_radius"), 0.0),
        update_radius=bool(values.get("gamess_update_radius", True)),
        initial_hessian=str(values.get("gamess_initial_hessian", "")),
        recalculate_hessian=_count(values.get("gamess_hess_recalc")),
        follow_mode=_count(values.get("gamess_follow_mode")) or 1,
        stationary_point=bool(values.get("gamess_stationary")),
        jump_size=_number(values.get("gamess_jump_size"), 0.01),
        print_orbitals=bool(values.get("gamess_print_orbitals")),
    )


def _gamess_system(values: Values) -> SystemOptions:
    """The System tab's values."""
    return SystemOptions(
        time_limit_minutes=_count(values.get("gamess_timlim")),
        memddi_mb=_count(values.get("gamess_memddi_mb")),
        parallel=bool(values.get("gamess_parallel")),
        core_file=bool(values.get("gamess_core_file")),
        diagonalization=str(values.get("gamess_kdiag", "default")),
        balance=str(values.get("gamess_balance", "loop")),
        external_representation=bool(values.get("gamess_xdr")),
    )


def _gamess_data(values: Values) -> DataOptions:
    """The Data tab's values."""
    return DataOptions(
        title=str(values.get("gamess_title", "")),
        point_group=str(values.get("gamess_point_group", "c1")),
        axis_order=_count(values.get("gamess_axis_order"), 2),
        coordinates=str(values.get("gamess_coord_type", "default")),
        units=str(values.get("gamess_units", "angstrom")),
        z_matrix_variables=_count(values.get("gamess_nzvar")),
        use_symmetry=bool(values.get("gamess_use_symmetry", True)),
    )


def _gamess_misc(values: Values) -> MiscOptions:
    """The Misc tab's values, which are $CONTRL keywords."""
    return MiscOptions(
        friend=str(values.get("gamess_friend", "none")),
        molplt=bool(values.get("gamess_molplt")),
        pltorb=bool(values.get("gamess_pltorb")),
        aimpac=bool(values.get("gamess_aimpac")),
        rpac=bool(values.get("gamess_rpac")),
    )


def _gamess_guess(values: Values) -> GuessOptions:
    """The MO Guess tab's values."""
    return GuessOptions(
        guess=str(values.get("gamess_guess", "huckel")),
        orbitals=_count(values.get("gamess_guess_orbitals")),
        print_guess=bool(values.get("gamess_guess_print")),
        mix=bool(values.get("gamess_guess_mix")),
    )


def _gamess_hessian(values: Values) -> HessianOptions:
    """The Hessian tab's values."""
    return HessianOptions(
        analytic=str(values.get("gamess_hessian_method", "analytic")) == "analytic",
        double_differenced=bool(values.get("gamess_hessian_double")),
        purify=bool(values.get("gamess_hessian_purify")),
        print_internal=bool(values.get("gamess_hessian_print_fc")),
        vibrational_analysis=bool(values.get("gamess_hessian_vibanl", True)),
        displacement=_number(values.get("gamess_hessian_displacement"), 0.01),
        scale_factor=_number(values.get("gamess_hessian_scale"), 1.0),
    )


def _gamess_scf(values: Values) -> SCFOptions:
    """The SCF tab's values."""
    return SCFOptions(
        direct=bool(values.get("gamess_direct_scf")),
        fock_differencing=bool(values.get("gamess_fock_diff", True)),
        uhf_natural_orbitals=bool(values.get("gamess_uhf_no")),
        convergence=_count(values.get("gamess_nconv")),
    )


def _gamess_mp2(values: Values) -> MP2Options:
    """The MP2 tab's values."""
    return MP2Options(
        core_electrons=_count(values.get("gamess_mp2_core"), -1),
        memory_words=_count(values.get("gamess_mp2_memory")),
        cutoff=_number(values.get("gamess_mp2_cutoff"), 0.0),
        localized=bool(values.get("gamess_mp2_localized")),
        properties=bool(values.get("gamess_mp2_properties")),
        transformation=str(values.get("gamess_mp2_transformation", "segmented")),
        ao_storage=str(values.get("gamess_mp2_ao_storage", "default")),
    )


def _fragment_count(structure: Structure) -> int:
    """How many connected pieces the bonds leave the structure in.

    Psi4's `auto_fragments` runs its own connectivity, so this only decides what to warn about.
    A structure that carries no bonds at all -- an XYZ that was never perceived -- would come out
    as one fragment per atom, so the bonds are perceived first in that case.
    """
    bonds = structure.bonds or perceive_bonds(structure)
    parent = list(range(len(structure.atoms)))

    def root(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for bond in bonds:
        a, b = root(bond.a), root(bond.b)
        if a != b:
            parent[a] = b
    return len({root(i) for i in range(len(parent))})


def _psi4_issues(structure: Structure, merged: Values) -> list[ValidationIssue]:
    """SAPT is an interaction energy between two fragments, and Psi4 will not run it on one.

    Avogadro's dialog offers SAPT0 and SAPT2 for any molecule and opens on SAPT0, so its default
    deck fails for the commonest input there is; ours opens on Hartree-Fock and says this instead.
    """
    if str(merged.get("psi4_theory", "scf")) not in PSI4_SAPT:
        return []
    if _fragment_count(structure) >= 2:
        return []
    return [
        ValidationIssue(
            key="psi4_theory",
            message=(
                "SAPT is the interaction energy of two fragments; this structure holds one,"
                " and auto_fragments will not find a second"
            ),
            # our own bond perception said so, and Psi4 runs its own: a warning, not a refusal
            severity="warning",
        )
    ]


def _gamessuk_issues(structure: Structure, merged: Values) -> list[ValidationIssue]:
    """The two things the GAMESS-UK dialog cannot say, said here instead.

    Its theory combo is HF, DFT and MP2, with no UHF or GVB entry, so the deck names the same
    SCF whatever the multiplicity -- worth saying at a multiplicity above a singlet, without
    claiming to know what GAMESS-UK then does with it. And its Format box has two entries where
    ours has three, so the compact Z-matrix belongs to no layout of its; the deck falls back to
    the one Z-matrix it does write.
    """
    issues: list[ValidationIssue] = []
    if _multiplicity(structure, merged) > 1:
        issues.append(
            ValidationIssue(
                key="gamessuk_theory",
                message=(
                    "Avogadro's GAMESS-UK dialog has no UHF or GVB entry, so the deck writes"
                    " `scftype rhf` at this multiplicity; the extra keywords are where another"
                    " wavefunction goes"
                ),
                severity="warning",
            )
        )
    if str(merged.get("coordinates", "cartesian")) == "zmatrix_compact":
        issues.append(
            ValidationIssue(
                key="coordinates",
                message=(
                    "GAMESS-UK has one Z-matrix layout, with a variables block; the deck is"
                    " written that way"
                ),
                severity="warning",
            )
        )
    return issues


def _gamess_wave_function_issues(merged: Values) -> list[ValidationIssue]:
    """What the GAMESS tabs cannot say in a deck: a box that reaches no keyword, or one whose
    keyword needs something the deck does not carry.

    Avogadro's dialog enables `Generate UHF Natural Orbitals` for a UHF run and `Use Localized
    Orbitals` for a closed-shell one (gamessinputdialog.cpp:771,802), so neither could be set
    anywhere else; a stored set of values can carry them anywhere, so they are said here. The
    rest are groups nothing here writes -- $VEC for a MOREAD guess, $ZMAT for NZVAR -- and the
    atom list a point group other than C1 asks for.
    """
    issues: list[ValidationIssue] = []
    scftyp = str(merged.get("gamess_scftyp", ""))
    if merged.get("gamess_uhf_no") and scftyp != "uhf":
        issues.append(
            ValidationIssue(
                key="gamess_uhf_no",
                message="natural orbitals are a UHF run's; GAMESS ignores UHFNOS in any other",
                severity="warning",
            )
        )
    localized = merged.get("gamess_mp2_localized") and merged.get("gamess_theory") == "mp2"
    if localized and scftyp not in ("", "rhf"):
        issues.append(
            ValidationIssue(
                key="gamess_mp2_localized",
                message="GAMESS has localized MP2 for a closed-shell run only",
            )
        )
    if merged.get("gamess_guess") == "moread":
        issues.append(
            ValidationIssue(
                key="gamess_guess",
                message="a MOREAD guess needs a $VEC group, which has to be added to the deck",
                severity="warning",
            )
        )
    if merged.get("gamess_guess_mix") and scftyp != "uhf":
        issues.append(
            ValidationIssue(
                key="gamess_guess_mix",
                message="mixing the orbitals is a singlet UHF run's; MIX is left out otherwise",
                severity="warning",
            )
        )
    if _count(merged.get("gamess_nzvar")):
        issues.append(
            ValidationIssue(
                key="gamess_nzvar",
                message="NZVAR needs a $ZMAT group, which has to be added to the deck",
                severity="warning",
            )
        )
    point_group = str(merged.get("gamess_point_group", "c1"))
    if point_group != "c1" and merged.get("gamess_coord_type") != "cartesian":
        issues.append(
            ValidationIssue(
                key="gamess_point_group",
                message=(
                    "every atom is written, which GAMESS reads only under COORD=CART; otherwise"
                    " the block has to be cut down to the symmetry-unique atoms"
                ),
                severity="warning",
            )
        )
    if scftyp in ("mcscf", "none") and (
        merged.get("gamess_direct_scf") or _count(merged.get("gamess_nconv"))
    ):
        issues.append(
            ValidationIssue(
                key="gamess_direct_scf",
                message=f"the $SCF group does not apply to {scftyp.upper()}; it is left out",
                severity="warning",
            )
        )
    return issues


def _number(value: object, fallback: float) -> float:
    return float(value) if isinstance(value, int | float) else fallback


def _count(value: object, fallback: int = 0) -> int:
    """A number of polarization functions, whatever the form put in the values."""
    return int(value) if isinstance(value, int | float) else fallback


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


def _electrons(structure: Structure) -> int:
    """How many electrons the deck is about: the nuclear charge less the molecular one."""
    return int(sum(a.atomic_number for a in structure.atoms) - round(structure.charge))


def _multiplicity(structure: Structure, values: Values) -> int:
    """The multiplicity a deck is written with: the form's, else the structure's, else the
    smallest one the electron count allows.

    An odd number of electrons cannot be a singlet, and every generator here used to write
    `mult 1` for a radical unless something else had said otherwise -- a deck the program refuses
    or, worse, one it runs as a different molecule. Only the GAMESS-US writer resolved it, in a
    line of its own (`gamess.py`); it belongs here, where every generator reads it.
    """
    raw = values.get("multiplicity", 0)
    m = int(raw) if isinstance(raw, int | float) else 0
    if m > 0:
        return m
    if structure.multiplicity:
        return int(structure.multiplicity)
    return 2 if _electrons(structure) % 2 else 1


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
        detailed = _gamess_detailed(merged)
        semi_empirical = merged.get("gamess_theory") in ("am1", "pm3") or (
            detailed is not None
            and GAMESS_GBASIS_CHOICES[detailed.gbasis].gbasis in ("MNDO", "AM1", "PM3")
        )
        if program == "gamess" and semi_empirical:
            # the Advanced boxes reach $CONTRL on their own, whatever the theory box says
            correlated = (
                merged.get("gamess_theory") not in ("rhf", "am1", "pm3", None)
                or merged.get("gamess_functional") not in ("", None)
                or merged.get("gamess_cc") not in ("", "none", None)
            )
            if correlated:
                report.issues.append(
                    ValidationIssue(
                        key="gamess_gbasis" if detailed is not None else "gamess_theory",
                        message=(
                            "a semi-empirical basis set has no DFT, MP2 or coupled-cluster"
                            " theory to go with it"
                        ),
                    )
                )
        chosen_run = str(merged.get("gamess_runtyp", ""))
        if program == "gamess" and chosen_run:
            keyword = GAMESS_RUN_TYPES.get(chosen_run)
            if keyword is None:
                report.issues.append(
                    ValidationIssue(key="gamess_runtyp", message=f"no such run type {chosen_run}")
                )
            elif keyword[0] != RUN_TYPES.get(str(merged.get("task"))):
                report.issues.append(
                    ValidationIssue(
                        key="gamess_runtyp",
                        message=(
                            f"the deck will say RUNTYP={keyword[0]}, not what the calculation"
                            " type asks for"
                        ),
                        severity="warning",
                    )
                )
        functional = str(merged.get("gamess_functional", ""))
        if program == "gamess" and functional in GAMESS_FUNCTIONALS:
            belongs = GAMESS_FUNCTIONALS[functional][1]
            method = str(merged.get("gamess_dft_method", "grid"))
            if belongs not in ("both", method):
                report.issues.append(
                    ValidationIssue(
                        key="gamess_functional",
                        message=(
                            f"GAMESS has {functional} in its"
                            f" {'grid-free' if belongs == 'gridfree' else 'grid'} list only"
                        ),
                    )
                )
        if program == "gamess":
            report.issues += _gamess_wave_function_issues(merged)
        if program == "psi4":
            report.issues += _psi4_issues(structure, merged)
        if program == "gamessuk":
            report.issues += _gamessuk_issues(structure, merged)
        if program in OPTIMIZE_BEFORE_FREQUENCIES and merged.get("task") == "frequencies":
            report.issues.append(
                ValidationIssue(
                    key="task",
                    message=(
                        f"the {program} deck optimizes before it takes the frequencies, so they"
                        " are those of the optimized geometry, not of this one"
                    ),
                    severity="warning",
                )
            )
        if merged.get("task") == "transition_state" and program not in TS_PROGRAMS:
            report.issues.append(
                ValidationIssue(
                    key="task",
                    message=(
                        "only the GAMESS-US and GAMESS-UK generators write a transition-state"
                        " deck so far"
                    ),
                )
            )
        if (
            program in MOLECULAR
            and _electrons(structure) % 2 == _multiplicity(structure, merged) % 2
        ):
            report.issues.append(
                ValidationIssue(
                    key="multiplicity",
                    message=(
                        f"{_electrons(structure)} electrons cannot have multiplicity"
                        f" {_multiplicity(structure, merged)}: an odd electron count needs an"
                        " even multiplicity and an even one an odd multiplicity"
                    ),
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
        if merged["task"] == "transition_state" and program not in TS_PROGRAMS:
            msg = (
                f"the {program} generator has no transition-state deck yet;"
                " GAMESS-US writes RUNTYP=SADPOINT and GAMESS-UK `runtype saddle`"
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
            name = f"{root_name}.nw"
            buf.write(
                nwchem_deck(
                    structure,
                    title=structure.name or root_name,
                    theory=str(merged.get("nwchem_theory", "b3lyp")),
                    basis=str(merged.get("nwchem_basis", "b631gd")),
                    task=task,
                    charge=charge,
                    multiplicity=mult,
                    coordinates=str(merged.get("coordinates", "cartesian")),
                    extra=extra,
                )
            )
        elif program == "qchem":
            name = f"{root_name}.qcin"
            buf.write(
                qchem_deck(
                    structure,
                    title=structure.name or root_name,
                    theory=str(merged.get("qchem_theory", "b3lyp")),
                    basis=str(merged.get("qchem_basis", "b631gd")),
                    task=task,
                    charge=charge,
                    multiplicity=mult,
                    coordinates=str(merged.get("coordinates", "cartesian")),
                    extra=extra,
                )
            )
        elif program == "psi4":
            name = f"{root_name}.in"
            buf.write(
                psi4_deck(
                    structure,
                    title=structure.name or root_name,
                    theory=str(merged.get("psi4_theory", "scf")),
                    basis=str(merged.get("psi4_basis", "jundz")),
                    task=task,
                    charge=charge,
                    multiplicity=mult,
                    extra=extra,
                )
            )
        elif program == "molpro":
            name = f"{root_name}.inp"
            buf.write(
                molpro_deck(
                    structure,
                    title=structure.name or root_name,
                    theory=str(merged.get("molpro_theory", "rhf")),
                    basis=str(merged.get("molpro_basis", "b631gd")),
                    task=task,
                    charge=charge,
                    multiplicity=mult,
                    coordinates=str(merged.get("coordinates", "cartesian")),
                    version=str(merged.get("molpro_version", "pre2009")),
                    extra=extra,
                )
            )
        elif program == "gamessuk":
            name = f"{root_name}.gukin"
            buf.write(
                gamessuk_deck(
                    structure,
                    title=structure.name or root_name,
                    theory=str(merged.get("gamessuk_theory", "rhf")),
                    functional=str(merged.get("gamessuk_functional", "b3lyp")),
                    basis=str(merged.get("gamessuk_basis", "b321g")),
                    task=task,
                    charge=charge,
                    multiplicity=mult,
                    coordinates=str(merged.get("coordinates", "cartesian")),
                    direct=bool(merged.get("gamessuk_direct")),
                    extra=extra,
                )
            )
        elif program == "gamess":
            name = f"{root_name}.inp"
            buf.write(
                gamess_deck(
                    structure,
                    title=structure.name or root_name,
                    theory=str(merged.get("gamess_theory", "rhf")),
                    basis=str(merged.get("gamess_basis", "n31d")),
                    detailed=_gamess_detailed(merged),
                    control=_gamess_control(merged),
                    data=_gamess_data(merged),
                    misc=_gamess_misc(merged),
                    guess=_gamess_guess(merged),
                    scf=_gamess_scf(merged),
                    hessian=_gamess_hessian(merged),
                    mp2=_gamess_mp2(merged),
                    stat_point=_gamess_stat_point(merged),
                    system=_gamess_system(merged),
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
