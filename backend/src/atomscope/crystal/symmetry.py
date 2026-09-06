"""Space-group perception and symmetry-based cell transformations via spglib."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

import numpy as np
import spglib
from ase import Atoms
from ase.build import niggli_reduce as ase_niggli_reduce
from ase.spacegroup import crystal as ase_crystal
from pydantic import Field

from atomscope.crystal._common import new_atoms, require_cell, same_atoms
from atomscope.crystal.cell import LatticeType, lattice_type_from_spacegroup
from atomscope.model import Structure
from atomscope.model.common import StrictModel

DEFAULT_SYMPREC = 1e-3


class SymmetryInfo(StrictModel):
    """Result of space-group perception."""

    number: int = Field(ge=1, le=230)
    international: str = Field(description="short Hermann-Mauguin symbol, e.g. 'Fd-3m'")
    international_full: str
    hall: str
    hall_number: int
    point_group: str
    schoenflies: str
    lattice_type: LatticeType
    n_operations: int
    wyckoffs: list[str]
    equivalent_atoms: list[int] = Field(description="per atom: index of its orbit representative")
    n_asymmetric: int
    symprec: float


class SpacegroupSetting(StrictModel):
    """One of the 530 settings of the 230 space groups, as spglib's database names it."""

    hall_number: int = Field(ge=1, le=530)
    number: int = Field(ge=1, le=230, description="International (ITA) number")
    international: str = Field(description="short Hermann-Mauguin symbol, e.g. 'Fm-3m'")
    international_full: str
    hall: str
    choice: str = Field(description="which setting of this group: origin, axis or cell choice")


@lru_cache(maxsize=1)
def spacegroup_settings() -> tuple[SpacegroupSetting, ...]:
    """The whole table, in Hall order. Avogadro listed the same 530 rows in its Set Spacegroup
    dialog (crystallographyextension.cpp:2504) with the International, Hall and Hermann-Mauguin
    columns; the setting is kept as well, because that is what distinguishes rows of one group."""
    out: list[SpacegroupSetting] = []
    for hall_number in range(1, 531):
        t = spglib.get_spacegroup_type(hall_number)
        if t is None:  # pragma: no cover - the database has all 530
            continue
        out.append(
            SpacegroupSetting(
                hall_number=hall_number,
                number=int(t.number),
                international=str(t.international_short),
                international_full=str(t.international_full),
                hall=str(t.hall_symbol),
                choice=str(t.choice),
            )
        )
    return tuple(out)


def _spg_cell(atoms: Atoms) -> Any:
    return (np.array(atoms.cell), atoms.get_scaled_positions(wrap=False), atoms.numbers)


def _dataset(atoms: Atoms, symprec: float) -> Any:
    if len(atoms) == 0:
        msg = "structure has no atoms"
        raise ValueError(msg)
    ds = spglib.get_symmetry_dataset(_spg_cell(atoms), symprec=symprec)
    if ds is None:
        msg = "spglib could not determine the symmetry (try a larger tolerance)"
        raise ValueError(msg)
    return ds


def perceive_symmetry(structure: Structure, symprec: float = DEFAULT_SYMPREC) -> SymmetryInfo:
    """Detect the space group of a periodic structure with tolerance ``symprec`` (Å)."""
    atoms = require_cell(structure)
    ds = _dataset(atoms, symprec)
    sg = spglib.get_spacegroup_type(ds.hall_number)
    if sg is None:
        msg = f"unknown Hall number {ds.hall_number}"
        raise ValueError(msg)
    equivalent = [int(i) for i in ds.equivalent_atoms]
    return SymmetryInfo(
        number=int(ds.number),
        international=str(ds.international),
        international_full=str(sg.international_full),
        hall=str(ds.hall),
        hall_number=int(ds.hall_number),
        point_group=str(ds.pointgroup),
        schoenflies=str(sg.schoenflies),
        lattice_type=lattice_type_from_spacegroup(int(ds.number), str(ds.international)),
        n_operations=len(ds.rotations),
        wyckoffs=[str(w) for w in ds.wyckoffs],
        equivalent_atoms=equivalent,
        n_asymmetric=len(set(equivalent)),
        symprec=symprec,
    )


def _standardize(
    structure: Structure, *, to_primitive: bool, no_idealize: bool, symprec: float
) -> Structure:
    atoms = require_cell(structure)
    result = spglib.standardize_cell(
        _spg_cell(atoms), to_primitive=to_primitive, no_idealize=no_idealize, symprec=symprec
    )
    if result is None:
        msg = "spglib could not standardize the cell (try a larger tolerance)"
        raise ValueError(msg)
    lattice, scaled, numbers = result
    out = Atoms(numbers=numbers, cell=lattice, pbc=atoms.pbc)
    out.set_scaled_positions(scaled)
    return new_atoms(structure, out)


