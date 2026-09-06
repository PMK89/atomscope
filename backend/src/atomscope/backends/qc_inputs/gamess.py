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

"""The Control tab's run-type list, in its order: the combo index is the enum value less one
(`gamessinputdialog.cpp:1941`), and the keywords are `gamessinputdata.cpp:501`. Four of them are
what the shared calculation type already says; the rest are GAMESS's alone."""
GAMESS_RUN_TYPES: dict[str, tuple[str, str]] = {
    "energy": ("ENERGY", "Energy"),
    "gradient": ("GRADIENT", "Gradient"),
    "hessian": ("HESSIAN", "Hessian"),
    "optimize": ("OPTIMIZE", "Optimization"),
    "trudge": ("TRUDGE", "Trudge"),
    "sadpoint": ("SADPOINT", "Saddle point"),
    "irc": ("IRC", "IRC"),
    "gradextr": ("GRADEXTR", "Gradient extremal"),
    "drc": ("DRC", "DRC"),
    "surface": ("SURFACE", "Energy surface"),
    "prop": ("PROP", "Properties"),
    "morokuma": ("MOROKUMA", "Morokuma"),
    "transitn": ("TRANSITN", "Radiative transition moment"),
    "spinorbt": ("SPINORBT", "Spin orbit"),
    "ffield": ("FFIELD", "Finite electric field"),
    "tdhf": ("TDHF", "TDHF"),
    "globop": ("GLOBOP", "Global optimization"),
    "vscf": ("VSCF", "VSCF"),
    "optfmo": ("OPTFMO", "FMO optimization"),
    "raman": ("RAMAN", "Raman intensities"),
    "nmr": ("NMR", "NMR"),
    "makefp": ("MAKEFP", "Make EFP"),
}

"""The rest of the Control tab, keyword by keyword (`gamessinputdata.cpp:415,653,702`)."""
SCF_TYPES = {"rhf": "RHF", "uhf": "UHF", "rohf": "ROHF", "gvb": "GVB", "mcscf": "MCSCF"}
"""...and the entry the dialog labels `None (CI)`, which is an SCF type and a reason for CITYP."""
NO_SCF = "none"
LOCALIZATIONS = {"none": "", "boys": "BOYS", "ruednbrg": "RUEDNBRG", "pop": "POP"}
CI_TYPES = {
    "none": "",
    "guga": "GUGA",
    "aldet": "ALDET",
    "ormas": "ORMAS",
    "cis": "CIS",
    "fsoci": "FSOCI",
    "genci": "GENCI",
}
EXEC_TYPES = {"run": "", "check": "CHECK", "debug": "DEBUG"}
"""The Control tab's coupled-cluster list (`gamessinputdata.cpp:552`); the Basic tab's theory
box reaches only CCSD(T) of these."""
CC_TYPES = {
    "none": "",
    "lccd": "LCCD",
    "ccd": "CCD",
    "ccsd": "CCSD",
    "ccsd_t": "CCSD(T)",
    "r_cc": "R-CC",
    "cr_cc": "CR-CC",
    "eom_ccsd": "EOM-CCSD",
    "cr_eom": "CR-EOM",
}

