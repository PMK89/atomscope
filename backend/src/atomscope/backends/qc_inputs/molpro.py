"""Molpro input decks (AV-QM-008), from Avogadro's dialog.

`molproinputdialog.cpp:generateInputDeck` (`:244-426`) writes: a `***` title line, two `gprint`
directives, the basis, the geometry in one of three layouts, the wavefunction blocks and the
calculation. The lists are its four combos (`getCalculationType`, `getTheoryType`,
`getBasisType` and the version box), and its enums and combo items are in the same order
throughout (`molproinputdialog.h:46-49`).

Two blocks carry the wavefunction. A reference is written for every theory but B3LYP -- `{rhf`
with a `wf,` line -- and the theory's own block for every theory but Hartree-Fock, so a
correlated run gets both and B3LYP gets only its own (`:404-413`). The `wf` line is the electron
count (the nuclear charge less the molecular one), the space symmetry and twice the spin;
`getWavefunction` (`:428-444`) leaves the symmetry at 1 with a `TODO` beside it, and so do we,
which is exact while symmetry is switched off and an assumption for a Cartesian open-shell run.

The version box is what the deck's dialect turns on: before 2009.1 a Cartesian geometry is
introduced by `geomtyp=xyz` and an atom count, and a Z-matrix names `nosym` and `ang` inside its
block; from 2009.1 the Cartesian block carries neither and the Z-matrix says `symmetry,nosym`
above it instead.

Three departures.

* **A compact Z-matrix at 2009.1 switched symmetry off in neither way.** The verbose branch
  writes `symmetry,nosym` above the block (`:322-324`) and both pre-2009 branches write `nosym`
  inside it, but the compact branch writes nothing at all for 2009.1 (`:355-359`) -- so the same
  geometry in the same version gets symmetry detection in one layout and not in the other, and
  Molpro is free to reorient the molecule the Z-matrix is written against. Written for both here.
* `{optg}` is written above `{frequencies}`, so asking for frequencies optimizes first
  (`:453-455`). Kept: a frequency at a geometry that is not stationary is not a frequency. The
  row and the form say so rather than leaving it to be discovered.
* The title line is `*** ` with the title after it; an empty title left the trailing space
  behind, which is not written here.

The theory list is Hartree-Fock, MP2, B3LYP, CCSD and CCSD(T), and B3LYP is `uks,b3lyp` --
unrestricted even for a closed shell, which is the dialog's choice and is kept, since `rks`
would be a keyword we invented.
"""

from __future__ import annotations

from atomscope.chem.zmatrix import zmatrix
from atomscope.model import Structure

CALCULATIONS = {"energy": [], "optimize": ["{optg}"], "frequencies": ["{optg}", "{frequencies}"]}
"""`getCalculationType` (`:446-459`), as lines. A single point asks for nothing: the wavefunction
blocks above it are the calculation."""

THEORIES = {
    "rhf": "rhf",
    "mp2": "mp2",
    "b3lyp": "uks,b3lyp",
    "ccsd": "ccsd",
    "ccsdt": "ccsd(t)",
}
"""`getTheoryType` (`:461-481`)."""

THEORY_LABELS = {
    "rhf": "HF",
    "mp2": "MP2",
    "b3lyp": "B3LYP",
    "ccsd": "CCSD",
    "ccsdt": "CCSD(T)",
}
"""...as the combo spells them, which for Hartree-Fock is not the keyword."""

BASIS_SETS = {
    "sto3g": "STO-3G",
    "b321g": "3-21G",
    "b631gd": "6-31G(d)",
    "b631gdp": "6-31G(d,p)",
    "b631plusgd": "6-31+G(d)",
    "b6311gd": "6-311G(d)",
    "ccpvdz": "vdz",
    "ccpvtz": "vtz",
    "augccpvdz": "avdz",
    "augccpvtz": "avtz",
}
"""`getBasisType` (`:483-511`). The correlation-consistent four are Molpro's own short names."""

BASIS_LABELS = {
    "sto3g": "STO-3G",
    "b321g": "3-21G",
    "b631gd": "6-31G(d)",
    "b631gdp": "6-31G(d,p)",
    "b631plusgd": "6-31+G(d)",
    "b6311gd": "6-311G(d)",
    "ccpvdz": "cc-pVDZ",
    "ccpvtz": "cc-pVTZ",
    "augccpvdz": "AUG-cc-pVDZ",
    "augccpvtz": "AUG-cc-pVTZ",
}

