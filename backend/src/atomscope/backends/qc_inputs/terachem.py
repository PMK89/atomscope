"""TeraChem input decks (AV-QM-013), from Avogadro's dialog.

`teracheminputdialog.cpp:generateInputDeck` (`:296-328`) writes a keyword file: a comment header
carrying the title, then `run`, `method`, an optional `dispersion`, `basis`, `charge`, `spinmul`,
a `coordinates` line and `end`. Every keyword is padded to fifteen columns. The lists are its
five combos (`getCalculationType`, `getTheoryType`, `getBasisType`, `getDispType`,
`getCoordType`), whose enums and items agree throughout (`teracheminputdialog.h:47-51`), and
whose `resetClicked` (`:180-190`) restores exactly what the constructor opens with.

The theory keyword carries the restriction: an unrestricted run prepends `u`, so B3LYP becomes
`ub3lyp`, and Hartree-Fock is `rhf` or `uhf` rather than taking a prefix.

Two departures.

* **The deck names a coordinate file it never wrote.** `coordinates` is the base name of whatever
  file the molecule came from plus `.pdb` or `.xyz` (`:319-323`), and nothing writes that file --
  so the deck alone runs nothing, and for a molecule that was never saved the base name is empty
  and the line reads `coordinates    .pdb`, pointing at a file that cannot exist. Written here as
  a pair, the deck and the geometry it names, the way the Dalton generator writes its own.
* The combo spells the Protein Data Bank format `PBD`; the deck writes `.pdb`, which is right,
  and the label here says PDB.
"""

from __future__ import annotations

CALCULATIONS = {"energy": "energy", "gradient": "gradient", "optimize": "minimize"}
"""`getCalculationType`. Its gradient run has no equivalent in the shared calculation box, so it
is offered in the TeraChem section instead."""

THEORIES = ("hf", "blyp", "b3lyp", "b3lyp1", "b3lyp5", "pbe", "revpbe")
"""`getTheoryType`, before the restriction is applied."""

THEORY_LABELS = {
    "hf": "HF",
    "blyp": "BLYP",
    "b3lyp": "B3LYP",
    "b3lyp1": "B3LYP1",
    "b3lyp5": "B3LYP5",
    "pbe": "PBE",
    "revpbe": "REVPBE",
}
"""...as the combo spells them."""

BASIS_SETS = {
    "sto3g": "sto-3g",
    "b321g": "3-21G",
    "b631gd": "6-31G(d)",
    "b631gdp": "6-31G(d,p)",
    "b631plusgd": "6-31+G(d)",
    "b6311gd": "6-311G(d)",
    "ccpvdz": "cc-pVDZ",
}
"""`getBasisType`; the first is the only one it spells in lower case."""

BASIS_LABELS = {
    "sto3g": "STO-3G",
    "b321g": "3-21G",
    "b631gd": "6-31G(d)",
    "b631gdp": "6-31G(d,p)",
    "b631plusgd": "6-31+G(d)",
    "b6311gd": "6-311G(d)",
    "ccpvdz": "cc-pVDZ",
}

DISPERSIONS = {"none": "no", "yes": "yes", "d2": "d2", "d3": "d3"}
"""`getDispType`; `no` is the one the deck leaves the line out for."""

COORDINATE_FORMATS = {"xyz": ".xyz", "pdb": ".pdb"}
"""`getCoordType`, and the file this generator now writes beside the deck."""

_WIDTH = 15
"""Every keyword is padded to fifteen columns (`:305-318`)."""


def theory_keyword(theory: str, *, unrestricted: bool) -> str:
    """`getTheoryType` (`:331-357`): an unrestricted run prepends `u`, and Hartree-Fock is spelled
    `rhf` or `uhf` rather than taking the prefix."""
    if theory not in THEORIES:
        msg = f"unknown TeraChem theory {theory!r}"
        raise ValueError(msg)
    if theory == "hf":
        return "uhf" if unrestricted else "rhf"
    return f"u{theory}" if unrestricted else theory


def terachem_deck(
    *,
    title: str,
    coordinate_file: str,
    theory: str = "hf",
    basis: str = "sto3g",
    task: str = "energy",
    charge: int = 0,
    multiplicity: int = 1,
    dispersion: str = "none",
    unrestricted: bool = False,
    extra: str = "",
) -> str:
    """One TeraChem deck, in the order Avogadro's dialog writes it.

    `coordinate_file` is the name of the geometry file the deck points at; this generator writes
    that file too, which the dialog did not.
    """
    if basis not in BASIS_SETS:
        msg = f"unknown TeraChem basis set {basis!r}"
        raise ValueError(msg)
    if task not in CALCULATIONS:
        msg = f"TeraChem has no run type for {task!r}"
        raise ValueError(msg)
    if dispersion not in DISPERSIONS:
        msg = f"unknown TeraChem dispersion correction {dispersion!r}"
        raise ValueError(msg)

    def keyword(key: str, value: object) -> str:
        return f"{key:<{_WIDTH}}{value}"

    lines = [
        "#",
        f"# {title}",
        "#",
        "",
        keyword("run", CALCULATIONS[task]),
        "",
        keyword("method", theory_keyword(theory, unrestricted=unrestricted)),
    ]
    # the dispersion line is written for every correction but `no`
    if dispersion != "none":
        lines.append(keyword("dispersion", DISPERSIONS[dispersion]))
    lines += [
        keyword("basis", BASIS_SETS[basis]),
        keyword("charge", charge),
        keyword("spinmul", multiplicity),
        "",
        keyword("coordinates", coordinate_file),
        "",
    ]
    if extra.strip():
        lines += [line.strip() for line in extra.strip().splitlines()] + [""]
    lines += ["", "end"]
    return "\n".join(lines) + "\n"