"""The DFT tab's functionals, by the keyword each one is (`gamessinputdata.cpp:2345,2392`).

GAMESS has two lists, one for the grid method and one for the grid-free one, sharing eight names
and diverging after that; a functional is offered here under its keyword with the methods it
belongs to, rather than by position in a combo. Avogadro's dialog shows one list of labels and
looks the index up in whichever enum the method selects, so from `GOP` on its labels and its
keywords disagree -- picking `PBEVWN` in grid mode writes `DFTTYP=GOP`. Going by keyword is what
avoids inheriting that.
"""
DFT_FUNCTIONALS: dict[str, tuple[str, str]] = {
    "SLATER": ("Slater exchange", "both"),
    "BECKE": ("Becke 1988 exchange", "both"),
    "VWN": ("VWN: Vosko-Wilk-Nusair (VWN5) correlation", "both"),
    "LYP": ("LYP: Lee-Yang-Parr correlation", "both"),
    "SVWN": ("SVWN: Slater exchange + VWN correlation", "both"),
    "BVWN": ("BVWN: Becke exchange + VWN5 correlation", "both"),
    "BLYP": ("BLYP: Becke exchange + LYP correlation", "both"),
    "B3LYP": ("B3LYP", "both"),
    "GILL": ("Gill 1996 exchange", "grid"),
    "PBE": ("Perdew-Burke-Ernzerhof (PBE) exchange", "grid"),
    "OP": ("OP: one-parameter progressive correlation", "grid"),
    "SLYP": ("SLYP: Slater + LYP correlation", "grid"),
    "SOP": ("SOP: Slater + OP correlation", "grid"),
    "BOP": ("BOP: Becke exchange + OP correlation", "grid"),
    "GVWN": ("GVWN: Gill exchange + VWN5 correlation", "grid"),
    "GLYP": ("GLYP: Gill exchange + LYP correlation", "grid"),
    "GOP": ("GOP: Gill exchange + OP correlation", "grid"),
    "PBEVWN": ("PBEVWN: PBE exchange + VWN correlation", "grid"),
    "PBELYP": ("PBELYP: PBE exchange + LYP correlation", "grid"),
    "PBEOP": ("PBEOP: PBE exchange + OP correlation", "grid"),
    "BHHLYP": ("BHHLYP: HF and Becke exchange + LYP correlation", "grid"),
    "XALPHA": ("X-alpha exchange", "gridfree"),
    "DEPRISTO": ("Depristo", "gridfree"),
    "CAMA": ("CAMA", "gridfree"),
    "HALF": ("HALF", "gridfree"),
    "PWLOC": ("PWLOC", "gridfree"),
    "BPWLOC": ("BPWLOC", "gridfree"),
    "CAMB": ("CAMB", "gridfree"),
    "XVWN": ("XVWN", "gridfree"),
    "XPWLOC": ("XPWLOC", "gridfree"),
    "SPWLOC": ("SPWLOC", "gridfree"),
    "WIGNER": ("Wigner", "gridfree"),
    "WS": ("WS", "gridfree"),
    "WIGEXP": ("WIGEXP", "gridfree"),
}

"""The SCF types a $DFT group is punched for: RHF, UHF and ROHF (`gamessinputdata.cpp:2330`)."""
DFT_SCF_TYPES = ("RHF", "UHF", "ROHF")


"""The run types GAMESS searches for a stationary point in, and so writes $STATPT for
(`gamessinputdata.cpp:2481`)."""
STATIONARY_POINT_RUNS = ("OPTIMIZE", "SADPOINT")


OPTIMIZATION_METHODS = {
    "nr": "NR",
    "rfo": "RFO",
    "qa": "QA",
    "schlegel": "SCHLEGEL",
    "conopt": "CONOPT",
}
"""QA is GAMESS's default and the one Avogadro left unwritten (`gamessinputdata.cpp:2493`)."""
DEFAULT_OPTIMIZATION = "qa"
"""...and the two methods that keep a trust radius, which is what its three sizes belong to."""
TRUST_RADIUS_METHODS = ("rfo", "qa")
INITIAL_HESSIANS = {"": "", "guess": "GUESS", "read": "READ", "calculate": "CALC"}
DIAGONALIZATIONS = {"default": 0, "evvrsp": 1, "giveis": 2, "jacobi": 3}


@dataclass(frozen=True)
class StatPointOptions:
    """The Stat Point tab: how a stationary point is searched for ($STATPT)."""

    convergence: float = 0.0001
    max_steps: int = 20
    method: str = DEFAULT_OPTIMIZATION
    initial_radius: float = 0.0
    min_radius: float = 0.05
    max_radius: float = 0.0
    update_radius: bool = True
    initial_hessian: str = ""
    recalculate_hessian: int = 0
    follow_mode: int = 1
    stationary_point: bool = False
    jump_size: float = 0.01
    print_orbitals: bool = False


@dataclass(frozen=True)
class SystemOptions:
    """The System tab: what the run is allowed to use ($SYSTEM)."""

    time_limit_minutes: int = 0
    memddi_mb: int = 0
    parallel: bool = False
    core_file: bool = False
    diagonalization: str = "default"
    balance: str = "loop"
    external_representation: bool = False


