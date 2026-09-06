"""Gaussian input decks, in the shape Avogadro 1's Gaussian dialog wrote them.

`gaussianinputdialog.cpp:558-707`: link-0 lines, then a route line
``#n <theory>[/<basis>] <calculation> [<output keywords>]``, a blank line, the title, another
blank line, the charge and multiplicity, and the geometry -- Cartesian or one of two Z-matrix
layouts. A semi-empirical theory takes no basis set, which the dialog enforced by disabling the
basis box; here the route line simply leaves it out.

The output box is Gaussian's own keywords for printing the basis and the orbitals, which is what
makes a log a wavefunction another program can read: ``gfprint pop=full`` for Molden's reader,
``gfoldprint pop=full`` for Molekel's.
"""

from __future__ import annotations

from atomscope.chem.zmatrix import zmatrix
from atomscope.model import Structure

"""Methods Gaussian runs without a basis set. Avogadro offered the first two."""
SEMI_EMPIRICAL = frozenset(
    {"AM1", "PM3", "PM3MM", "PM6", "PM7R", "PDDG", "MNDO", "INDO", "CNDO", "DFTBA"}
)

"""What the Output box adds to the route line (`gaussianinputdialog.cpp:513-525`)."""
OUTPUT_KEYWORDS = {
    "standard": "",
    "molden": "gfprint pop=full",
    "molekel": "gfoldprint pop=full",
}

TASK_KEYWORDS = {"energy": "SP", "optimize": "Opt", "frequencies": "Opt Freq"}


def _cartesian(structure: Structure) -> list[str]:
    return [
        f"{a.element:<3}{a.position[0]:15.5f}{a.position[1]:15.5f}{a.position[2]:15.5f}"
        for a in structure.atoms
    ]


def _zmatrix(structure: Structure, *, compact: bool) -> list[str]:
    """The two Z-matrix layouts: values in a Variables section, or in line with the references."""
    rows = zmatrix(structure)
    lines: list[str] = []
    variables: list[str] = []
    for i, row in enumerate(rows):
        line = f"{row.element:<3}"
        for name, reference, value in (
            ("B", row.a, row.distance),
            ("A", row.b, row.angle),
            ("D", row.c, row.torsion),
        ):
            if reference is None or value is None:
                break
            if compact:
                line += f"{reference + 1:>6}{value:15.5f}"
            else:
                line += f" {reference + 1} {name}{i}"
                variables.append(f"{name}{i}{value:15.5f}")
        lines.append(line.rstrip())
    if compact:
        return lines
    return [*lines, "Variables:", *variables]


def gaussian_deck(
    structure: Structure,
    *,
    title: str,
    method: str,
    basis: str,
    task: str,
    charge: int,
    multiplicity: int,
    nprocs: int = 1,
    memory_mb: int = 0,
    extra: str = "",
    output: str = "standard",
    checkpoint: str = "",
    coordinates: str = "cartesian",
) -> str:
    """One Gaussian deck. `checkpoint` is the name to write into ``%Chk``, empty for none."""
    lines: list[str] = []
    if nprocs > 1:
        lines.append(f"%NProcShared={nprocs}")
    if memory_mb:
        lines.append(f"%Mem={memory_mb}MB")
    if checkpoint:
        lines.append(f"%Chk={checkpoint}")
    route = f"#n {method}"
    if method.upper() not in SEMI_EMPIRICAL:
        route += f"/{basis}"
    route += f" {TASK_KEYWORDS[task]}"
    for keywords in (OUTPUT_KEYWORDS.get(output, ""), extra):
        if keywords.strip():
            route += f" {keywords.strip()}"
    lines += [route, "", f" {title}", "", f"{charge} {multiplicity}"]
    if coordinates == "cartesian":
        lines += _cartesian(structure)
    else:
        lines += _zmatrix(structure, compact=coordinates == "zmatrix_compact")
    # Gaussian reads the deck until a blank line, and wants one at the end of the file
    return "\n".join([*lines, ""]) + "\n"
