"""Control files for the CP-PAW analysis tools (``.dcntl`` for ``paw_dos.x``, ``.bcntl`` for
``paw_bands.x``) and the restart control file that makes ``paw_fast.x`` write orbitals.

Verified on this workstation (docs/cppaw-analysis.md §4.7-4.9, §7 and the scratch runs of the
analysis branch):

* ``paw_dos.x ROOT.dcntl`` reads ``ROOT.pdos``; every ``!WEIGHT`` writes ``PREFIX//ID.dos``.
* ``paw_bands.x ROOT.bcntl`` in ``LINEARINTERPOLATION`` mode reads ``ROOT.pdos`` and
  interpolates the eigenvalues of the k-point mesh along ``!LINE`` segments given in relative
  reciprocal coordinates (``XK1``/``XK2``); the ``.dat`` rows are ``x E1..ENB`` in eV (checked
  against the DIAGONALISATION output of the same cell). ``DIAG`` diagonalizes the PAW Hamiltonian
  from ``ROOT.banddata`` at every k (slower, exact).
* Orbital ``.wv`` files are written only in the last step of a ``paw_fast.x`` run, so orbitals
  are exported by a one-step restart under a *separate root* (``ROOT_orb``) whose ``!FILES``
  block points ``STRC`` and ``RESTART_IN`` at the finished calculation. ``ROOT.prot``,
  ``ROOT.rstrt`` and ``ROOT.pdos`` stay untouched (md5-verified).
"""

from __future__ import annotations

import json
from typing import Literal

from ase.data import atomic_numbers
from pydantic import Field

from atomscope.backends.cppaw.cntl import build_cntl
from atomscope.backends.cppaw.deck import Block, format_deck
from atomscope.backends.cppaw.strc import atom_name
from atomscope.model import Structure
from atomscope.model.common import StrictModel
from atomscope.model.spectrum import KPathPoint

Values = dict[str, object]

L_CHANNELS: tuple[tuple[str, int], ...] = (("s", 0), ("p", 2), ("d", 18), ("f", 36))
"""Angular momentum channels and the atomic number above which they are projected (the rule of
the historical asecppaw ``makeDcntl``: p beyond He, d beyond Ar, f beyond Kr)."""


#: The orbitals ``!ORB`` accepts, from the tutorial's paw_dos cheat sheet (app. A.4, which points
#: at the manual's section 13.2.1 for the definitions). The hybrids are the reason ``NNZ`` exists:
#: an sp3 lobe has to point somewhere.
OrbitalType = Literal[
    "S",
    "PX",
    "PY",
    "PZ",
    "DXY",
    "DXZ",
    "DYZ",
    "D3Z2-R2",
    "DX2-Y2",
    "SP",
    "SP2",
    "SP3",
]


class OrbitalProjection(StrictModel):
    """One atomic orbital, optionally in a frame whose z axis points at a neighbour.

    ``toward`` is the tutorial's ``NNZ``. Without it an orbital like ``PZ`` or ``SP3`` is
    expressed in the cell's own axes, which is rarely what a chemical question means: ch. 4.7.4
    is about exactly this, projecting onto a local frame rather than a global one.
    """

    atom: int = Field(ge=0, description="0-based index into the structure")
    type: OrbitalType
    toward: int | None = Field(
        default=None, ge=0, description="0-based index of the atom the local z axis points at"
    )


class OrbitalWeight(StrictModel):
    """A ``!WEIGHT`` made of named orbitals rather than whole atoms or angular momenta."""

    id: str = Field(min_length=1, pattern=r"^[A-Za-z0-9_.\-]+$")
    label: str = ""
    orbitals: list[OrbitalProjection] = Field(min_length=1)


class CoopRequest(StrictModel):
    """A crystal-orbital overlap population between two orbitals.

    Positive where the two orbitals are bonding, negative where they are antibonding, which is
    what makes it worth plotting beside a density of states: the DOS says where the states are,
    the COOP says what they are doing.
    """

    id: str = Field(min_length=1, pattern=r"^[A-Za-z0-9_.\-]+$")
    label: str = ""
    first: OrbitalProjection
    second: OrbitalProjection


class DosOptions(StrictModel):
    broadening_ev: float = Field(default=0.1, gt=0, description="thermal broadening k_B T")
    de_ev: float = Field(default=0.01, gt=0, description="energy grid spacing")
    projection: Literal["none", "element", "atom"] = "element"
    l_channels: bool = Field(default=True, description="also project on s/p/d/f per element/atom")
    orbital_weights: list[OrbitalWeight] = Field(
        default_factory=list, description="!WEIGHT blocks built from named orbitals"
    )
    coops: list[CoopRequest] = Field(default_factory=list, description="!COOP blocks")


