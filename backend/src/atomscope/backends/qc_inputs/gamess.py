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

"""The Advanced Basis tab's list, which is the Basic one broken into its parts: a GBASIS and a
number of Gaussians, with the polarization, diffuse and ECP options beside it rather than folded
in. `gamessinputdialog.cpp:1865-1900` maps each entry of the combo to the pair, and the keyword
spellings are `gamessinputdata.cpp:1266`.
"""
GBASIS_CHOICES: dict[str, BasisChoice] = {
    "mini": BasisChoice("MINI", "MINI"),
    "midi": BasisChoice("MIDI", "MIDI"),
    "sto2g": BasisChoice("STO-2G", "STO", ngauss=2),
    "sto3g": BasisChoice("STO-3G", "STO", ngauss=3),
    "sto4g": BasisChoice("STO-4G", "STO", ngauss=4),
    "sto5g": BasisChoice("STO-5G", "STO", ngauss=5),
    "sto6g": BasisChoice("STO-6G", "STO", ngauss=6),
    "n21_3": BasisChoice("3-21G", "N21", ngauss=3),
    "n21_6": BasisChoice("6-21G", "N21", ngauss=6),
    "n31_4": BasisChoice("4-31G", "N31", ngauss=4),
    "n31_5": BasisChoice("5-31G", "N31", ngauss=5),
    "n31_6": BasisChoice("6-31G", "N31", ngauss=6),
    "n311_6": BasisChoice("6-311G", "N311", ngauss=6),
    "dzv": BasisChoice("Double Zeta Valence", "DZV"),
    "dh": BasisChoice("Dunning/Hay DZ", "DH"),
    "bc": BasisChoice("Binning/Curtiss DZ", "BC"),
    "tzv": BasisChoice("Triple Zeta Valence", "TZV"),
    "mc": BasisChoice("McLean/Chandler", "MC"),
    # Avogadro's enum spells these SBK and HW; its own comment and its combo label say SBKJC,
    # which is the spelling GAMESS documents, and is what the Basic tab's Core Potential wrote
    "sbkjc": BasisChoice("SBKJC Valence", "SBKJC", ecp="SBKJC"),
    "hw": BasisChoice("Hay/Wadt Valence", "HW", ecp="HW"),
    "mndo": BasisChoice("MNDO", "MNDO"),
    "am1": BasisChoice("AM1", "AM1"),
    "pm3": BasisChoice("PM3", "PM3"),
}

"""The Advanced tab's polarization-function set (`gamessinputdata.cpp:1419`)."""
POLARIZATIONS = {
    "default": "",
    "pople": "POPLE",
    "popn311": "POPN311",
    "dunning": "DUNNING",
    "huzinaga": "HUZINAGA",
    "hondo7": "HONDO7",
}

"""Effective core potentials, which live in $CONTRL rather than $BASIS."""
ECPS = {"none": "", "read": "READ", "sbkjc": "SBKJC", "hay_wadt": "HW"}


@dataclass(frozen=True)
class DetailedBasis:
    """The Advanced Basis tab: a basis set and the functions added to it, set one at a time."""

    gbasis: str = "n31_6"
    ndfunc: int = 0
    nffunc: int = 0
    npfunc: int = 0
    polarization: str = "default"
    ecp: str = "none"
    diffuse_s: bool = False
    diffuse_sp: bool = False


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


def _basis_words(basis: str, detailed: DetailedBasis | None) -> tuple[list[str], str]:
    """The ``$BASIS`` keywords and the effective core potential, from either tab's controls."""
    if detailed is None:
        choice = BASIS_CHOICES[basis]
        counts = (choice.ndfunc, 0, choice.npfunc)
        polarization = ""
        diffuse_s, diffuse_sp = choice.diffuse_s, choice.diffuse_sp
        ecp = choice.ecp
    else:
        choice = GBASIS_CHOICES[detailed.gbasis]
        counts = (detailed.ndfunc, detailed.nffunc, detailed.npfunc)
        polarization = POLARIZATIONS[detailed.polarization]
        diffuse_s, diffuse_sp = detailed.diffuse_s, detailed.diffuse_sp
        # a basis that carries its own core potential keeps it unless another is chosen
        ecp = ECPS[detailed.ecp] or choice.ecp
    words = [f"GBASIS={choice.gbasis}"]
    keywords = ("NGAUSS", "NDFUNC", "NFFUNC", "NPFUNC")
    for keyword, value in zip(keywords, (choice.ngauss, *counts), strict=True):
        if value:
            words.append(f"{keyword}={value}")
    # POLAR names which set of polarization exponents to take, so it says nothing without them
    if polarization and any(counts):
        words.append(f"POLAR={polarization}")
    if diffuse_sp:
        words.append("DIFFSP=.TRUE.")
    if diffuse_s:
        words.append("DIFFS=.TRUE.")
    return words, ecp


def _basis_group(theory: str, basis: str, detailed: DetailedBasis | None) -> tuple[str, str]:
    if theory in SEMI_EMPIRICAL:
        # the Hamiltonian replaces the basis set, and takes none of its options
        return f" $BASIS GBASIS={THEORY_CHOICES[theory]} $END", ""
    words, ecp = _basis_words(basis, detailed)
    return " $BASIS " + " ".join(words) + " $END", ecp


def _control_group(
    *, theory: str, ecp: str, task: str, charge: int, multiplicity: int, electrons: int
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
    if ecp:
        words.append(f"ECP={ecp}")
    return " $CONTRL " + " ".join(words) + " $END"


def gamess_deck(
    structure: Structure,
    *,
    title: str,
    theory: str = "rhf",
    basis: str = "n31d",
    detailed: DetailedBasis | None = None,
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
    if theory not in SEMI_EMPIRICAL and detailed is None and basis not in BASIS_CHOICES:
        msg = f"unknown GAMESS basis {basis!r}"
        raise ValueError(msg)
    if detailed is not None and detailed.gbasis not in GBASIS_CHOICES:
        msg = f"unknown GAMESS basis set {detailed.gbasis!r}"
        raise ValueError(msg)
    if task not in RUN_TYPES:
        msg = f"GAMESS deck: no run type for {task!r}"
        raise ValueError(msg)
    electrons = sum(atomic_numbers[a.element] for a in structure.atoms) - charge

    basis_group, ecp = _basis_group(theory, basis, detailed)
    lines = [basis_group]
    if solvent == "water":
        lines.append(" $PCM SOLVNT=WATER $END")
    lines.append(
        _control_group(
            theory=theory,
            ecp=ecp,
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
        # its Frequencies entry asks for HESS=CALC, but Avogadro's writer punches the group for
        # OPTIMIZE and SADPOINT only, so that keyword never reached a deck there either
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
