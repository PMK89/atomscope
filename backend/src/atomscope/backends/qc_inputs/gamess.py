"""GAMESS-US input decks, in the shape Avogadro 1's GAMESS dialog wrote them.

Avogadro's generator was a port of the MacMolPlt input builder: a Basic Setup tab and eleven
Advanced ones (`gamessinputdialog.ui`, 3035 lines of it, over `gamessinputdata.cpp`). What is
here is the Basic tab -- Calculate, With, In, On, Charge and the basis list beside them -- whose
keywords are taken from the source comments that spell each combo entry out
(`gamessinputdialog.cpp:1714-1795`, and the group writers at `gamessinputdata.cpp:821,1490,1738`).

A GAMESS deck is groups of keywords, each ``$NAME ... $END`` on a line starting with one space,
in the order Avogadro wrote them: ``$BASIS``, ``$PCM`` for the solvent, ``$CONTRL``, ``$SYSTEM``,
``$STATPT``, then ``$DATA`` -- the title, the point group, and one line per atom carrying
its nuclear charge.
"""

from __future__ import annotations

from dataclasses import dataclass

from ase.data import atomic_numbers

from atomscope.model import Structure


@dataclass(frozen=True)
class BasisChoice:
    """One entry of the Basic tab's basis list, as the ``$BASIS`` keywords it stands for."""

    label: str
    gbasis: str
    ngauss: int = 0
    ndfunc: int = 0
    npfunc: int = 0
    diffuse_sp: bool = False
    diffuse_s: bool = False
    ecp: str = ""


BASIS_CHOICES: dict[str, BasisChoice] = {
    "sto3g": BasisChoice("STO-3G", "STO", ngauss=3),
    "mini": BasisChoice("MINI", "MINI"),
    "n21": BasisChoice("3-21G", "N21", ngauss=3),
    "n31d": BasisChoice("6-31G(d)", "N31", ngauss=6, ndfunc=1),
    "n31dp": BasisChoice("6-31G(d,p)", "N31", ngauss=6, ndfunc=1, npfunc=1),
    "n31plus_dp": BasisChoice("6-31+G(d,p)", "N31", ngauss=6, ndfunc=1, npfunc=1, diffuse_sp=True),
    "n31plus_2dp": BasisChoice(
        "6-31+G(2d,p)", "N31", ngauss=6, ndfunc=2, npfunc=1, diffuse_sp=True
    ),
    # the label says 2d, the keywords Avogadro wrote say NDFUNC=1; the keywords are what ran
    "n311_2dp": BasisChoice(
        "6-311++G(2d,p)", "N311", ngauss=6, ndfunc=1, npfunc=1, diffuse_sp=True, diffuse_s=True
    ),
    "core_potential": BasisChoice("Core Potential", "SBKJC", ndfunc=1, ecp="SBKJC"),
}

"""The Basic tab's theory list. A semi-empirical Hamiltonian is a *basis* to GAMESS."""
THEORY_CHOICES = {
    "am1": "AM1",
    "pm3": "PM3",
    "rhf": "RHF",
    "b3lyp": "B3LYP",
    "mp2": "MP2",
    "ccsd_t": "CCSD(T)",
}
SEMI_EMPIRICAL = ("am1", "pm3")

RUN_TYPES = {
    "energy": "ENERGY",
    "optimize": "OPTIMIZE",
    "transition_state": "SADPOINT",
    "frequencies": "HESSIAN",
}

MEGAWORD_MB = 8
"""A GAMESS word is 8 bytes, so MWORDS is megabytes over eight."""


def _basis_group(theory: str, basis: str) -> str:
    if theory in SEMI_EMPIRICAL:
        # the Hamiltonian replaces the basis set, and takes none of its options
        return f" $BASIS GBASIS={THEORY_CHOICES[theory]} $END"
    choice = BASIS_CHOICES[basis]
    words = [f"GBASIS={choice.gbasis}"]
    for keyword, value in (
        ("NGAUSS", choice.ngauss),
        ("NDFUNC", choice.ndfunc),
        ("NPFUNC", choice.npfunc),
    ):
        if value:
            words.append(f"{keyword}={value}")
    if choice.diffuse_sp:
        words.append("DIFFSP=.TRUE.")
    if choice.diffuse_s:
        words.append("DIFFS=.TRUE.")
    return " $BASIS " + " ".join(words) + " $END"


def _control_group(
    *, theory: str, basis: str, task: str, charge: int, multiplicity: int, electrons: int
) -> str:
    words = ["SCFTYP=" + ("ROHF" if multiplicity > 1 or electrons % 2 else "RHF")]
    words.append(f"RUNTYP={RUN_TYPES[task]}")
    if theory == "mp2":
        words.append("MPLEVL=2")
    elif theory == "ccsd_t":
        words.append("CCTYP=CCSD(T)")
    elif theory == "b3lyp":
        words.append("DFTTYP=B3LYP")
    if charge:
        words.append(f"ICHARG={charge}")
    if multiplicity > 1:
        words.append(f"MULT={multiplicity}")
    elif electrons % 2:
        words.append("MULT=2")  # an odd number of electrons is not a singlet
    if theory not in SEMI_EMPIRICAL and BASIS_CHOICES[basis].ecp:
        words.append(f"ECP={BASIS_CHOICES[basis].ecp}")
    return " $CONTRL " + " ".join(words) + " $END"


def gamess_deck(
    structure: Structure,
    *,
    title: str,
    theory: str = "rhf",
    basis: str = "n31d",
    task: str = "energy",
    charge: int = 0,
    multiplicity: int = 1,
    solvent: str = "gas",
    memory_mb: int = 0,
    extra: str = "",
) -> str:
    """One GAMESS-US deck from the Basic Setup options."""
    if theory not in THEORY_CHOICES:
        msg = f"unknown GAMESS theory {theory!r}"
        raise ValueError(msg)
    if theory not in SEMI_EMPIRICAL and basis not in BASIS_CHOICES:
        msg = f"unknown GAMESS basis {basis!r}"
        raise ValueError(msg)
    if task not in RUN_TYPES:
        msg = f"GAMESS deck: no run type for {task!r}"
        raise ValueError(msg)
    electrons = sum(atomic_numbers[a.element] for a in structure.atoms) - charge

    lines = [_basis_group(theory, basis)]
    if solvent == "water":
        lines.append(" $PCM SOLVNT=WATER $END")
    lines.append(
        _control_group(
            theory=theory,
            basis=basis,
            task=task,
            charge=charge,
            multiplicity=multiplicity,
            electrons=electrons,
        )
    )
    if memory_mb:
        lines.append(f" $SYSTEM MWORDS={max(1, memory_mb // MEGAWORD_MB)} $END")
    if task in ("optimize", "transition_state"):
        # written for every optimize and saddle-point run, values and all: they are GAMESS's own
        # defaults, and Avogadro punched them "just to remind the user"
        # (gamessinputdata.cpp:2481-2489). Nothing else of the group is set from the Basic tab --
        # its Frequencies entry asks for HESS=CALC, which GAMESS only reads for the two run types
        # this group is written for, so it never appears
        lines.append(" $STATPT OPTTOL=0.0001 NSTEP=20 $END")
    if extra.strip():
        lines.append(extra.strip())
    lines += ["", " $DATA", title, "C1"]
    for atom in structure.atoms:
        z = float(atomic_numbers[atom.element])
        x, y, zc = atom.position
        lines.append(f"{atom.element:<3}{z:6.1f}  {x:10.5f}{y:10.5f}{zc:10.5f}")
    lines.append(" $END")
    return "\n".join(lines) + "\n"