def symmetrize(structure: Structure, symprec: float = DEFAULT_SYMPREC) -> Structure:
    """Idealize cell and positions to the detected symmetry (conventional standardized cell)."""
    return _standardize(structure, to_primitive=False, no_idealize=False, symprec=symprec)


def primitive_cell(structure: Structure, symprec: float = DEFAULT_SYMPREC) -> Structure:
    """Reduce to the primitive cell without idealizing positions."""
    return _standardize(structure, to_primitive=True, no_idealize=True, symprec=symprec)


def primitive_standardized(structure: Structure, symprec: float = DEFAULT_SYMPREC) -> Structure:
    """Reduce to the primitive cell and idealize to the standard setting."""
    return _standardize(structure, to_primitive=True, no_idealize=False, symprec=symprec)


def niggli_reduce(structure: Structure) -> Structure:
    """Niggli-reduce the cell; atoms keep their Cartesian positions (wrapped into the new cell)."""
    atoms = require_cell(structure)
    if not all(atoms.pbc):
        msg = "Niggli reduction needs a fully periodic cell"
        raise ValueError(msg)
    ase_niggli_reduce(atoms)
    return same_atoms(structure, atoms)


def _filled_by_hall(atoms: Atoms, hall_number: int, symprec: float) -> Atoms:
    """Fill the cell with the operations of one Hall setting, taken from spglib's database.

    ASE's ``crystal`` takes an ITA number and knows only the origin/cell choices (its ``setting``
    1 and 2), so it cannot place a group whose setting is a unique-axis choice: ITA 3 has three
    Hall settings (unique axis b, c, a) and ASE offers the first two. A dialog that lists all 530
    settings has to honour the one that was chosen, so the operations come from spglib itself.
    """
    operations = spglib.get_symmetry_from_database(hall_number)
    if operations is None:
        msg = f"unknown Hall number {hall_number}"
        raise ValueError(msg)
    basis = atoms.get_scaled_positions(wrap=True)
    symbols = atoms.get_chemical_symbols()
    positions: list[np.ndarray] = []
    kinds: list[str] = []
    for site, symbol in zip(basis, symbols, strict=True):
        for rotation, translation in zip(
            operations["rotations"], operations["translations"], strict=True
        ):
            image = np.mod(rotation @ site + translation, 1.0)
            # a site on a special position maps onto itself; wrapping puts 1 - eps beside 0
            delta = np.abs(np.array(positions) - image) if positions else np.empty((0, 3))
            delta = np.minimum(delta, 1.0 - delta)
            if any(bool(d.max() < symprec) and kinds[i] == symbol for i, d in enumerate(delta)):
                continue
            positions.append(image)
            kinds.append(symbol)
    return Atoms(symbols=kinds, scaled_positions=np.array(positions), cell=atoms.cell, pbc=True)


def fill_unit_cell(
    structure: Structure,
    spacegroup: int | None = None,
    symprec: float = DEFAULT_SYMPREC,
    hall_number: int | None = None,
) -> Structure:
    """Apply the space-group operations to the atoms (asymmetric unit) to fill the cell.

    ``hall_number`` names one of the 530 settings and is honoured exactly; ``spacegroup`` names
    an ITA number and takes ASE's default setting for it. With neither, the group is perceived
    first (which only works when the given atoms already form a complete cell; for a true
    asymmetric unit say which group it is).
    """
    atoms = require_cell(structure)
    if len(atoms) == 0:
        msg = "structure has no atoms"
        raise ValueError(msg)
    if hall_number is not None:
        if not 1 <= hall_number <= 530:
            msg = f"invalid Hall number {hall_number}"
            raise ValueError(msg)
        return new_atoms(structure, _filled_by_hall(atoms, hall_number, max(symprec, 1e-6)))
    number = spacegroup if spacegroup is not None else int(_dataset(atoms, symprec).number)
    if not 1 <= number <= 230:
        msg = f"invalid space group number {number}"
        raise ValueError(msg)
    filled = ase_crystal(
        symbols=atoms.get_chemical_symbols(),
        basis=atoms.get_scaled_positions(wrap=True),
        spacegroup=number,
        cell=np.array(atoms.cell),
        onduplicates="replace",
        symprec=max(symprec, 1e-6),
    )
    return new_atoms(structure, filled)


def asymmetric_unit(structure: Structure, symprec: float = DEFAULT_SYMPREC) -> Structure:
    """Keep one representative of each orbit of symmetry-equivalent atoms."""
    atoms = require_cell(structure)
    ds = _dataset(atoms, symprec)
    keep = sorted({int(i) for i in ds.equivalent_atoms})
    return new_atoms(structure, atoms[keep])
