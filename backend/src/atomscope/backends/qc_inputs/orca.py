"""ORCA input decks (AV-QM-016), from Avogadro's dialog.

`orca/orcainputdialog.cpp:generateInputDeck` (`:1038`) writes two decks. **Basic mode** is a
header, a comment, one `!` line naming the method, the calculation and the basis (twice for DFT,
the second as the `/J` auxiliary), and the coordinates. **Advanced mode** builds a much longer
`!` line -- method, calculation, basis, auxiliary bases, an `EPC{}` list, the print level, the
DFT grids, `RijCosX` and its grids, the SCF accuracy and a relativistic keyword -- then a `%scf`
block and, when anything is to be printed, an `%output` block. The lists live in `orcadata.cpp`
and `orcaextension.h`, and the basis names are the enum key with `def2-` in front of it.

Four departures.

* **Neither Z-matrix layout produced a deck ORCA can read.** The verbose branch (`:1184-1245`)
  writes NWChem's syntax -- named references and a ` variables` block -- and the compact one
  (`:1246-1302`) writes element labels like `O1` where ORCA counts atoms; neither closes the
  `* int` block with the `*` ORCA needs, so the geometry runs into whatever follows. ORCA has one
  internal-coordinate layout, `symbol NA NB NC R A D` with a zero for each reference an atom does
  not have, and it is what both choices write here. The compact choice raises a warning saying
  there is only the one.
* **`ExtremSCF`** (`orcadata.cpp:OrcaSCFData::getAccuracyTxt`) is missing its `e`; ORCA's
  keyword is `ExtremeSCF`.
* **`PBEO`** -- the DFT functional is written as its enum key (`orcaextension.h:78`), and that
  key spells PBE0 with a letter O. Written `PBE0` here.
* The header says Atomscope rather than avogadro, which would not be true, and the trailing
  spaces the `!` line and the header carried are not written.

And one thing said rather than inherited: the third second-order converger, AH, has its
`CNVAH 1` commented out with "not yet implemented" (`:1163`), so choosing it wrote nothing at
all. It is still offered, because the dialog offered it, and `plugin.py` says the deck will ask
for no second-order converger.

`%pal` and `%maxcore` are ours rather than the dialog's -- it has no boxes for either -- and are
written from the shared processor and memory boxes, as this generator has always done.
"""

from __future__ import annotations

from dataclasses import dataclass

from atomscope.chem.zmatrix import zmatrix
from atomscope.model import Structure

CALCULATIONS = {"energy": "SP", "optimize": "OPT", "frequencies": "OPT FREQ"}
"""`getCalculationTxt`; a frequency run optimizes first, in both modes."""

BASIS_SETS = {"svp": "def2-SVP", "tzvp": "def2-TZVP", "tzvpp": "def2-TZVPP", "qzvp": "def2-QZVP"}
"""`getBasisTxt`: the enum key of `orcaextension.h:80` with `def2-` in front."""

BASIC_METHODS = {"rhf": "RHF", "dft": "BP RI", "mp2": "MP2", "ccsd": "CCSD"}
"""`OrcaBasicData::getMethodTxt`. Basic mode's DFT is BP with the resolution of the identity."""

FUNCTIONALS = {
    "lda": "LDA",
    "bp": "BP",
    "blyp": "BLYP",
    "pw91": "PW91",
    "b3lyp": "B3LYP",
    "b3pw": "B3PW",
    # the enum key is PBEO, with a letter O; ORCA's functional is PBE0
    "pbe0": "PBE0",
    "tpss": "TPSS",
    "tpssh": "TPSSH",
    "m06l": "M06L",
}
"""`orcaextension.h:78`, as `getDFTFunctionalTxt` writes them."""

ADVANCED_METHODS = {"scf": "SCF", "dft": "DFT", "mp2": "RI-MP2", "ccsd": "CCSD"}
"""Which of the Advanced tab's method switches is on (`:1090-1101`); `scf` means none of them,
and the SCF type below is written in the method's place."""

SCF_TYPES = {"rhf": "RHF", "uhf": "UHF"}
"""`OrcaSCFData::getTypeTxt`. Its `ROHF` default is unreachable: the enum has two entries."""

ACCURACIES = {
    "normal": "NormalSCF",
    "tight": "TightSCF",
    "verytight": "VeryTightSCF",
    # the dialog writes ExtremSCF, which ORCA does not know
    "extreme": "ExtremeSCF",
}
"""`getAccuracyTxt`."""

RELATIVISTIC = {"none": "", "zora": "ZORA", "iora": "IORA", "dkh": "DKH"}
"""`getRelTxt`; DKH takes an order after it."""