class BandOptions(StrictModel):
    mode: Literal["interpolate", "diagonalize"] = "interpolate"
    nk: int = Field(default=20, ge=2, description="k-points per path segment")
    path: list[KPathPoint] | None = Field(
        default=None,
        description="high-symmetry path; consecutive points form segments; None = default path",
    )


class OrbitalRequest(StrictModel):
    band: int = Field(ge=1, description="1-based band index")
    kpoint: int = Field(default=1, ge=1)
    spin: int = Field(default=1, ge=1, le=2)


class OrbitalExportOptions(StrictModel):
    orbitals: list[OrbitalRequest] = Field(min_length=1)


# ---- DOS ---------------------------------------------------------------------------------------
def dos_prefix(root_name: str) -> str:
    return f"{root_name}_dos_"


def dos_weights(
    structure: Structure, opts: DosOptions
) -> list[tuple[str, str, list[tuple[str, str]]]]:
    """(id, label, [(atom name, TYPE)]) per ``!WEIGHT``; an empty atom list means TYPE='TOTAL'."""
    weights: list[tuple[str, str, list[tuple[str, str]]]] = [("total", "total", [])]
    if opts.projection == "none":
        return weights
    groups: list[tuple[str, str, list[str], int]] = []  # id, label, atom names, Z
    if opts.projection == "element":
        for sym in dict.fromkeys(a.element for a in structure.atoms):
            names = [
                atom_name(a.element, i) for i, a in enumerate(structure.atoms) if a.element == sym
            ]
            groups.append((sym, sym, names, atomic_numbers[sym]))
    else:
        for i, a in enumerate(structure.atoms):
            name = atom_name(a.element, i)
            groups.append((name, name, [name], atomic_numbers[a.element]))
    for gid, label, names, z in groups:
        weights.append((gid, label, [(n, "ALL") for n in names]))
        if opts.l_channels:
            for channel, zmin in L_CHANNELS:
                if z > zmin:
                    weights.append(
                        (
                            f"{gid}_{channel}",
                            f"{label} {channel}",
                            [(n, channel.upper()) for n in names],
                        )
                    )
    return weights


def _orb_block(name: str, structure: Structure, orb: OrbitalProjection) -> Block:
    """``!ORB``/``!ORB1``/``!ORB2``: an atom, an orbital, and optionally what its z axis faces."""
    n_atoms = len(structure.atoms)
    for index in (orb.atom, orb.toward):
        if index is not None and index >= n_atoms:
            msg = f"atom index {index} is outside a structure of {n_atoms} atoms"
            raise ValueError(msg)
    block = Block(name)
    block.set("ATOM", atom_name(structure.atoms[orb.atom].element, orb.atom))
    block.set("TYPE", orb.type)
    if orb.toward is not None:
        if orb.toward == orb.atom:
            msg = f"an orbital cannot point at its own atom (index {orb.atom})"
            raise ValueError(msg)
        block.set("NNZ", atom_name(structure.atoms[orb.toward].element, orb.toward))
    return block


def dcntl_text(root_name: str, structure: Structure, opts: DosOptions) -> str:
    root = Block("__ROOT__")
    d = Block("DCNTL")
    root.children.append(d)
    d.ensure_child("GENERIC").set("PREFIX", dos_prefix(root_name))
    grid = d.ensure_child("GRID")
    grid.set("DE[EV]", opts.de_ev)
    grid.set("BROADENING[EV]", opts.broadening_ev)
    for wid, label, atoms in dos_weights(structure, opts):
        w = Block("WEIGHT")
        w.set("ID", wid)
        w.set("LEGEND", label)
        if not atoms:
            w.set("TYPE", "TOTAL")
        for name, typ in atoms:
            a = Block("ATOM")
            a.set("NAME", name)
            a.set("TYPE", typ)
            w.children.append(a)
        d.children.append(w)
    for weight in opts.orbital_weights:
        w = Block("WEIGHT")
        w.set("ID", weight.id)
        w.set("LEGEND", weight.label or weight.id)
        for orb in weight.orbitals:
            w.children.append(_orb_block("ORB", structure, orb))
        d.children.append(w)
    for coop in opts.coops:
        c = Block("COOP")
        c.set("ID", coop.id)
        # paw_dos labels a COOP "COOP:SET n" in the file trailer, so the legend is ours to give
        c.set("LEGEND", coop.label or coop.id)
        c.children.append(_orb_block("ORB1", structure, coop.first))
        c.children.append(_orb_block("ORB2", structure, coop.second))
        d.children.append(c)
    return format_deck(root)


