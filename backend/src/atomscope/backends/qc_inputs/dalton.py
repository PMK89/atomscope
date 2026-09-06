"""Dalton input files (AV-QM-011), from Avogadro's dialog.

`daltoninputdialog.cpp:generateInputDeck` writes, in one buffer: `BASIS` and the basis name, two
title lines, `Atomtypes=` and the geometry grouped by element, then `**DALTON INPUT`, the run
type, `**WAVE FUNCTIONS`, the theory, an optional `**PROPERTIES` section and
`**END OF DALTON INPUT`. The lists are the dialog's own -- a calculation type, three theories,
sixty-eight functionals, four grid qualities, two properties, and eleven basis lists selected by
a family and three switches.

Four departures.

* **Dalton reads two files, and the dialog wrote one.** Everything above `**DALTON INPUT` is the
  molecule file and everything below it the input file; `saveInputFile(..., "dal")` (`:348`)
  saved the pair concatenated under a single `.dal`, which Dalton cannot read. Written here as
  `<name>.mol` and `<name>.dal`, which is what the parity row's acceptance asks for.
* **`Nosymm` leaked out of the property box.** The geometry line asks whether the property is an
  excitation (`:428-432`) whatever the calculation type is, so choosing excitation energies and
  then going back to a plain wave-function run still switched symmetry off. Written only for the
  run that asks for it.
* **`aug-cc-pCV5Z` wrote `aug-cc-pCVDZ`.** Its enum has four entries and `getaccpcvxzBasis`
  handles three, so the last fell through to the default. Written as its own name.
* The second title line named Avogadro's plugin, and the file ended without a newline.

The dialog groups atoms into runs of equal atomic number rather than gathering each element
once, so a structure written O, H, O, H comes out as four `Charge=` blocks. That is legal Dalton
-- a repeated atom type is how one basis set is given to some atoms of an element and another to
the rest -- and it keeps the order the structure is in, so it is kept.

Its `resetClicked` (`:250-276`) restores exactly what the constructor opens with, unlike the
Q-Chem, Psi4, Molpro and NWChem dialogs.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import groupby

from atomscope.model import Structure

RUN_TYPES = {"wavefunction": ".RUN WAVE FUNCTIONS", "properties": ".RUN PROPERTIES"}
"""`getCalculationType`."""

THEORIES = {"hf": ".HF", "dft": ".DFT", "mp2": ".MP2"}
"""`getTheoryType`. MP2 writes `.HF` above itself, being a correction to it."""

THEORY_LABELS = {"hf": "Hartree-Fock", "dft": "DFT", "mp2": "MP2"}

FUNCTIONALS = (
    "B2PLYP", "B3LYP", "B3LYPg", "B3P86", "B3P86g", "B3PW91", "B1LYP", "B1PW91", "BHandH",
    "BHandHLYP", "B86VWN", "B86LYP", "B86P86", "B86PW91", "BVWN", "BLYP", "BP86", "BPW91", "BW",
    "BFW", "CAMB3LYP", "DBLYP", "DBP86", "DBPW91", "EDF1", "EDF2", "G96VWN", "G96LYP", "G96P86",
    "G96PW91", "G961LYP", "KMLYP", "KT1", "KT2", "KT3", "LDA", "LG1LYP", "OVWN", "OLYP", "OP86",
    "OPW91", "mPWVWN", "mPWLYP", "mPWP86", "mPWPW91", "mPW91", "mPW1PW91", "mPW3PW91", "mPW1K",
    "mPW1N", "mPW1S", "PBE0", "PBE0PBE", "PBE1PBE", "PBE", "PBEPBE", "RPBE", "revPBE", "mPBE",
    "PW91", "PW91VWN", "PW91LYP", "PW91P86", "PW91PW91", "SVWN3", "SVWN5", "XLYP", "X3LYP",
)  # fmt: skip
"""`getFunctionalType`: sixty-eight keywords, each spelled as its own enum name."""

GRIDS = {"coarse": ".COARSE", "normal": ".NORMAL", "fine": ".FINE", "ultrafine": ".ULTRAFINE"}
"""`getdftGrid`; only a grid other than the normal one opens a `*DFT INPUT` section."""

PROPERTIES = {"none": "", "polarizability": ".POLARI", "excitation": ".EXCITA"}
"""`getPropType`, with the entry that asks for no property run at all."""

BASIS_FAMILIES = {
    "sto": "STO-nG",
    "pople": "Pople",
    "jensen": "Jensen (polarization-consistent)",
    "dunning": "Dunning (correlation-consistent)",
}
"""The four families the Basis tab picks between; the switches below choose the list within."""

STO_BASES = ("STO-2G", "STO-3G", "STO-6G")
POPLE_BASES = ("3-21G", "4-31G", "6-31G", "6-311G")
POPLE_DIFFUSE_BASES = ("3-21++G", "6-31+G", "6-31++G")
POPLE_POLARIZED_BASES = (
    "3-21G*", "6-31G*", "6-31G**", "6-31G(3df,3pd)", "6-311G*", "6-311G**", "6-311G(2df,2pd)",
)  # fmt: skip
POPLE_DIFFUSE_POLARIZED_BASES = (
    "3-21++G*", "6-31+G*", "6-31++G*", "6-31++G**", "6-311+G*", "6-311++G**",
    "6-311++G(2d,2p)", "6-311++G(3df,3pd)",
)  # fmt: skip
PC_BASES = ("pc-0", "pc-1", "pc-2", "pc-3", "pc-4")
APC_BASES = ("apc-0", "apc-1", "apc-2", "apc-3", "apc-4")
CC_BASES = ("cc-pVDZ", "cc-pVTZ", "cc-pVQZ", "cc-pV5Z", "cc-pV6Z")
AUG_CC_BASES = ("aug-cc-pVDZ", "aug-cc-pVTZ", "aug-cc-pVQZ", "aug-cc-pV5Z", "aug-cc-pV6Z")
CC_CORE_BASES = (
    "cc-pCVDZ", "cc-pCVTZ", "cc-pCVQZ", "cc-pCV5Z",
    "cc-pwCVDZ", "cc-pwCVTZ", "cc-pwCVQZ", "cc-pwCV5Z",
)  # fmt: skip
AUG_CC_CORE_BASES = ("aug-cc-pCVDZ", "aug-cc-pCVTZ", "aug-cc-pCVQZ", "aug-cc-pCV5Z")
"""`getaccpcvxzBasis` has a case for the first three only, so the fourth wrote the first."""

AUGMENTATIONS = {"single": "", "double": "d-", "triple": "t-", "quadruple": "q-"}
"""`getxaugccBasis`: the prefix that multiplies a Dunning set's diffuse shells."""