@dataclass(frozen=True)
class ControlOptions:
    """The Advanced Control tab, as far as $CONTRL carries it."""

    runtyp: str = ""
    """empty means the calculation type says it, which is what the Basic tab's Calculate box did"""
    scftyp: str = ""
    """empty means RHF, or ROHF when the electrons cannot pair up"""
    localization: str = "none"
    max_iterations: int = 0
    exec_type: str = "run"
    ci: str = "none"
    cc: str = ""
    """empty means the theory box says it; `none` means no coupled cluster at all"""
    functional: str = ""
    """empty means the theory box says it: B3LYP for its B3LYP entry, no DFT otherwise"""
    dft_method: str = "grid"


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


def _grid_free(
    theory: str, control: ControlOptions | None, multiplicity: int, electrons: int
) -> bool:
    """Whether a $DFT group is written: a grid-free DFT run over one of the HF wave functions."""
    control = control or ControlOptions()
    if control.dft_method != "gridfree":
        return False
    if not (control.functional or theory == "b3lyp"):
        return False
    return _scf_type(control, multiplicity, electrons) in DFT_SCF_TYPES


def run_type(task: str, control: ControlOptions | None) -> str:
    """The RUNTYP keyword: the Control tab's choice when there is one, else the Calculate box."""
    if control is not None and control.runtyp:
        return GAMESS_RUN_TYPES[control.runtyp][0]
    return RUN_TYPES[task]


def _scf_type(control: ControlOptions | None, multiplicity: int, electrons: int) -> str:
    if control is not None and control.scftyp:
        return "NONE" if control.scftyp == NO_SCF else SCF_TYPES[control.scftyp]
    # what Avogadro punched when nothing had been chosen: pairs of electrons, or ROHF
    return "ROHF" if multiplicity > 1 or electrons % 2 else "RHF"


def _control_group(
    *,
    theory: str,
    ecp: str,
    task: str,
    charge: int,
    multiplicity: int,
    electrons: int,
    control: ControlOptions | None,
) -> str:
    """$CONTRL, keyword by keyword in the order Avogadro punched them (gamessinputdata.cpp:821)."""
    control = control or ControlOptions()
    words = [f"SCFTYP={_scf_type(control, multiplicity, electrons)}"]
    words.append(f"RUNTYP={run_type(task, control)}")
    if EXEC_TYPES[control.exec_type]:
        words.append(f"EXETYP={EXEC_TYPES[control.exec_type]}")
    if theory == "mp2":
        words.append("MPLEVL=2")
    # a run with no SCF is a CI run, and says which kind even when the box says None
    if CI_TYPES[control.ci] or control.scftyp == NO_SCF:
        words.append(f"CITYP={CI_TYPES[control.ci] or 'NONE'}")
    cc = CC_TYPES[control.cc] if control.cc else ("CCSD(T)" if theory == "ccsd_t" else "")
    if cc:
        words.append(f"CCTYP={cc}")
    functional = control.functional or ("B3LYP" if theory == "b3lyp" else "")
    if functional:
        words.append(f"DFTTYP={functional}")
    if control.max_iterations:
        words.append(f"MAXIT={control.max_iterations}")
    if charge:
        words.append(f"ICHARG={charge}")
    if multiplicity > 1:
        words.append(f"MULT={multiplicity}")
    elif electrons % 2:
        words.append("MULT=2")  # an odd number of electrons is not a singlet
    if LOCALIZATIONS[control.localization]:
        words.append(f"LOCAL={LOCALIZATIONS[control.localization]}")
    if ecp:
        words.append(f"ECP={ecp}")
    return " $CONTRL " + " ".join(words) + " $END"