# ---- bands -------------------------------------------------------------------------------------
def band_file(root_name: str, spin: int) -> str:
    return f"{root_name}_bands_s{spin}.dat"


def band_sidecar(root_name: str) -> str:
    """JSON next to the .bcntl remembering what the plot needs (labels, nk, mode)."""
    return f"{root_name}_bands.json"


def path_segments(path: list[KPathPoint]) -> list[tuple[KPathPoint, KPathPoint]]:
    """Consecutive pairs; a point labelled ``,`` (or a repeated label ``A|B``) breaks the path."""
    segs: list[tuple[KPathPoint, KPathPoint]] = []
    for a, b in zip(path, path[1:], strict=False):
        if a.label == "," or b.label == ",":
            continue
        segs.append((a, b))
    return segs


def bcntl_text(
    root_name: str, path: list[KPathPoint], opts: BandOptions, nb: int, n_spins: int
) -> str:
    root = Block("__ROOT__")
    b = Block("BCNTL")
    root.children.append(b)
    if opts.mode == "diagonalize":
        inp = b.ensure_child("INPUTFILE")
        inp.set("NAME", f"{root_name}.banddata")
    bs = b.ensure_child("BANDSTRUCTURE")
    bs.set("MODE", "LINEARINTERPOLATION" if opts.mode == "interpolate" else "DIAG")
    for spin in range(1, n_spins + 1):
        for i, (p1, p2) in enumerate(path_segments(path)):
            line = Block("LINE")
            line.set("FILE", band_file(root_name, spin))
            line.set("TAPPEND", i > 0)
            line.set("NK", opts.nk)
            line.set("NB", nb)
            line.set("SPIN", spin)
            line.set("XK1", [float(x) for x in p1.xk])
            line.set("XK2", [float(x) for x in p2.xk])
            bs.children.append(line)
    return format_deck(root)


def band_sidecar_text(path: list[KPathPoint], opts: BandOptions, n_spins: int) -> str:
    return json.dumps(
        {
            "mode": opts.mode,
            "nk": opts.nk,
            "n_spins": n_spins,
            "path": [p.model_dump() for p in path],
        },
        indent=2,
    )


# ---- orbitals ----------------------------------------------------------------------------------
def orbital_root(root_name: str) -> str:
    return f"{root_name}_orb"


def orbital_wave_file(orb_root: str, req: OrbitalRequest) -> str:
    return f"{orb_root}_b{req.band}k{req.kpoint}s{req.spin}.wv"


def orbital_cntl_text(root_name: str, values: Values, requests: list[OrbitalRequest]) -> str:
    """One-step restart (``START=F NSTEP=1``) under root ``<root>_orb`` that only writes the
    requested ``!WAVE`` files; the electronic parameters of the finished run are kept."""
    v: Values = dict(values)
    v.update(
        {
            "task": "single_point",
            "start": "restart",
            "nstep": 1,
            "nwrite": 1,
            "psi_auto": False,
            "write_density": False,
            "write_spin_density": False,
            "orbital_bands": "",
            "energy_trajectory": False,
        }
    )
    orb = orbital_root(root_name)
    root = build_cntl(orb, v)
    ctl = root.child("CONTROL")
    assert ctl is not None  # noqa: S101
    files = Block("FILES")
    for fid, name in (("STRC", f"{root_name}.strc"), ("RESTART_IN", f"{root_name}.rstrt")):
        f = Block("FILE")
        f.set("ID", fid)
        f.set("EXT", False)
        f.set("NAME", name)
        files.children.append(f)
    ctl.children.insert(0, files)
    ana = ctl.ensure_child("ANALYSE")
    dr = values.get("grid_spacing", 0.4)
    for req in requests:
        w = Block("WAVE")
        w.set("TITLE", f"band {req.band} k {req.kpoint} spin {req.spin}")
        w.set("FILE", orbital_wave_file(orb, req))
        w.set("B", req.band)
        w.set("K", req.kpoint)
        w.set("S", req.spin)
        w.set("DR", float(dr) if isinstance(dr, int | float) else 0.4)
        ana.children.append(w)
    return format_deck(root)


__all__ = [
    "BandOptions",
    "DosOptions",
    "OrbitalExportOptions",
    "OrbitalRequest",
    "band_file",
    "band_sidecar",
    "band_sidecar_text",
    "bcntl_text",
    "dcntl_text",
    "dos_prefix",
    "dos_weights",
    "orbital_cntl_text",
    "orbital_root",
    "orbital_wave_file",
    "path_segments",
]
