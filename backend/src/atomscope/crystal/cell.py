"""Unit-cell operations: set/scale/wrap/translate/orient, fractional coordinates, add/remove."""

from __future__ import annotations

from typing import Literal

import numpy as np
from ase.geometry import cellpar_to_cell

from atomscope.ase_bridge.convert import to_atoms
from atomscope.crystal._common import require_cell, same_atoms
from atomscope.model import Cell, Structure
from atomscope.model.common import Mat3, Vec3

CoordinateMode = Literal["cartesian", "fractional"]
Cellpar = tuple[float, float, float, float, float, float]
LatticeType = Literal[
    "triclinic",
    "monoclinic",
    "orthorhombic",
    "tetragonal",
    "rhombohedral",
    "hexagonal",
    "cubic",
]

DEFAULT_PADDING = 5.0


def _mat3(m: np.ndarray) -> Mat3:
    return (
        (float(m[0, 0]), float(m[0, 1]), float(m[0, 2])),
        (float(m[1, 0]), float(m[1, 1]), float(m[1, 2])),
        (float(m[2, 0]), float(m[2, 1]), float(m[2, 2])),
    )


def cell_from_parameters(cellpar: Cellpar) -> Mat3:
    """Lattice vectors (rows) from (a, b, c, alpha, beta, gamma): a along x, b in the xy plane."""
    if min(cellpar[:3]) <= 0:
        msg = "cell lengths must be positive"
        raise ValueError(msg)
    return _mat3(np.asarray(cellpar_to_cell(list(cellpar))))


def set_cell(structure: Structure, vectors: Mat3, mode: CoordinateMode = "cartesian") -> Structure:
    """Replace (or create) the cell.

    ``mode='cartesian'`` keeps atoms where they are; ``mode='fractional'`` keeps their fractional
    coordinates, i.e. the atoms move with the lattice. A structure without a cell is given one
    (fractional mode then behaves like cartesian).
    """
    atoms = to_atoms(structure)
    pbc = structure.cell.pbc if structure.cell is not None else (True, True, True)
    scale = mode == "fractional" and structure.cell is not None
    atoms.set_cell(np.array(vectors), scale_atoms=scale)
    atoms.set_pbc(list(pbc))
    return same_atoms(structure, atoms)


def fractional_coordinates(structure: Structure) -> list[Vec3]:
    """Fractional coordinates of all atoms (not wrapped)."""
    atoms = require_cell(structure)
    return [(float(p[0]), float(p[1]), float(p[2])) for p in atoms.get_scaled_positions(wrap=False)]


def set_fractional_coordinates(structure: Structure, fractional: list[Vec3]) -> Structure:
    """Move the atoms to the given fractional coordinates (same count and order)."""
    atoms = require_cell(structure)
    if len(fractional) != len(atoms):
        msg = f"expected {len(atoms)} fractional coordinates, got {len(fractional)}"
        raise ValueError(msg)
    atoms.set_scaled_positions(np.array(fractional, dtype=float))
    return same_atoms(structure, atoms)


def wrap_atoms(structure: Structure) -> Structure:
    """Wrap all atoms into the cell (fractional coordinates in [0, 1))."""
    atoms = require_cell(structure)
    atoms.wrap(pbc=True)
    return same_atoms(structure, atoms)


def translate_atoms(
    structure: Structure,
    vector: Vec3,
    mode: CoordinateMode = "cartesian",
    *,
    wrap: bool = False,
    indices: list[int] | None = None,
) -> Structure:
    """Translate all (or the given) atoms by a Cartesian or fractional vector."""
    atoms = require_cell(structure) if mode == "fractional" or wrap else to_atoms(structure)
    shift = np.array(vector, dtype=float)
    if mode == "fractional":
        shift = shift @ np.array(atoms.cell)
    sel = np.arange(len(atoms)) if indices is None else np.array(indices, dtype=int)
    positions = atoms.get_positions()
    positions[sel] += shift
    atoms.set_positions(positions)
    if wrap:
        atoms.wrap(pbc=True)
    return same_atoms(structure, atoms)


