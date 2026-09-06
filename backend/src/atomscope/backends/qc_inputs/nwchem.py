"""NWChem input decks (AV-QM-009), from Avogadro's dialog.

`nwcheminputdialog.cpp:generateInputDeck` (`:249-463`) writes: `echo`, `start molecule`, the
title, the charge, a `geometry units angstroms print` block in one of three layouts, a `basis`
block, the theory's own block where it has one, and the `task <level> <calculation>` line that
runs it. The lists are its three combos (`getCalculationType`, `getTheoryType`, `getBasisType`),
whose enums and items agree throughout (`nwcheminputdialog.h:47-50`).

Its nine basis labels and nine keywords are the same basis sets in two notations -- the combo
says `6-31G(d)` where the deck asks for `6-31G*` -- so unlike the GAMESS-UK dialog nothing is
promised that the deck does not request, and both spellings are kept: the label the combo used
and the keyword it wrote.

Three departures.

* **The multiplicity box reached one theory in four.** `mult` is written inside the `dft` block
  and nowhere else (`:420-439`), so a doublet asked for under Hartree-Fock, MP2 or CCSD was
  written into a deck that says nothing about spin and runs closed-shell. Here an open shell
  writes an `scf` block with `nopen`, which is the number of singly occupied orbitals, above the
  theory's own block.
* **A compact Z-matrix named `zmatrix` on the geometry line** rather than inside the block
  (`:352`, against `:286` for the verbose one), where NWChem reads a sub-directive. Written on
  its own line for both.
* **A compact Z-matrix never closed its `zmatrix` block.** The verbose branch writes ` end`
  before the geometry's own `end` (`:346`); the compact branch writes none, so the block that
  opened was closed by the geometry's. Written for both.

The dialog's `resetClicked` (`:153-164`) puts the theory combo at index 3, CCSD, which is not
the B3LYP the constructor and the `.ui` open with -- the same slip, at the same index, as the
Q-Chem and Molpro dialogs.
"""

from __future__ import annotations

from atomscope.chem.zmatrix import zmatrix
from atomscope.model import Structure

CALCULATIONS = {"energy": "energy", "optimize": "optimize", "frequencies": "freq"}
"""`getCalculationType` (`:465-478`); the second word of the `task` line."""

THEORIES = {"rhf": "scf", "mp2": "mp2", "b3lyp": "dft", "ccsd": "ccsd"}
"""The first word of the `task` line (`:441-462`). It is also the block each theory opens, which
is why Hartree-Fock opens none: `scf` is what NWChem does without being told."""

THEORY_LABELS = {"rhf": "HF", "mp2": "MP2", "b3lyp": "B3LYP", "ccsd": "CCSD"}
"""...as the combo spells them."""

FROZEN_CORE = ("mp2", "ccsd")
"""The two that write `freeze atomic`, with the dialog's own comment above it (`:425-434`)."""

BASIS_SETS = {
    "sto3g": "STO-3G",
    "b321g": "3-21G",
    "b631gd": "6-31G*",
    "b631gdp": "6-31G**",
    "b631plusgd": "6-31+G*",
    "b6311gd": "6-311G*",
    "ccpvdz": "cc-pVDZ",
    "ccpvtz": "cc-pVTZ",
    "lanl2dz": "LANL2DZ ECP",
}
"""`getBasisType` (`:497-528`)."""

BASIS_LABELS = {
    "sto3g": "STO-3G",
    "b321g": "3-21G",
    # the same basis sets the keywords name, in the notation the combo used
    "b631gd": "6-31G(d)",
    "b631gdp": "6-31G(d,p)",
    "b631plusgd": "6-31+G(d)",
    "b6311gd": "6-311G(d)",
    "ccpvdz": "cc-pVDZ",
    "ccpvtz": "cc-pVTZ",
    "lanl2dz": "LANL2DZ",
}

SPHERICAL_BASES = ("ccpvdz", "ccpvtz")
"""Dunning's sets are spherical, and the `basis` line says so (`:406-408`)."""


def _label(structure: Structure, index: int) -> str:
    """`C1`, `O2`, ... -- the compact Z-matrix names an atom by its element and its number."""
    return f"{structure.atoms[index].element}{index + 1}"


def _cartesian(structure: Structure) -> list[str]:
    """The Qt field widths of `:275-282`: 4 for the symbol, 15 per coordinate."""
    return [
        f"{a.element:>4}{a.position[0]:15.5f}{a.position[1]:15.5f}{a.position[2]:15.5f}"
        for a in structure.atoms
    ]


def _zmatrix(structure: Structure, *, compact: bool) -> list[str]:
    """The two Z-matrix layouts (`:284-403`), each closed by its own ` end`."""
    rows = zmatrix(structure)
    lines: list[str] = []
    variables: list[str] = []
    for i, row in enumerate(rows):
        line = f"{_label(structure, i):>4}" if compact else f"{row.element:>3}"
        for name, reference, value in (
            ("r", row.a, row.distance),
            ("a", row.b, row.angle),
            ("d", row.c, row.torsion),
        ):
            if reference is None or value is None:
                break
            if compact:
                line += f"{_label(structure, reference):>6}{value:15.5f}"
            else:
                variable = f"{name}{i + 1}"
                line += f"  {reference + 1:>3}  {variable:>4}"
                variables.append(f"   {variable}{value:15.5f}")
        lines.append(line)
    if compact:
        return [" zmatrix", *lines, " end"]
    return [" zmatrix", *lines, " variables", *variables, " end"]


def nwchem_deck(
    structure: Structure,
    *,
    title: str,
    theory: str = "b3lyp",
    basis: str = "b631gd",
    task: str = "energy",
    charge: int = 0,
    multiplicity: int = 1,
    coordinates: str = "cartesian",
    extra: str = "",
) -> str:
    """One NWChem deck, in the order Avogadro's dialog writes it."""
    if theory not in THEORIES:
        msg = f"unknown NWChem theory {theory!r}"
        raise ValueError(msg)
    if basis not in BASIS_SETS:
        msg = f"unknown NWChem basis set {basis!r}"
        raise ValueError(msg)
    if task not in CALCULATIONS:
        msg = f"NWChem has no task for {task!r}"
        raise ValueError(msg)

    lines = ["echo", "", "start molecule", "", f'title "{title}"', f"charge {charge}", ""]
    if coordinates == "cartesian":
        lines += ["geometry units angstroms print xyz autosym", *_cartesian(structure)]
    else:
        lines += [
            "geometry units angstroms print",
            *_zmatrix(structure, compact=coordinates == "zmatrix_compact"),
        ]
    lines += ["end", ""]

    spherical = " spherical" if basis in SPHERICAL_BASES else ""
    lines += [f"basis{spherical}", f"  * library {BASIS_SETS[basis]}", "end", ""]

    # the dialog wrote the multiplicity into the DFT block alone, so three theories in four
    # carried a spin nothing in the deck said; `nopen` is how the SCF block is told
    if theory != "b3lyp" and multiplicity > 1:
        lines += ["scf", f"  nopen {multiplicity - 1}", "end", ""]
    if theory == "b3lyp":
        lines += ["dft", "  xc b3lyp", f"  mult {multiplicity}", "end", ""]
    elif theory in FROZEN_CORE:
        lines += [
            THEORIES[theory],
            f"  # Exclude core electrons from {theory.upper()} treatment",
            "  freeze atomic",
            "end",
            "",
        ]
    if extra.strip():
        lines += [line.strip() for line in extra.strip().splitlines()] + [""]
    lines.append(f"task {THEORIES[theory]} {CALCULATIONS[task]}")
    return "\n".join(lines) + "\n"
