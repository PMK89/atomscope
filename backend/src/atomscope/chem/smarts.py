"""SMARTS substructure matching over the data model (Avogadro's "Select SMARTS...").

Open Babel does the matching because it is already the perception engine used elsewhere in
:mod:`atomscope.chem`, and its SMARTS dialect is the one Avogadro 1 exposed. Aromaticity is
perceived by Open Babel on the Kekulé bond orders built by :func:`atomscope.chem.obmol.to_obmol`,
so a pattern such as ``c1ccccc1`` matches a benzene ring imported without aromatic flags.
"""

from __future__ import annotations

from openbabel import openbabel as ob

from atomscope.chem.obmol import OB_LOCK, to_obmol
from atomscope.model import Structure


class SmartsError(ValueError):
    """The pattern could not be parsed."""


def match(structure: Structure, pattern: str, *, unique: bool = True) -> list[tuple[int, ...]]:
    """Atom indices of every match of ``pattern``, one tuple per match in pattern-atom order.

    ``unique`` keeps Open Babel's symmetry-unique matches (what a user selecting a functional
    group expects); ``unique=False`` returns every mapping, including the symmetry-equivalent
    permutations of a ring.
    """
    if not pattern.strip():
        msg = "empty SMARTS pattern"
        raise SmartsError(msg)
    with OB_LOCK:
        query = ob.OBSmartsPattern()
        if not query.Init(pattern):
            msg = f"invalid SMARTS pattern: {pattern!r}"
            raise SmartsError(msg)
        mol = to_obmol(structure)
        query.Match(mol)
        maps = query.GetUMapList() if unique else query.GetMapList()
        # Open Babel atom ids are 1-based and follow the order to_obmol added them in
        return [tuple(int(i) - 1 for i in m) for m in maps]


def matching_atoms(structure: Structure, pattern: str) -> list[int]:
    """Sorted atom indices covered by any match -- the selection Avogadro makes."""
    hits = {i for m in match(structure, pattern) for i in m}
    return sorted(hits)