def rotate_to_standard_orientation(structure: Structure) -> Structure:
    """Rigidly rotate cell and atoms so a is along x and b lies in the xy plane."""
    atoms = require_cell(structure)
    scaled = atoms.get_scaled_positions(wrap=False)
    atoms.set_cell(cellpar_to_cell(atoms.cell.cellpar()))
    atoms.set_scaled_positions(scaled)
    return same_atoms(structure, atoms)


def scale_to_volume(structure: Structure, volume: float) -> Structure:
    """Isotropically scale the cell (atoms keep fractional coordinates) to ``volume`` in Å^3."""
    if volume <= 0:
        msg = "volume must be positive"
        raise ValueError(msg)
    atoms = require_cell(structure)
    current = atoms.get_volume()
    if current <= 0:
        msg = "cell has zero volume"
        raise ValueError(msg)
    atoms.set_cell(np.array(atoms.cell) * (volume / current) ** (1.0 / 3.0), scale_atoms=True)
    return same_atoms(structure, atoms)


def add_cell(structure: Structure, padding: float = DEFAULT_PADDING) -> Structure:
    """Give a molecule an orthorhombic cell: extent + 2*padding per axis (10 Å minimum).

    Atoms are shifted so the molecule sits at the cell centre. An existing cell is kept.
    """
    if structure.cell is not None:
        return structure
    atoms = to_atoms(structure)
    if len(atoms) == 0:
        lengths = np.full(3, max(10.0, 2 * padding))
    else:
        pos = atoms.get_positions()
        extent = pos.max(axis=0) - pos.min(axis=0)
        lengths = np.maximum(extent + 2 * padding, 10.0)
        atoms.translate(-pos.min(axis=0) + (lengths - extent) / 2)
    atoms.set_cell(np.diag(lengths))
    atoms.set_pbc(True)
    return same_atoms(structure, atoms)


def remove_cell(structure: Structure) -> Structure:
    """Drop the unit cell (atoms keep their Cartesian coordinates)."""
    return structure.model_copy(update={"cell": None})


def lattice_type_from_parameters(cell: Cell, tol: float = 1e-3) -> LatticeType:
    """Classify the lattice from lengths and angles alone (no symmetry perception)."""
    (a, b, c), (alpha, beta, gamma) = cell.lengths_angles()
    eq = lambda x, y: abs(x - y) <= tol * max(1.0, abs(x))  # noqa: E731
    right = [eq(x, 90.0) for x in (alpha, beta, gamma)]
    n_equal = sum([eq(a, b), eq(b, c), eq(a, c)])
    if all(right):
        by_lengths: dict[int, LatticeType] = {3: "cubic", 1: "tetragonal", 0: "orthorhombic"}
        return by_lengths[n_equal]
    if eq(a, b) and right[0] and right[1] and eq(gamma, 120.0):
        return "hexagonal"
    if n_equal == 3 and eq(alpha, beta) and eq(beta, gamma):
        return "rhombohedral"
    return "monoclinic" if sum(right) == 2 else "triclinic"


def lattice_type_from_spacegroup(number: int, symbol: str) -> LatticeType:
    """Crystal system of a space group number (trigonal groups: rhombohedral if R-centred)."""
    bounds: list[tuple[int, LatticeType]] = [
        (2, "triclinic"),
        (15, "monoclinic"),
        (74, "orthorhombic"),
        (142, "tetragonal"),
        (167, "rhombohedral" if symbol.startswith("R") else "hexagonal"),
        (194, "hexagonal"),
        (230, "cubic"),
    ]
    for upper, name in bounds:
        if number <= upper:
            return name
    msg = f"invalid space group number {number}"
    raise ValueError(msg)
