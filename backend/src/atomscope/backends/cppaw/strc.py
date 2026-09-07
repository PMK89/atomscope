# ruff: noqa: E501, PLR0912, PLR0915, S603
"""Generate and read CP-PAW structure files (``!STRUCTURE``).

Conventions used by the generator (see docs/cppaw-analysis.md §3.4, §8):
- lengths are written in Å via ``!GENERIC LUNIT[AA]=1.0``;
- species names are the element symbol upper-cased and padded to two characters with ``_``
  (``O_``, ``H_``, ``SI``); atom names are species name + 1-based index (``O_1``, ``SI12``);
- setups use the internal families ``<SPECIES>_<type>`` (no external setup files needed);
- ``CHARGE[E]`` is the ionization state (anion = -1), ``SPIN[HBAR]`` the total spin S;
- non-periodic structures get an orthorhombic box of extent + 2 × margin and ``!ISOLATE``.
- ``isolate="always"`` writes ``!ISOLATE`` for a structure that brought its own cell too, which
  is how the tutorial treats a molecule: a face-centred cell of its own choosing, Γ-point only,
  and the electrostatic image interaction subtracted.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from ase.data import atomic_numbers
from ase.units import Bohr

from atomscope.backends.cppaw.deck import Block, format_deck, parse_deck
from atomscope.backends.cppaw.setups import SetupsLibrary
from atomscope.model import Cell, FixAtoms, FixBondLength, FixCartesian, Structure

Values = dict[str, object]


def species_name(symbol: str) -> str:
    return symbol.upper().ljust(2, "_")


def atom_name(symbol: str, index: int) -> str:
    return f"{species_name(symbol)}{index + 1}"


def setup_id(symbol: str, setup_type: str) -> str:
    """Internal setup identifier ``<SYMBOL>_<type>`` (element symbol without padding)."""
    return f"{symbol.upper()}_{setup_type}"


def default_npro(symbol: str) -> list[int]:
    z = atomic_numbers[symbol]
    return [1, 1] if z <= 2 else [2, 2, 1]


def parse_npro_overrides(text: str) -> dict[str, list[int]]:
    """'Fe: 2 2 2; O: 2 2 1' -> {'Fe': [2,2,2], 'O': [2,2,1]}"""
    out: dict[str, list[int]] = {}
    for part in text.split(";"):
        if ":" not in part:
            continue
        sym, _, nums = part.partition(":")
        values = [int(x) for x in nums.split()]
        if sym.strip() and values:
            out[sym.strip().capitalize()] = values
    return out


def parse_masses(text: str, hydrogen_mass: float = 0.0) -> dict[str, float]:
    """``'C: 5; O: 5; H: 2'`` -> ``{'C': 5.0, 'O': 5.0, 'H': 2.0}``.

    These are the fictitious masses of Car-Parrinello dynamics, not physical ones. Making the
    heavy atoms lighter and hydrogen heavier brings their vibrational timescales together, so one
    time step suits all of them -- the tutorial's ch. 4 sets ``M=5.`` on carbon and oxygen and
    ``M=2.`` on hydrogen for exactly that. ``hydrogen_mass`` is the older single-element form and
    still applies, unless this text names hydrogen itself.
    """
    out: dict[str, float] = {}
    if hydrogen_mass > 0:
        out["H"] = hydrogen_mass
    for part in text.split(";"):
        if ":" not in part:
            continue
        sym, _, value = part.partition(":")
        try:
            mass = float(value)
        except ValueError:
            continue
        if sym.strip() and mass > 0:
            out[sym.strip().capitalize()] = mass
    return out


def isolate_mode(value: object) -> str:
    """The three-way choice, accepting the boolean projects saved before it was one.

    ``True`` was "isolate a molecule we boxed ourselves", which is what ``auto`` means; ``False``
    was "never". Reading them that way leaves every existing project computing what it did.
    """
    if isinstance(value, bool):
        return "auto" if value else "never"
    text = str(value)
    return text if text in {"auto", "always", "never"} else "auto"


@dataclass
class StrcOptions:
    setup_type: str = ".75_6.0"
    lrhox: int = 2
    rad_rcov: float = 1.4
    npro_overrides: str = ""
    hydrogen_mass: float = 0.0
    atom_masses: str = ""
    box_margin: float = 4.0
    isolate: str = "auto"
    spin_polarized: bool = False
    total_spin: float = 0.0
    empty_bands: int = 4
    kpoint_mode: str = "density"
    kpoint_r: float = 12.0
    kpoint_div: tuple[int, int, int] = (2, 2, 2)
    occupation_states: str = ""
    orbital_potentials: str = ""
    library: SetupsLibrary | None = None

    @classmethod
    def from_values(cls, v: Values) -> StrcOptions:
        div = v.get("kpoint_div", [2, 2, 2])
        return cls(
            setup_type=str(v.get("setup_type", ".75_6.0")),
            lrhox=int(v.get("lrhox", 2)),  # type: ignore[call-overload]
            rad_rcov=float(v.get("rad_rcov", 1.4)),  # type: ignore[arg-type]
            npro_overrides=str(v.get("npro_overrides", "")),
            hydrogen_mass=float(v.get("hydrogen_mass", 0.0)),  # type: ignore[arg-type]
            atom_masses=str(v.get("atom_masses", "")),
            box_margin=float(v.get("box_margin", 4.0)),  # type: ignore[arg-type]
            isolate=isolate_mode(v.get("isolate", "auto")),
            spin_polarized=bool(v.get("spin_polarized", False)),
            total_spin=float(v.get("total_spin", 0.0)),  # type: ignore[arg-type]
            empty_bands=int(v.get("empty_bands", 4)),  # type: ignore[call-overload]
            kpoint_mode=str(v.get("kpoint_mode", "density")),
            kpoint_r=float(v.get("kpoint_r", 12.0)),  # type: ignore[arg-type]
            kpoint_div=(int(div[0]), int(div[1]), int(div[2])),  # type: ignore[index]
            occupation_states=str(v.get("occupation_states", "") or ""),
            orbital_potentials=str(v.get("orbital_potentials", "") or ""),
        )


@dataclass(frozen=True)
class OccupationState:
    """One ``!OCCUPATIONS!STATE`` entry: occupation ``f`` of band ``b`` for spin ``s`` (1/2)."""

    band: int
    spin: int
    occupation: float
    kpoint: int | None = None


def parse_occupation_states(text: str) -> list[OccupationState]:
    """Parse 'band spin occupation [kpoint]' lines; blank lines and '#' comments are skipped."""
    out: list[OccupationState] = []
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip().replace(",", " ")
        if not line:
            continue
        parts = line.split()
        if len(parts) not in (3, 4):
            msg = f"occupation state line needs 'band spin occupation [kpoint]': {raw!r}"
            raise ValueError(msg)
        band, spin = int(parts[0]), int(parts[1])
        occ = float(parts[2])
        kpt = int(parts[3]) if len(parts) == 4 else None
        if band < 1 or spin not in (1, 2) or not 0.0 <= occ <= 2.0:
            msg = f"invalid occupation state {raw!r} (band>=1, spin 1|2, 0<=f<=2)"
            raise ValueError(msg)
        out.append(OccupationState(band, spin, occ, kpt))
    return out


@dataclass(frozen=True)
class OrbitalPotential:
    """An external potential on one orbital shell of one atom, in one spin channel.

    Chapter 7.3's way into an antiferromagnet: NiO's two nickel atoms are equivalent, so a
    spin-polarized calculation started from nothing has no reason to prefer the ordering that is
    the ground state. Pushing the d shell up on one and down on the other breaks the symmetry;
    the potential is then **removed** and the calculation continued from that restart file,
    because the answer must not depend on the nudge that found it.
    """

    atom: int
    """0-based index into the structure."""
    value: float
    """Hartree; the tutorial uses +0.1 and -0.1."""
    shell: str
    """S, P, D or F -- an angular momentum, not one of the hybrid orbital names."""
    spin: int = 1
    radius: float = 2.0
    """RC: how far out the potential acts, in bohr."""


SHELLS = ("S", "P", "D", "F")


def parse_orbital_potentials(text: str) -> list[OrbitalPotential]:
    """Parse ``'atom value shell [spin] [rc]'`` lines, e.g. ``'1 +0.1 D 1 2.0'``.

    The atom is 1-based here, the way the tutorial's own ``ATOM='NI1'`` reads, and 0-based in the
    dataclass -- one conversion, in one place.
    """
    out: list[OrbitalPotential] = []
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip().replace(",", " ")
        if not line:
            continue
        parts = line.split()
        if len(parts) not in (3, 4, 5):
            msg = f"orbital potential line needs 'atom value shell [spin] [rc]': {raw!r}"
            raise ValueError(msg)
        index, value, shell = int(parts[0]), float(parts[1]), parts[2].upper()
        spin = int(parts[3]) if len(parts) >= 4 else 1
        radius = float(parts[4]) if len(parts) == 5 else 2.0
        if index < 1 or shell not in SHELLS or spin not in (1, 2) or radius <= 0:
            msg = (
                f"invalid orbital potential {raw!r}"
                f" (atom>=1, shell one of {'/'.join(SHELLS)}, spin 1|2, rc>0)"
            )
            raise ValueError(msg)
        out.append(OrbitalPotential(index - 1, value, shell, spin, radius))
    return out


def molecule_box(structure: Structure, margin: float) -> Cell:
    pos = structure.positions()
    extent = pos.max(axis=0) - pos.min(axis=0) if len(pos) else np.zeros(3)
    a, b, c = (float(x) + 2 * margin for x in extent)
    return Cell(vectors=((a, 0.0, 0.0), (0.0, b, 0.0), (0.0, 0.0, c)), pbc=(False, False, False))


def effective_spin(structure: Structure, opts: StrcOptions) -> float:
    if opts.total_spin > 0:
        return opts.total_spin
    if structure.multiplicity and structure.multiplicity > 1:
        return (structure.multiplicity - 1) / 2.0
    return 0.0


def build_strc(structure: Structure, opts: StrcOptions) -> Block:
    """Return the deck root containing one ``!STRUCTURE`` block."""
    root = Block("__ROOT__")
    strc = Block("STRUCTURE")
    root.children.append(strc)
    strc.ensure_child("GENERIC").set("LUNIT[AA]", 1.0)

    periodic = structure.is_periodic()
    cell = (
        structure.cell
        if structure.cell is not None and periodic
        else molecule_box(structure, opts.box_margin)
    )
    lattice = strc.ensure_child("LATTICE")
    lattice.set("T", [float(x) for row in cell.vectors for x in row])

    if periodic:
        kp = strc.ensure_child("KPOINTS")
        if opts.kpoint_mode == "gamma":
            kp.set("DIV", [1, 1, 1])
        elif opts.kpoint_mode == "grid":
            kp.set("DIV", list(opts.kpoint_div))
        else:
            kp.set("R", opts.kpoint_r)
    if opts.isolate == "always" or (opts.isolate == "auto" and not periodic):
        strc.ensure_child("ISOLATE")

    occ = strc.ensure_child("OCCUPATIONS")
    spin = effective_spin(structure, opts)
    nspin = 2 if (opts.spin_polarized or spin > 0) else 1
    occ.set("NSPIN", nspin)
    occ.set("EMPTY", opts.empty_bands)
    occ.set("CHARGE[E]", float(structure.charge))
    if nspin == 2:
        occ.set("SPIN[HBAR]", spin)
    for state in parse_occupation_states(opts.occupation_states):
        blk = Block("STATE")
        blk.set("B", state.band)
        blk.set("S", state.spin)
        blk.set("F", state.occupation)
        if state.kpoint is not None:
            blk.set("K", state.kpoint)
        occ.children.append(blk)

    overrides = parse_npro_overrides(opts.npro_overrides)
    masses = parse_masses(opts.atom_masses, opts.hydrogen_mass)
    seen: list[str] = []
    for sym in structure.symbols():
        if sym in seen:
            continue
        seen.append(sym)
        library_block = opts.library.block_for(species_name(sym)) if opts.library else None
        if library_block is not None:
            # inline !SPECIES (with !AUGMENT) from the external library, as paw_resolve does
            sp = library_block
            if sym in masses:
                sp.set("M", masses[sym])
            if sym in overrides:
                sp.set("NPRO", list(overrides[sym]))
        else:
            sp = Block("SPECIES")
            sp.set("NAME", species_name(sym))
            # CP-PAW splits the ID at the FIRST underscore: 'O_.75_6.0' -> element O, type .75_6.0
            sp.set("ID", setup_id(sym, opts.setup_type))
            if sym in masses:
                sp.set("M", masses[sym])
            sp.set("NPRO", list(overrides.get(sym, default_npro(sym))))
            sp.set("LRHOX", opts.lrhox)
            sp.set("RAD/RCOV", opts.rad_rcov)
        strc.children.append(sp)
    if not seen:  # CP-PAW insists on at least one species
        sp = Block("SPECIES")
        sp.set("NAME", "H_")
        sp.set("ID", setup_id("H", opts.setup_type))
        sp.set("NPRO", [1, 1])
        strc.children.append(sp)

    for i, atom in enumerate(structure.atoms):
        a = Block("ATOM")
        a.set("NAME", atom_name(atom.element, i))
        a.set("R", [float(x) for x in atom.position])
        strc.children.append(a)

    potentials = parse_orbital_potentials(opts.orbital_potentials)
    if potentials:
        blk = Block("ORBPOT")
        for pot in potentials:
            if pot.atom >= len(structure.atoms):
                msg = f"orbital potential names atom {pot.atom + 1}, past the end of the structure"
                raise ValueError(msg)
            entry = Block("POT")
            entry.set("ATOM", atom_name(structure.atoms[pot.atom].element, pot.atom))
            entry.set("VALUE", pot.value)
            entry.set("TYPE", pot.shell)
            entry.set("S", pot.spin)
            entry.set("RC", pot.radius)
            blk.children.append(entry)
        strc.children.append(blk)

    constraints = _constraints_block(structure)
    if constraints is not None:
        strc.children.append(constraints)
    return root


def _constraints_block(structure: Structure) -> Block | None:
    if not structure.constraints:
        return None
    blk = Block("CONSTRAINTS")
    for c in structure.constraints:
        if isinstance(c, FixAtoms):
            for i in c.indices:
                f = Block("FREEZE")
                f.set("ATOM", atom_name(structure.atoms[i].element, i))
                blk.children.append(f)
        elif isinstance(c, FixCartesian):
            # CP-PAW has no per-component freeze; a fully fixed atom maps to FREEZE.
            if all(c.mask):
                f = Block("FREEZE")
                f.set("ATOM", atom_name(structure.atoms[c.index].element, c.index))
                blk.children.append(f)
        elif isinstance(c, FixBondLength):
            b = Block("BOND")
            b.set("ATOM1", atom_name(structure.atoms[c.a].element, c.a))
            b.set("ATOM2", atom_name(structure.atoms[c.b].element, c.b))
            b.set("SHOW", True)
            blk.children.append(b)
    return blk if blk.children else None


def strc_text(structure: Structure, opts: StrcOptions) -> str:
    return format_deck(build_strc(structure, opts))


# ---- reading -------------------------------------------------------------------------------


@dataclass
class StrcGeometry:
    names: list[str]
    positions_ang: np.ndarray
    cell_ang: np.ndarray
    charge: float | None
    spin: float | None
    nspin: int | None
    states: list[OccupationState] = field(default_factory=list)


def read_strc_geometry(text: str) -> StrcGeometry:
    """Read positions and cell from a ``.strc`` or ``.strc_out`` deck, converting to Å."""
    root = parse_deck(text)
    strc = root.child("STRUCTURE")
    if strc is None:
        msg = "no !STRUCTURE block"
        raise ValueError(msg)
    generic = strc.child("GENERIC")
    scale = Bohr  # default LUNIT=1 a.u.
    if generic is not None:
        if generic.get("LUNIT[AA]") is not None and "LUNIT[AA]" in {
            k.upper() for k in generic.keys
        }:
            scale = float(generic.get("LUNIT[AA]"))  # type: ignore[arg-type]
        elif generic.get("LUNIT") is not None:
            scale = float(generic.get("LUNIT")) * Bohr  # type: ignore[arg-type]
    lattice = strc.child("LATTICE")
    t = lattice.get("T") if lattice is not None else None
    if not isinstance(t, list) or len(t) != 9:
        msg = "!LATTICE T must have 9 numbers"
        raise ValueError(msg)
    cell = np.array(t, dtype=float).reshape(3, 3) * scale
    names: list[str] = []
    pos: list[list[float]] = []
    for a in strc.children_named("ATOM"):
        r = a.get("R")
        if not isinstance(r, list) or len(r) != 3:
            continue
        names.append(str(a.get("NAME")))
        pos.append([float(x) * scale for x in r])
    occ = strc.child("OCCUPATIONS")
    charge = spin = None
    nspin = None
    if occ is not None:
        if occ.get("CHARGE") is not None:
            charge = float(occ.get("CHARGE"))  # type: ignore[arg-type]
        if occ.get("SPIN") is not None:
            spin = float(occ.get("SPIN"))  # type: ignore[arg-type]
        raw_nspin = occ.get("NSPIN")
        if isinstance(raw_nspin, int | float):
            nspin = int(raw_nspin)
    states: list[OccupationState] = []
    if occ is not None:
        for st in occ.children_named("STATE"):
            b, sp, f = st.get("B"), st.get("S"), st.get("F")
            if isinstance(b, int | float) and isinstance(f, int | float):
                k = st.get("K")
                states.append(
                    OccupationState(
                        int(b),
                        int(sp) if isinstance(sp, int | float) else 1,
                        float(f),
                        int(k) if isinstance(k, int | float) else None,
                    )
                )
    return StrcGeometry(names, np.array(pos).reshape(-1, 3), cell, charge, spin, nspin, states)
