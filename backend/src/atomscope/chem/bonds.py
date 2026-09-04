"""Distance-based bond perception.

Two atoms are bonded when their distance is below ``tolerance * (r_i + r_j)`` with covalent
radii from ``ase.data.covalent_radii`` (Cordero et al., Dalton Trans. 2008). This is the same
criterion Avogadro 1 / Open Babel use for connectivity guesses (Avogadro uses 0.45 Å slack on
the radius sum; the multiplicative form used here behaves better for heavy elements). Periodic
images are considered when a cell with periodic directions is present, but only bonds to the
minimum-image partner are recorded, which is what a viewer needs.
"""

from __future__ import annotations

import numpy as np
from ase.data import atomic_numbers, covalent_radii
from ase.neighborlist import neighbor_list

from atomscope.ase_bridge.convert import to_atoms
from atomscope.model import Bond, Structure

DEFAULT_TOLERANCE = 1.15


def perceive_bonds(structure: Structure, tolerance: float = DEFAULT_TOLERANCE) -> list[Bond]:
    """Return single bonds for all atom pairs closer than the scaled covalent-radius sum."""
    if structure.n_atoms < 2:
        return []
    radii = np.array([covalent_radii[atomic_numbers[a.element]] for a in structure.atoms])
    atoms = to_atoms(structure)
    if not structure.is_periodic():
        atoms.set_pbc(False)
        atoms.set_cell(None)
    # neighbor_list needs per-atom cutoffs such that pairs are found when d < c_i + c_j.
    cutoffs = radii * tolerance
    i_idx, j_idx = neighbor_list("ij", atoms, cutoffs)
    seen: set[tuple[int, int]] = set()
    bonds: list[Bond] = []
    for i, j in zip(i_idx.tolist(), j_idx.tolist(), strict=True):
        if i == j:
            continue
        key = (i, j) if i < j else (j, i)
        if key in seen:
            continue
        seen.add(key)
        bonds.append(Bond(a=key[0], b=key[1]))
    bonds.sort(key=lambda b: (b.a, b.b))
    return bonds