def _system_group(memory_mb: int, system: SystemOptions | None) -> str:
    """$SYSTEM, which Avogadro punches only when something in it was asked for."""
    system = system or SystemOptions()
    words: list[str] = []
    if system.time_limit_minutes:
        words.append(f"TIMLIM={system.time_limit_minutes}")
    if memory_mb:
        words.append(f"MWORDS={max(1, memory_mb // MEGAWORD_MB)}")
    if system.memddi_mb:
        words.append(f"MEMDDI={max(1, system.memddi_mb // MEGAWORD_MB)}")
    if system.parallel:
        words.append("PARALL=.TRUE.")
    if DIAGONALIZATIONS[system.diagonalization]:
        words.append(f"KDIAG={DIAGONALIZATIONS[system.diagonalization]}")
    if system.core_file:
        words.append("COREFL=.TRUE.")
    if system.balance == "nxtval":
        words.append("BALTYP=NXTVAL")
    if system.external_representation:
        words.append("XDR=.TRUE.")
    return " $SYSTEM " + " ".join(words) + " $END" if words else ""


def _stat_point_group(options: StatPointOptions, runtyp: str) -> str:
    """$STATPT, in the order and under the conditions of `gamessinputdata.cpp:2475-2560`."""
    # the convergence and the step count are always written, to remind the user of them
    words = [f"OPTTOL={options.convergence:g}", f"NSTEP={options.max_steps}"]
    if options.method != DEFAULT_OPTIMIZATION:
        words.append(f"Method={OPTIMIZATION_METHODS[options.method]}")
    if options.initial_radius and options.method != "nr":
        words.append(f"DXMAX={options.initial_radius:g}")
    if options.method in TRUST_RADIUS_METHODS:
        if not options.update_radius:
            words.append("TRUPD=.FALSE.")
        if options.max_radius:
            words.append(f"TRMAX={options.max_radius:g}")
        if abs(options.min_radius - 0.05) > 1e-5:
            words.append(f"TRMIN={options.min_radius:g}")
    if runtyp == "SADPOINT" and options.follow_mode != 1:
        words.append(f"IFOLOW={options.follow_mode}")
    if options.stationary_point:
        words.append("STPT=.TRUE.")
        if abs(options.jump_size - 0.01) > 1e-5:
            words.append(f"STSTEP={options.jump_size:g}")
    if INITIAL_HESSIANS[options.initial_hessian]:
        words.append(f"HESS={INITIAL_HESSIANS[options.initial_hessian]}")
    if options.recalculate_hessian:
        words.append(f"IHREP={options.recalculate_hessian}")
    if options.print_orbitals:
        words.append("NPRT=1")
    return " $STATPT " + " ".join(words) + " $END"


def gamess_deck(
    structure: Structure,
    *,
    title: str,
    theory: str = "rhf",
    basis: str = "n31d",
    detailed: DetailedBasis | None = None,
    control: ControlOptions | None = None,
    stat_point: StatPointOptions | None = None,
    system: SystemOptions | None = None,
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
    if control is not None and control.runtyp and control.runtyp not in GAMESS_RUN_TYPES:
        msg = f"unknown GAMESS run type {control.runtyp!r}"
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
            control=control,
        )
    )
    if _grid_free(theory, control, multiplicity, electrons):
        # the group carries the method and nothing else here; the grid one is GAMESS's default
        lines.append(" $DFT METHOD=GRIDFREE $END")
    system_group = _system_group(memory_mb, system)
    if system_group:
        lines.append(system_group)
    if run_type(task, control) in STATIONARY_POINT_RUNS:
        # written for every optimize and saddle-point run, values and all: they are GAMESS's own
        # defaults, and Avogadro punched them "just to remind the user"
        # (gamessinputdata.cpp:2481-2489). Nothing else of the group is set from the Basic tab --
        # its Frequencies entry asks for HESS=CALC, but Avogadro's writer punches the group for
        # OPTIMIZE and SADPOINT only, so that keyword never reached a deck there either
        lines.append(_stat_point_group(stat_point or StatPointOptions(), run_type(task, control)))
    if extra.strip():
        lines.append(extra.strip())
    lines += ["", " $DATA", title, "C1"]
    for atom in structure.atoms:
        z = float(atomic_numbers[atom.element])
        x, y, zc = atom.position
        lines.append(f"{atom.element:<3}{z:6.1f}  {x:10.5f}{y:10.5f}{zc:10.5f}")
    lines.append(" $END")
    return "\n".join(lines) + "\n"
