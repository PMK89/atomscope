"""Psi4 input decks (AV-QM-012), from Avogadro's dialog.

`psi4inputdialog.cpp:generateInputDeck` (`:225-251`) writes a psithon script of four things: a
`set basis` line, a `molecule {}` block holding the charge, the multiplicity and the Cartesian
geometry, `auto_fragments('')` when the theory is one of the two SAPT ones, and the call that runs
the job -- `energy('scf')` and its two siblings. The three lists are the three combos
(`getCalculationType`, `getTheoryType`, `getBasisType`), and this is the first of these dialogs
whose enums and combo items are in the same order all the way through
(`psi4inputdialog.h:47-49`), so no index has to be corrected. The geometry is written from
`m_molecule->atoms()` in index order, so unlike the Q-Chem dialog there is no fragment reordering
to depart from.

Three departures.

* **The title box reaches no output.** `titleLine` is on the form and `setTitle` (`:188-192`)
  fills `m_title`, but `generateInputDeck` never writes it, so naming a job there does nothing at
  all. We write it as a `#` comment, which is what psithon (Python) reads it as; an empty title
  writes no line, as the dialog's absence of one does.
* **`set basis` comes out with two spaces**: the writer emits `"set basis "` (`:232`) and
  `getBasisType` returns each name with a leading space of its own (`:302-314`). We write one.
* **Reset does not restore what the dialog opened with**: the constructor and the `.ui` agree on
  energy / SAPT0 / jun-cc-pVDZ (`:44-45`, combo `currentIndex` 0/1/1), and `resetClicked`
  (`:147-149`) puts all three combos back to index 0 -- energy / scf / STO-3G. This is the same
  slip the Q-Chem dialog has.

And one choice that is ours rather than a reading. Avogadro opens on SAPT0, whose deck calls
`auto_fragments('')`: a symmetry-adapted perturbation theory run is a calculation on two
interacting fragments, and Psi4 rejects it outright for a single molecule. Since a single
molecule is what this form is usually pointed at, our default theory is `scf` -- the combo's
first entry, and the one Avogadro's own Reset lands on -- while the basis stays at the
constructor's jun-cc-pVDZ. Choosing SAPT for a structure that holds one fragment raises a
validation warning rather than being silently corrected.
"""

from __future__ import annotations

from atomscope.model import Structure

CALCULATIONS = {"energy": "energy", "optimize": "optimize", "frequencies": "frequencies"}
"""`getCalculationType`; the psithon function that runs the job. No transition-state entry."""

THEORIES = {
    "scf": "scf",
    "sapt0": "sapt0",
    "sapt2": "sapt2",
    "b3lypd": "B3LYP-D",
    "b97d": "B97-D",
    "m052x": "m05-2x",
    "mp2": "MP2",
    "ccsd": "CCSD",
    "ccsdt": "CCSD(T)",
}
"""`getTheoryType`, case for case: Psi4 reads a method name case-insensitively, and the dialog
spells them inconsistently, so these are copied rather than tidied."""

THEORY_LABELS = {
    "scf": "HF",
    "sapt0": "SAPT0",
    "sapt2": "SAPT2",
    "b3lypd": "B3LYP-D",
    "b97d": "B97-D",
    "m052x": "M05-2X",
    "mp2": "MP2",
    "ccsd": "CCSD",
    "ccsdt": "CCSD(T)",
}
"""...as the combo spells them, which for Hartree-Fock is not the keyword."""

SAPT_THEORIES = ("sapt0", "sapt2")
"""The two that make the deck call `auto_fragments('')` (`psi4inputdialog.cpp:246`)."""

BASIS_SETS = {
    "sto3g": "STO-3G",
    "jundz": "jun-cc-pVDZ",
    "ccpvdz": "cc-pVDZ",
    "augccpvdz": "aug-cc-pVDZ",
    "ccpvtz": "cc-pVTZ",
}
"""`getBasisType`, without the leading space it returns them with."""

BASIS_LABELS = dict(BASIS_SETS)
"""The combo spells the basis sets exactly as it writes them."""


def _cartesian(structure: Structure) -> list[str]:
    """The Qt field widths of `psi4inputdialog.cpp:238-243`: 4 for the symbol, 15 per coordinate."""
    return [
        f"{a.element:>4}{a.position[0]:15.5f}{a.position[1]:15.5f}{a.position[2]:15.5f}"
        for a in structure.atoms
    ]


def psi4_deck(
    structure: Structure,
    *,
    title: str,
    theory: str = "scf",
    basis: str = "jundz",
    task: str = "energy",
    charge: int = 0,
    multiplicity: int = 1,
    extra: str = "",
) -> str:
    """One Psi4 deck, in the order Avogadro's dialog writes it."""
    if theory not in THEORIES:
        msg = f"unknown Psi4 theory {theory!r}"
        raise ValueError(msg)
    if basis not in BASIS_SETS:
        msg = f"unknown Psi4 basis set {basis!r}"
        raise ValueError(msg)
    if task not in CALCULATIONS:
        msg = f"Psi4 has no job type for {task!r}"
        raise ValueError(msg)

    lines: list[str] = []
    if title.strip():
        # the dialog drops its own title; psithon is Python, so a comment is where it belongs
        lines.append(f"# {title.strip()}")
    lines.append(f"set basis {BASIS_SETS[basis]}")
    if extra.strip():
        lines += [line.strip() for line in extra.strip().splitlines()]
    lines += ["molecule {", f"{charge} {multiplicity}", *_cartesian(structure), "}"]
    if theory in SAPT_THEORIES:
        # SAPT is an interaction energy: the fragments have to be split before it is asked for
        lines.append("auto_fragments('')")
    lines.append(f"{CALCULATIONS[task]}('{THEORIES[theory]}')")
    return "\n".join(lines) + "\n"
