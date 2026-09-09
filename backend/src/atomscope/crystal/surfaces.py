"""Named surface slabs and adsorbates (`ase.build`'s surface family).

`crystal.build.slab` already cuts any Miller plane out of any bulk cell, which is the general
answer. What this module adds is the thing that general answer cannot give: **named adsorption
sites**. A slab built by `fcc111` knows where its ontop, bridge, fcc and hcp sites are, so an
adsorbate can be placed "on the hcp site" rather than at coordinates worked out by hand -- and
those names are what a surface-chemistry paper is written in.

ASE keeps the sites in `atoms.info['adsorbate_info']`, a dict on the Atoms object that would be
lost the moment the structure was saved. `Structure.surface` (`model.SurfaceInfo`) is where they
live instead, and `ase_bridge.convert` writes ASE's own key back, so `ase.build.add_adsorbate`
works on a slab that has been through a project file or a user script.

**Not exposed here:** `graphene`, `mx2` and `nanotube`. They are in the same ASE module but are
2D materials and tubes rather than adsorption surfaces, and each takes a different
parameterisation (a formula and a thickness, or a chiral index pair) that the uniform
`(symbol, size, a, c, vacuum)` shape below cannot carry. A script can call them directly and
`save()` the result.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import numpy as np
from ase import Atoms
from ase.build import (
    add_adsorbate,
    add_vacuum,
    bcc100,
    bcc110,
    bcc111,
    diamond100,
    diamond111,
    fcc100,
    fcc110,
    fcc111,
    fcc211,
    hcp0001,
    hcp10m10,
    molecule,
)
from ase.collections import g2
from ase.data import chemical_symbols
from pydantic import Field

from atomscope.ase_bridge.convert import to_atoms
from atomscope.crystal._common import new_atoms
from atomscope.model import Structure
from atomscope.model.common import StrictModel


@dataclass(frozen=True)
class Builder:
    """One of ASE's layered-surface builders and what it accepts.

    The lattice and the facet are spelt out rather than split off the name: `hcp10m10`'s facet is
    (10-10) and the `m` in it is a letter, so any rule that separates letters from digits gets
    that one wrong -- which is exactly what it did before this table existed.
    """

    build: Callable[..., Atoms]
    lattice: str
    facet: str
    #: ASE takes an ``orthogonal`` argument. `fcc211` is orthogonal already and has no switch.
    orthogonal: bool = False
    #: ASE takes a second lattice constant.
    takes_c: bool = False


#: The layered-surface builders, which all take ``(symbol, size, a=, vacuum=, ...)``.
BUILDERS: dict[str, Builder] = {
    "fcc100": Builder(fcc100, "fcc", "100"),
    "fcc110": Builder(fcc110, "fcc", "110", orthogonal=True),
    "fcc111": Builder(fcc111, "fcc", "111", orthogonal=True),
    "fcc211": Builder(fcc211, "fcc", "211"),
    "bcc100": Builder(bcc100, "bcc", "100"),
    "bcc110": Builder(bcc110, "bcc", "110", orthogonal=True),
    "bcc111": Builder(bcc111, "bcc", "111", orthogonal=True),
    "hcp0001": Builder(hcp0001, "hcp", "0001", orthogonal=True, takes_c=True),
    "hcp10m10": Builder(hcp10m10, "hcp", "10-10", orthogonal=True, takes_c=True),
    "diamond100": Builder(diamond100, "diamond", "100"),
    "diamond111": Builder(diamond111, "diamond", "111", orthogonal=True),
}

#: Molecular adsorbates by name (ASE's G2 collection: 'CO', 'H2O', 'NH3', 'CH4' ...).
MOLECULE_NAMES: tuple[str, ...] = tuple(sorted(g2.names))


class SurfaceError(ValueError):
    """A builder that does not exist, a size it refuses, an element it has no constant for."""


class SurfaceKind(StrictModel):
    """One entry of the builder list, for a dialog to offer."""

    id: str
    lattice: str = Field(description="fcc, bcc, hcp or diamond")
    facet: str = Field(description="Miller indices as the builder names them")
    sites: list[str] = Field(description="named adsorption sites this facet has")
    orthogonal_option: bool
    takes_c: bool


class AdsorptionSite(StrictModel):
    """A named site of a slab, in the surface cell and in Cartesian x-y."""

    name: str
    fractional: tuple[float, float]
    cartesian: tuple[float, float]


def kinds() -> list[SurfaceKind]:
    """The builders, with the sites each facet has.

    The site names are read from a small slab actually built for the purpose rather than
    tabulated: they are ASE's, and a table would be a second copy to drift.
    """
    out: list[SurfaceKind] = []
    for name, entry in BUILDERS.items():
        try:
            probe = build(
                name, PROBE_SYMBOL[entry.lattice], (3, 3, 3) if name == "fcc211" else (1, 1, 2)
            )
            sites = sorted((probe.surface.sites if probe.surface else {}) or {})
        except SurfaceError:  # pragma: no cover - every builder in the table works
            sites = []
        out.append(
            SurfaceKind(
                id=name,
                lattice=entry.lattice,
                facet=entry.facet,
                sites=sites,
                orthogonal_option=entry.orthogonal,
                takes_c=entry.takes_c,
            )
        )
    return out


#: An element each lattice has a tabulated constant for, so the site names can be read off.
PROBE_SYMBOL = {"fcc": "Cu", "bcc": "Fe", "hcp": "Ti", "diamond": "Si"}


def build(
    kind: str,
    symbol: str,
    size: tuple[int, int, int],
    *,
    a: float | None = None,
    c: float | None = None,
    vacuum: float | None = None,
    orthogonal: bool | None = None,
) -> Structure:
    """A slab from one of ASE's named builders, carrying its adsorption sites.

    ``size`` is (repeats along the first surface vector, repeats along the second, layers).
    ``vacuum`` is added on *each* side of the slab, as in ASE. ``a`` and ``c`` default to the
    element's tabulated lattice constants, which not every element has -- ASE says which.
    """
    entry = BUILDERS.get(kind)
    if entry is None:
        msg = f"unknown surface builder {kind!r}; one of {', '.join(BUILDERS)}"
        raise SurfaceError(msg)
    if len(size) != 3 or any(n < 1 for n in size):
        msg = "size must be three positive integers: two surface repeats and a layer count"
        raise SurfaceError(msg)
    kwargs: dict[str, Any] = {"size": tuple(int(n) for n in size)}
    if a is not None:
        kwargs["a"] = a
    if c is not None:
        if not entry.takes_c:
            msg = f"{kind} takes no second lattice constant"
            raise SurfaceError(msg)
        kwargs["c"] = c
    if vacuum is not None:
        kwargs["vacuum"] = vacuum
    if orthogonal is not None:
        if not entry.orthogonal:
            msg = f"{kind} has no orthogonal option"
            raise SurfaceError(msg)
        kwargs["orthogonal"] = orthogonal
    try:
        atoms = entry.build(symbol, **kwargs)
    except (ValueError, RuntimeError, KeyError) as exc:
        raise SurfaceError(str(exc)) from exc
    return from_slab(atoms, name=f"{symbol}({entry.facet})")


def from_slab(atoms: Atoms, *, name: str) -> Structure:
    """A Structure from a freshly built slab: bonds perceived, sites kept.

    `new_atoms` drops the Atomscope blob (there is no previous structure to map onto) and
    re-perceives bonds; ASE's `adsorbate_info` is a different key and survives, which is how the
    sites reach `Structure.surface`.
    """
    return new_atoms(Structure(name=name), atoms, name=name)


def sites(structure: Structure) -> list[AdsorptionSite]:
    """The named sites of a slab, or an empty list when it was not built by a named builder."""
    info = structure.surface
    if info is None:
        return []
    cell = np.array(info.cell, dtype=float)
    out: list[AdsorptionSite] = []
    for site_name, fractional in sorted(info.sites.items()):
        x, y = np.dot(np.array(fractional, dtype=float), cell)
        out.append(
            AdsorptionSite(
                name=site_name,
                fractional=(float(fractional[0]), float(fractional[1])),
                cartesian=(float(x), float(y)),
            )
        )
    return out


def resolve_adsorbate(adsorbate: str | Structure) -> Atoms:
    """An adsorbate from an element symbol, a molecule name, or a structure of its own.

    A single letter is ambiguous between the two -- 'C' is both carbon and G2's carbon atom -- so
    a chemical symbol wins, which is what someone typing 'O' on a surface means.
    """
    if isinstance(adsorbate, Structure):
        if not adsorbate.atoms:
            msg = "the adsorbate structure has no atoms"
            raise SurfaceError(msg)
        return to_atoms(adsorbate)
    text = adsorbate.strip()
    if text in chemical_symbols and text != "X":
        return Atoms(text, positions=[(0.0, 0.0, 0.0)])
    if text in g2.names:
        built: Atoms = molecule(text)
        return built
    msg = f"{adsorbate!r} is neither an element symbol nor one of ASE's molecule names"
    raise SurfaceError(msg)


def adsorb(
    structure: Structure,
    adsorbate: str | Structure,
    height: float,
    *,
    site: str | None = None,
    position: tuple[float, float] | None = None,
    offset: tuple[float, float] | None = None,
    mol_index: int = 0,
) -> Structure:
    """Put ``adsorbate`` ``height`` A above the surface, on a named site or at an x-y position.

    ``site`` needs a slab with named sites (`Structure.surface`); ``position`` is Cartesian x-y
    and works on any slab. ``offset`` shifts by whole surface cells, which is how a second
    adsorbate is put on the neighbouring site rather than on top of the first. ``mol_index`` is
    which atom of a molecular adsorbate sits over the site -- ASE does not orient the molecule,
    so a CO stands however `ase.build.molecule` built it.

    The height is measured from the slab's top layer, and *the same* atom keeps being the
    reference for every later adsorbate: ASE caches it in `adsorbate_info` and
    `Structure.surface.top_layer_atom_index` carries it, so a second adsorbate is not stacked on
    the first.
    """
    if site is None and position is None:
        msg = "give a named site or an x-y position"
        raise SurfaceError(msg)
    if site is not None and position is not None:
        msg = "give a named site or an x-y position, not both"
        raise SurfaceError(msg)
    if site is not None and (structure.surface is None or site not in structure.surface.sites):
        known = sorted((structure.surface.sites if structure.surface else {}) or {})
        msg = f"this structure has no site named {site!r}" + (
            f"; it has {', '.join(known)}" if known else " (it was not built as a named surface)"
        )
        raise SurfaceError(msg)
    atoms = to_atoms(structure)
    ads = resolve_adsorbate(adsorbate)
    try:
        add_adsorbate(
            atoms,
            ads,
            height,
            position=site if site is not None else position,
            offset=offset,
            mol_index=mol_index,
        )
    except (TypeError, ValueError, IndexError) as exc:
        raise SurfaceError(str(exc)) from exc
    formula = ads.get_chemical_formula()
    where = site if site is not None else "surface"
    return new_atoms(structure, atoms, name=f"{structure.name} + {formula} ({where})")


def with_vacuum(structure: Structure, vacuum: float) -> Structure:
    """Extend the cell along its third vector by ``vacuum`` A (`ase.build.add_vacuum`).

    Unlike a builder's ``vacuum``, this adds the whole amount on one side: it is for giving a
    slab that already exists more room above it.
    """
    if vacuum <= 0:
        msg = "the vacuum to add must be positive"
        raise SurfaceError(msg)
    if structure.cell is None:
        msg = "adding vacuum needs a cell"
        raise SurfaceError(msg)
    atoms = to_atoms(structure)
    add_vacuum(atoms, vacuum)
    return new_atoms(structure, atoms, name=structure.name)