@dataclass(frozen=True)
class BasisChoice:
    """What the Basis tab is set to: a family, its three switches and one entry per list."""

    family: str = "sto"
    polarized: bool = False
    diffuse: bool = False
    core: bool = False
    augmentation: str = "single"
    sto: str = "STO-2G"
    pople: str = "3-21G"
    pople_diffuse: str = "3-21++G"
    pople_polarized: str = "3-21G*"
    pople_diffuse_polarized: str = "3-21++G*"
    pc: str = "pc-0"
    apc: str = "apc-0"
    cc: str = "cc-pVDZ"
    aug_cc: str = "aug-cc-pVDZ"
    cc_core: str = "cc-pCVDZ"
    aug_cc_core: str = "aug-cc-pCVDZ"


def _pople_basis(choice: BasisChoice) -> str:
    """Which of the four Pople lists the polarization and diffuse switches pick (`:360-373`)."""
    if choice.polarized:
        return choice.pople_diffuse_polarized if choice.diffuse else choice.pople_polarized
    return choice.pople_diffuse if choice.diffuse else choice.pople


def _dunning_basis(choice: BasisChoice) -> str:
    """The correlation-consistent lists (`:378-390`); an augmented set takes a prefix as well."""
    if not choice.diffuse:
        return choice.cc_core if choice.core else choice.cc
    augmented = choice.aug_cc_core if choice.core else choice.aug_cc
    return AUGMENTATIONS[choice.augmentation] + augmented