PRINT_LEVELS = {
    "none": "",
    "mini": "MiniPrint",
    "small": "SmallPrint",
    "normal": "NormalPrint",
    "large": "LargePrint",
}
"""`getPrintLevelTxt`; `NOTHING` is the one the `!` line leaves out (`:1121`)."""

GRIDS = {"default": "", "none": "NoGrid", **{f"grid{n}": f"Grid{n}" for n in range(3, 9)}}
"""`OrcaDFTData::getGridTxt`."""

FINAL_GRIDS = {
    "default": "",
    "none": "NoFinalGrid",
    **{f"grid{n}": f"FinalGrid{n}" for n in range(4, 10)},
}
"""`OrcaDFTData::getFinalGridTxt`."""

COSX_GRIDS = {"default": "", "none": "NoGridX", **{f"grid{n}": f"GridX{n}" for n in range(3, 9)}}
"""`OrcaCosXData::getGridTxt`."""

COSX_FINAL_GRIDS = {
    "default": "",
    "none": "NoFinalGridX",
    **{f"grid{n}": f"FinalGridX{n}" for n in range(4, 10)},
}
"""`OrcaCosXData::getFinalGridTxt`."""

CONVERGERS = {"diis": "CNVDIIS 1", "kdiis": "CNVKDIIS 1"}
"""`:1155-1159`."""

SECOND_CONVERGERS = {"soscf": "CNVSOSCF 1", "nrscf": "CNVNR 1", "ahscf": ""}
"""`:1160-1166`. The third is commented out there, so it asks for nothing; `plugin.py` says so."""


def _cartesian(structure: Structure, charge: int, multiplicity: int) -> list[str]:
    """`* xyz` and the Qt field widths of `:1170-1180`, closed by ORCA's `*`."""
    atoms = [
        f"{a.element:>4}{a.position[0]:15.5f}{a.position[1]:15.5f}{a.position[2]:15.5f}"
        for a in structure.atoms
    ]
    return [f"* xyz {charge} {multiplicity}", *atoms, "*"]


def _internal(structure: Structure, charge: int, multiplicity: int) -> list[str]:
    """ORCA's one internal-coordinate layout: `symbol NA NB NC R A D`, a zero for every reference
    the atom has not got, angles in degrees, and the block closed by `*`."""
    lines = [f"* int {charge} {multiplicity}"]
    for row in zmatrix(structure):
        # 1-based, and a zero where there is no reference -- atom 1 is a real reference, so the
        # test is against None rather than against falsity
        references = [0 if r is None else r + 1 for r in (row.a, row.b, row.c)]
        values = [0.0 if v is None else v for v in (row.distance, row.angle, row.torsion)]
        lines.append(
            f"{row.element:>4}"
            + "".join(f"{r:4d}" for r in references)
            + "".join(f"{v:15.5f}" for v in values)
        )
    return [*lines, "*"]


def _basic_keywords(method: str, basis: str, task: str) -> str:
    """Basic mode's `!` line (`:1060-1066`): DFT names its auxiliary basis after the orbital one."""
    words = [BASIC_METHODS[method], CALCULATIONS[task], BASIS_SETS[basis]]
    if method == "dft":
        words.append(f"{BASIS_SETS[basis]}/J")
    return "! " + " ".join(words)


def _method_words(method: str, functional: str, scf_type: str) -> list[str]:
    """The first words of Advanced mode's `!` line (`:1090-1101`)."""
    if method == "dft":
        # BP is the one the dialog gives the resolution of the identity to
        return [FUNCTIONALS[functional], "RI"] if functional == "bp" else [FUNCTIONALS[functional]]
    if method == "mp2":
        return ["RI-MP2"]
    if method == "ccsd":
        return ["CCSD"]
    return [SCF_TYPES[scf_type]]


@dataclass(frozen=True)
class AdvancedOptions:
    """Everything Advanced mode's tabs carry, with the dialog's own defaults
    (`orcadata.cpp:209-470`)."""

    method: str = "scf"
    functional: str = "bp"
    scf_type: str = "rhf"
    cos_x: bool = False
    aux_basis: str = "svp"
    aux_corr_basis: str = "svp"
    epc: bool = False
    print_level: str = "normal"
    grid: str = "grid4"
    final_grid: str = "default"
    cosx_grid: str = "grid4"
    cosx_final_grid: str = "default"
    accuracy: str = "normal"
    relativistic: str = "none"
    dkh_order: int = 0
    max_iter: int = 125
    damping: bool = False
    damp_factor: float = 0.7
    damp_error: float = 0.1
    level_shift: bool = False
    shift: float = 0.25
    shift_error: float = 0.001
    converger: str = "diis"
    second_converger: str = "soscf"
    print_mos: bool = False
    print_basis: bool = False