VERSIONS = {"pre2009": "before 2009.1", "v2009": "2009.1"}
"""The version combo. The dialog opens on the older dialect, and so do we."""


def _wavefunction(structure: Structure, charge: int, multiplicity: int) -> str:
    """`getWavefunction`: the electron count, the space symmetry and twice the spin."""
    electrons = sum(a.atomic_number for a in structure.atoms) - charge
    return f"wf,{electrons},1,{multiplicity - 1}"


def _cartesian(structure: Structure, *, v2009: bool) -> list[str]:
    """`:265-285`. Before 2009.1 the block is an embedded xyz file, count and comment line and
    all; from 2009.1 it is the atoms alone."""
    atoms = [
        f"{a.element:<2}{a.position[0]:15.5f}{a.position[1]:15.5f}{a.position[2]:15.5f}"
        for a in structure.atoms
    ]
    if v2009:
        return ["geometry={", *atoms, "}"]
    return ["geomtyp=xyz", "geometry={", str(len(structure.atoms)), "", *atoms, "}"]


def _zmatrix(structure: Structure, *, v2009: bool, compact: bool) -> list[str]:
    """The two Z-matrix layouts (`:287-402`).

    The verbose one names its values above the block, each with its unit, and refers to them by
    name inside it; the compact one writes the numbers in place, unpadded. Symmetry is switched
    off either way -- `symmetry,nosym` above the block from 2009.1, `nosym` inside it before --
    which the compact branch did not do for 2009.1 at all.
    """
    rows = zmatrix(structure)
    variables: list[str] = []
    lines: list[str] = []
    for i, row in enumerate(rows):
        line = row.element
        for name, reference, value, unit in (
            ("r", row.a, row.distance, "ang"),
            ("a", row.b, row.angle, "degree"),
            ("d", row.c, row.torsion, "degree"),
        ):
            if reference is None or value is None:
                break
            if compact:
                line += f", {reference + 1}, {value:.5f}"
            else:
                line += f", {reference + 1}, {name}{i + 1}"
                variables.append(f"   {name}{i + 1} = {value:15.5f} {unit}")
        lines.append(line)
    out = [*variables]
    if v2009:
        out.append("symmetry,nosym")
    out.append("geometry={")
    if not v2009:
        out.append("nosym")
    # the verbose layout carries its units on the variables; before 2009.1 the block says so too
    if compact or not v2009:
        out.append("ang")
    return [*out, *lines, "}"]


def molpro_deck(
    structure: Structure,
    *,
    title: str,
    theory: str = "rhf",
    basis: str = "b631gd",
    task: str = "energy",
    charge: int = 0,
    multiplicity: int = 1,
    coordinates: str = "cartesian",
    version: str = "pre2009",
    extra: str = "",
) -> str:
    """One Molpro deck, in the order Avogadro's dialog writes it."""
    if theory not in THEORIES:
        msg = f"unknown Molpro theory {theory!r}"
        raise ValueError(msg)
    if basis not in BASIS_SETS:
        msg = f"unknown Molpro basis set {basis!r}"
        raise ValueError(msg)
    if task not in CALCULATIONS:
        msg = f"Molpro has no calculation for {task!r}"
        raise ValueError(msg)
    if version not in VERSIONS:
        msg = f"unknown Molpro version {version!r}"
        raise ValueError(msg)

    v2009 = version == "v2009"
    lines = [f"*** {title}".rstrip(), "", "gprint,basis", "gprint,orbital"]
    if extra.strip():
        lines += [line.strip() for line in extra.strip().splitlines()]
    lines += ["", f"basis, {BASIS_SETS[basis]}", ""]
    if coordinates == "zmatrix":
        lines += _zmatrix(structure, v2009=v2009, compact=False)
    elif coordinates == "zmatrix_compact":
        lines += _zmatrix(structure, v2009=v2009, compact=True)
    else:
        lines += _cartesian(structure, v2009=v2009)
    lines.append("")
    wavefunction = _wavefunction(structure, charge, multiplicity)
    # a reference for everything but B3LYP, and the theory's own block for everything but HF
    if theory != "b3lyp":
        lines += ["{rhf", f"{wavefunction}}}"]
    if theory != "rhf":
        lines += ["{" + THEORIES[theory], f"{wavefunction}}}"]
    lines.append("")
    lines += CALCULATIONS[task]
    if CALCULATIONS[task]:
        lines.append("")
    return "\n".join([*lines, "---", ""])