def basis_name(choice: BasisChoice) -> str:
    """The one line under `BASIS`, chosen the way `generateInputDeck:355-401` chooses it."""
    if choice.family == "pople":
        return _pople_basis(choice)
    if choice.family == "jensen":
        return choice.apc if choice.diffuse else choice.pc
    if choice.family == "dunning":
        return _dunning_basis(choice)
    return choice.sto


@dataclass(frozen=True)
class DaltonOptions:
    """Everything outside the Basis tab, with the dialog's own defaults (`:73-83`)."""

    theory: str = "hf"
    functional: str = "B3LYP"
    grid: str = "normal"
    prop: str = "none"
    excitations: int = 1
    direct: bool = False
    parallel: bool = False


def _geometry(structure: Structure) -> list[str]:
    """`Charge=` blocks over runs of equal atomic number, and the Qt field widths of `:437-443`:
    3 for the symbol, left, then 15 per coordinate."""
    lines: list[str] = []
    for number, run in groupby(structure.atoms, key=lambda a: a.atomic_number):
        atoms = list(run)
        lines.append(f"Charge={number}.0 Atoms={len(atoms)}")
        lines += [
            f"{a.element:<3}{a.position[0]:15.5f}{a.position[1]:15.5f}{a.position[2]:15.5f}"
            for a in atoms
        ]
    return lines


def _atom_type_count(structure: Structure) -> int:
    return sum(1 for _ in groupby(structure.atoms, key=lambda a: a.atomic_number))


def dalton_molecule(structure: Structure, *, title: str, basis: BasisChoice, nosymm: bool) -> str:
    """The `.mol` file: the basis, two title lines, the atom types and the geometry."""
    header = f"Atomtypes={_atom_type_count(structure)} Angstrom"
    if nosymm:
        header += " Nosymm"
    lines = [
        "BASIS",
        basis_name(basis),
        f" {title}",
        " Generated by the Dalton input generator of Atomscope",
        header,
        *_geometry(structure),
    ]
    return "\n".join(lines) + "\n"


def _check(options: DaltonOptions) -> None:
    """Every box against the list it was chosen from, so a stored value cannot reach the deck."""
    for value, table, what in (
        (options.theory, THEORIES, "theory"),
        (options.functional, FUNCTIONALS, "functional"),
        (options.grid, GRIDS, "grid"),
        (options.prop, PROPERTIES, "property"),
    ):
        if value not in table:
            msg = f"unknown Dalton {what} {value!r}"
            raise ValueError(msg)


def dalton_input(options: DaltonOptions, *, extra: str = "") -> str:
    """The `.dal` file: the run type, the wave function and any properties asked for."""
    _check(options)
    running_properties = options.prop != "none"
    lines = [
        "**DALTON INPUT",
        RUN_TYPES["properties" if running_properties else "wavefunction"],
    ]
    if options.direct:
        lines.append(".DIRECT")
    if options.parallel:
        lines.append(".PARALLEL")
    lines.append("**WAVE FUNCTIONS")
    if options.theory == "mp2":
        # MP2 is a correction to Hartree-Fock, so the reference is asked for above it
        lines += [".HF", THEORIES["mp2"]]
    elif options.theory == "dft":
        lines += [".DFT", f" {options.functional}"]
        # only a grid other than the normal one is worth a section of its own
        if options.grid != "normal":
            lines += ["*DFT INPUT", GRIDS[options.grid]]
    else:
        lines.append(THEORIES[options.theory])
    if running_properties:
        lines += ["**PROPERTIES", PROPERTIES[options.prop]]
        if options.prop == "excitation":
            lines.append(f" {options.excitations}")
    if extra.strip():
        lines += [line.strip() for line in extra.strip().splitlines()]
    lines.append("**END OF DALTON INPUT")
    return "\n".join(lines) + "\n"