def _advanced_keywords(basis: str, task: str, options: AdvancedOptions) -> str:
    """Advanced mode's `!` line, word for word as `:1085-1140` builds it."""
    words = _method_words(options.method, options.functional, options.scf_type)
    words.append(CALCULATIONS[task])
    words.append(BASIS_SETS[basis])
    dft = options.method == "dft"
    if options.cos_x or dft:
        words.append(f"{BASIS_SETS[options.aux_basis]}/J")
    if options.method == "mp2":
        words.append(f"{BASIS_SETS[options.aux_corr_basis]}/C")
    if options.epc:
        inside = [BASIS_SETS[basis]]
        if options.cos_x or dft:
            inside.append(f"{BASIS_SETS[options.aux_basis]}/J")
        if options.method == "mp2":
            inside.append(f"{BASIS_SETS[options.aux_corr_basis]}/C")
        words.append("EPC{" + ",".join(inside) + "}")
    if PRINT_LEVELS[options.print_level]:
        words.append(PRINT_LEVELS[options.print_level])
    if dft:
        words += [w for w in (GRIDS[options.grid], FINAL_GRIDS[options.final_grid]) if w]
    if options.cos_x:
        words.append("RijCosX")
        words += [
            w
            for w in (
                COSX_GRIDS[options.cosx_grid],
                COSX_FINAL_GRIDS[options.cosx_final_grid],
            )
            if w
        ]
    words.append(ACCURACIES[options.accuracy])
    if RELATIVISTIC[options.relativistic]:
        relativistic = RELATIVISTIC[options.relativistic]
        # DKH takes its order right after the keyword, with nothing between
        words.append(
            f"{relativistic}{options.dkh_order}" if options.relativistic == "dkh" else relativistic
        )
    return "! " + " ".join(words)


def _scf_block(options: AdvancedOptions) -> list[str]:
    """The `%scf` block (`:1142-1167`), tabs and all."""
    lines = ["%scf", f"\tMaxIter {options.max_iter}"]
    if options.damping:
        lines += [
            "\tCNVDamp 1",
            f"\tDampFac {options.damp_factor}",
            f"\tDampErr {options.damp_error}",
        ]
    if options.level_shift:
        lines += [
            "\tCNVShift 1",
            f"\tLevelShift {options.shift}",
            f"\tShiftErr {options.shift_error}",
        ]
    lines.append(f"\t{CONVERGERS[options.converger]}")
    if SECOND_CONVERGERS[options.second_converger]:
        lines.append(f"\t{SECOND_CONVERGERS[options.second_converger]}")
    return [*lines, "end"]


def _output_block(options: AdvancedOptions) -> list[str]:
    """`%output`, written only when there is something to print (`:1177-1185`)."""
    if not (options.print_mos or options.print_basis):
        return []
    lines = ["%output"]
    if options.print_mos:
        lines.append("\tprint[p_mos] true")
    if options.print_basis:
        lines.append("\tprint[p_basis] 5")
    return [*lines, "end"]


def orca_deck(
    structure: Structure,
    *,
    comment: str,
    basis: str = "svp",
    task: str = "energy",
    charge: int = 0,
    multiplicity: int = 1,
    coordinates: str = "cartesian",
    method: str = "rhf",
    advanced: AdvancedOptions | None = None,
    nprocs: int = 1,
    memory_mb: int = 2000,
    extra: str = "",
) -> str:
    """One ORCA deck, in Basic mode unless `advanced` carries the Advanced tabs' answers."""
    if basis not in BASIS_SETS:
        msg = f"unknown ORCA basis set {basis!r}"
        raise ValueError(msg)
    if task not in CALCULATIONS:
        msg = f"ORCA has no calculation for {task!r}"
        raise ValueError(msg)
    if advanced is None and method not in BASIC_METHODS:
        msg = f"unknown ORCA method {method!r}"
        raise ValueError(msg)

    if advanced is None:
        lines = [
            "# Atomscope generated ORCA input file",
            "# Basic Mode",
            f"# {comment}",
            _basic_keywords(method, basis, task),
        ]
    else:
        lines = [
            "## Atomscope generated ORCA input file",
            "# Advanced Mode",
            f"# {comment}",
            _advanced_keywords(basis, task, advanced),
            *_scf_block(advanced),
            *_output_block(advanced),
        ]
    # neither box is the dialog's: ORCA has no processor or memory tab, and these are ours
    lines += [f"%pal nprocs {nprocs} end", f"%maxcore {memory_mb}"]
    if extra.strip():
        lines += [line.strip() for line in extra.strip().splitlines()]
    lines.append("")
    if coordinates == "cartesian":
        lines += _cartesian(structure, charge, multiplicity)
    else:
        lines += _internal(structure, charge, multiplicity)
    return "\n".join(lines) + "\n"
