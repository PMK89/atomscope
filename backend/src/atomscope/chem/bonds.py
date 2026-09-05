"""Distance-based bond perception.

Two atoms are bonded when their distance is below ``tolerance * (r_i + r_j)`` with covalent
radii from ``ase.data.covalent_radii`` (Cordero et al., Dalton Trans. 2008). This is the same
criterion Avogadro 1 / Open Babel use for connectivity guesses (Avogadro uses 0.45 Å slack on
the radius sum; the multiplicative form used here behaves better for heavy elements). Periodic
images are considered when a cell with periodic directions is present, but only bonds to the
minimum-image partner are recorded, which is what a viewer needs.

Two neighbour searches are used for the same criterion:

* periodic structures go through ``ase.neighborlist``, which handles the minimum image of an
  arbitrary triclinic cell correctly;
* non-periodic structures use a ``scipy.spatial.cKDTree``. ASE's neighbour list degenerates to
  an all-pairs search without a cell and allocates an N x N index array - 142 GiB at 1e5 atoms
  and a hard MemoryError (measured; see ``docs/performance.md``).

Both paths return the same bonds; ``tests/chem/test_bonds.py`` pins that by comparing a molecule
read with and without a large surrounding cell.
"""

from __future__ import annotations

import numpy as np
from ase import Atoms
from ase.data import covalent_radii
from ase.neighborlist import neighbor_list
from scipy.spatial import cKDTree

from atomscope.model import Bond, Structure

DEFAULT_TOLERANCE = 1.15


def _periodic_pairs(structure: Structure, cutoffs: np.ndarray) -> np.ndarray:
    """(M,2) index pairs with i < j from ASE's minimum-image neighbour list."""
    assert structure.cell is not None  # guaranteed by Structure.is_periodic()
    atoms = Atoms(
        numbers=structure.numbers(),
        positions=structure.positions(),
        cell=np.array(structure.cell.vectors),
        pbc=list(structure.cell.pbc),
    )
    i_idx, j_idx = neighbor_list("ij", atoms, cutoffs)
    # i < j drops both the mirrored (j,i) entry and self-bonds through a periodic image, which
    # is what the previous element-wise loop did.
    keep = i_idx < j_idx
    return np.stack((i_idx[keep], j_idx[keep]), axis=1)


def _molecular_pairs(positions: np.ndarray, cutoffs: np.ndarray) -> np.ndarray:
    """(M,2) index pairs with i < j for a structure without periodic boundaries."""
    tree = cKDTree(positions)
    pairs = tree.query_pairs(r=float(2.0 * cutoffs.max()), output_type="ndarray")
    if pairs.size == 0:
        return np.empty((0, 2), dtype=np.int64)
    delta = positions[pairs[:, 0]] - positions[pairs[:, 1]]
    distance = np.sqrt(np.einsum("ij,ij->i", delta, delta))
    return pairs[distance < cutoffs[pairs[:, 0]] + cutoffs[pairs[:, 1]]]


def perceive_bonds(structure: Structure, tolerance: float = DEFAULT_TOLERANCE) -> list[Bond]:
    """Return single bonds for all atom pairs closer than the scaled covalent-radius sum."""
    if structure.n_atoms < 2:
        return []
    # neighbour searches need per-atom cutoffs such that pairs are found when d < c_i + c_j.
    cutoffs = covalent_radii[structure.numbers()] * tolerance
    if structure.is_periodic():
        pairs = _periodic_pairs(structure, cutoffs)
    else:
        pairs = _molecular_pairs(structure.positions(), cutoffs)
    if pairs.size == 0:
        return []
    # unique rows come out lexicographically sorted, i.e. ordered by (a, b) as before; the
    # deduplication matters for periodic cells where two images of j neighbour the same i.
    pairs = np.unique(pairs, axis=0)
    # a and b come from index arrays and satisfy 0 <= a < b, so Bond's validators cannot fail:
    # model_construct skips them, which is worth seconds at 1e5 atoms.
    return [Bond.model_construct(a=a, b=b) for a, b in pairs.tolist()]
