"""Q-Chem input decks (AV-QM-010), from Avogadro's dialog.

`qcheminputdialog.cpp:generateInputDeck` writes four sections: `$rem` with the job type, the
exchange functional and the basis set; `$comment` with the title; `$molecule` with the charge,
the multiplicity and the geometry; and nothing else. The lists are its own three combos
(`getCalculationType`, `getTheoryType`, `getBasisType`), and the coordinate layouts are the same
three the Gaussian dialog offers, which is what `chem/zmatrix.py` is for.
"""

from __future__ import annotations

from atomscope.chem.zmatrix import zmatrix
from atomscope.model import Structure

CALCULATIONS = {"energy": "SP", "optimize": "Opt", "frequencies": "Freq"}
"""`getCalculationType`; the dialog has no transition-state entry."""

THEORIES = {
    "rhf": "RHF",
    "b3lyp": "B3LYP",
    "b3lyp5": "B3LYP5",
    "edf1": "EDF1",
    "m062x": "M062X",
    "mp2": "HF\n   CORRELATION MP2",
    "ccsd": "HF\n   CORRELATION CCSD",
}
"""`getTheoryType`. The last two are a Hartree-Fock reference and a correlation keyword beside
it, which is why two of these carry a line of their own."""

THEORY_LABELS = {
    "rhf": "RHF",
    "b3lyp": "B3LYP",
    "b3lyp5": "B3LYP5",
    "edf1": "EDF1",
    "m062x": "M06-2X",
    "mp2": "MP2",
    "ccsd": "CCSD",
}
"""...as its combo spells them, which is not always the keyword."""

BASIS_SETS = {
    "sto3g": "BASIS STO-3G",
    "b321g": "BASIS 3-21G",
    "b631gd": "BASIS 6-31G(d)",
    "b631gdp": "BASIS 6-31G(d,p)",
    "b631plusgd": "BASIS 6-31+G(d)",
    "b6311gd": "BASIS 6-311G(d)",
    "ccpvdz": "BASIS cc-pVDZ",
    "ccpvtz": "BASIS cc-pVTZ",
    "lanl2dz": "ECP LANL2DZ",
    "lacvp": "ECP LACVP",
}
"""`getBasisType`. The last two are effective core potentials, and Q-Chem takes them under `ECP`
rather than `BASIS`, which is why the keyword is part of the entry rather than a prefix."""


BASIS_LABELS = {
    "sto3g": "STO-3G",
    "b321g": "3-21G",
    "b631gd": "6-31G(d)",
    "b631gdp": "6-31G(d,p)",
    "b631plusgd": "6-31+G(d)",
    "b6311gd": "6-311G(d)",
    "ccpvdz": "cc-pVDZ",
    "ccpvtz": "cc-pVTZ",
    "lanl2dz": "LANL2DZ (ECP)",
    "lacvp": "LACVP (ECP)",
}


def _label(structure: Structure, index: int) -> str:
    """`C1`, `O2`, ... -- Q-Chem's Z-matrix names an atom by its element and its number."""
    return f"{structure.atoms[index].element}{index + 1}"


def _cartesian(structure: Structure) -> list[str]:
    return [
        f"{a.element:>4}{a.position[0]:15.5f}{a.position[1]:15.5f}{a.position[2]:15.5f}"
        for a in structure.atoms
    ]


def _zmatrix(structure: Structure, *, compact: bool) -> list[str]:
    """The two Z-matrix layouts, in the shape `qcheminputdialog.cpp:265-333` writes them."""
    rows = zmatrix(structure)
    lines: list[str] = []
    variables: list[str] = []
    for i, row in enumerate(rows):
        line = f"{_label(structure, i):>4}"
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
                line += f" {_label(structure, reference)} {name}{i + 1}"
                variables.append(f"   {name}{i + 1} = {value:15.5f}")
        lines.append(line)
    if compact:
        return lines
    return [*lines, "", *variables]


def qchem_deck(
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
    """One Q-Chem deck, section by section as Avogadro's dialog writes them."""
    if theory not in THEORIES:
        msg = f"unknown Q-Chem theory {theory!r}"
        raise ValueError(msg)
    if basis not in BASIS_SETS:
        msg = f"unknown Q-Chem basis set {basis!r}"
        raise ValueError(msg)
    if task not in CALCULATIONS:
        msg = f"Q-Chem has no job type for {task!r}"
        raise ValueError(msg)

    lines = [
        "$rem",
        f"   JOBTYPE {CALCULATIONS[task]}",
        f"   EXCHANGE {THEORIES[theory]}",
        f"   {BASIS_SETS[basis]}",
        # what makes the log readable afterwards: Q-Chem writes a checkpoint the analysis can read
        "   GUI=2",
    ]
    if extra.strip():
        lines += [f"   {line.strip()}" for line in extra.strip().splitlines()]
    lines += ["$end", "", "$comment", title, "$end", "", "$molecule", f"   {charge} {multiplicity}"]
    if coordinates == "zmatrix":
        lines += _zmatrix(structure, compact=False)
    elif coordinates == "zmatrix_compact":
        lines += _zmatrix(structure, compact=True)
    else:
        lines += _cartesian(structure)
    lines += ["$end", ""]
    return "\n".join(lines) + "\n"
