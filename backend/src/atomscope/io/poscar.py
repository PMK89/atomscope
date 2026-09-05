"""VASP POSCAR text that arrives without a filename (Avogadro's Import Crystal from Clipboard).

A POSCAR names its lattice but not always its species: VASP 4 wrote the counts alone and took the
element symbols from the POTCAR sitting beside the file. There is no POTCAR beside a paste, so the
species have to come from somewhere else -- the comment line if it happens to hold them, and
otherwise from the user, which is the identity-mapping dialog Avogadro shows.

ASE's reader looks for that POTCAR itself and dies on ``fd.name`` when handed a text buffer, so the
text is always rewritten into the VASP 5 form (a species line above the counts) before ASE sees it.
"""

from __future__ import annotations

from ase.data import chemical_symbols

_SYMBOLS = {s for s in chemical_symbols if s}


class MissingSpeciesError(ValueError):
    """A VASP 4 POSCAR: the counts are known, the elements they count are not."""

    def __init__(self, counts: list[int]) -> None:
        self.counts = counts
        n = " + ".join(str(c) for c in counts)
        super().__init__(
            f"this POSCAR does not name its elements ({len(counts)} species, {n} atoms): "
            "VASP 4 kept them in the POTCAR. Say which element each species is."
        )


def _floats(line: str, n: int, *, exactly: bool = False) -> bool:
    parts = line.split()
    if len(parts) < n or (exactly and len(parts) != n):
        return False
    try:
        for p in parts[:n]:
            float(p)
    except ValueError:
        return False
    return True


def looks_like_poscar(text: str) -> bool:
    """Whether the text has the shape of a POSCAR: a scale, then three lattice vectors."""
    lines = text.strip().splitlines()
    if len(lines) < 7:
        return False
    # the scale may be one number or three (one per axis); a lattice vector is always three, and
    # insisting on that keeps an xyz written with atomic numbers from looking like a crystal
    if not _floats(lines[1], 1):
        return False
    return all(_floats(lines[i], 3, exactly=True) for i in (2, 3, 4))


def _counts_line(lines: list[str]) -> list[int] | None:
    """The counts of line 6 when it is a counts line (VASP 4), or None when it names species."""
    parts = lines[5].split()
    if not parts:
        return None
    try:
        counts = [int(p) for p in parts]
    except ValueError:
        return None
    return counts if all(c > 0 for c in counts) else None


def poscar_species(text: str) -> tuple[list[int], list[str] | None] | None:
    """
    For a VASP 4 POSCAR: its counts, and the species the *comment line* names if it names them.
    None when the text already carries a species line (VASP 5), which needs no help.
    """
    lines = text.strip().splitlines()
    if len(lines) < 7:
        return None
    counts = _counts_line(lines)
    if counts is None:
        return None
    named = lines[0].split()
    if len(named) == len(counts) and all(s in _SYMBOLS for s in named):
        return counts, named
    return counts, None


def with_species(text: str, species: list[str]) -> str:
    """The same POSCAR with a species line above its counts, which is the VASP 5 form."""
    lines = text.strip().splitlines()
    return "\n".join([*lines[:5], " ".join(species), *lines[5:]]) + "\n"


def as_vasp5(text: str, species: list[str] | None = None) -> str:
    """
    A POSCAR ASE can read from a buffer: unchanged when it already names its species, and
    otherwise with a species line inserted. Raises `MissingSpeciesError` when nobody knows them.
    """
    found = poscar_species(text)
    if found is None:
        return text
    counts, from_comment = found
    chosen = species if species is not None else from_comment
    if chosen is None:
        raise MissingSpeciesError(counts)
    if len(chosen) != len(counts):
        msg = f"this POSCAR has {len(counts)} species, but {len(chosen)} elements were given"
        raise ValueError(msg)
    unknown = [s for s in chosen if s not in _SYMBOLS]
    if unknown:
        msg = f"not an element symbol: {', '.join(unknown)}"
        raise ValueError(msg)
    return with_species(text, list(chosen))
