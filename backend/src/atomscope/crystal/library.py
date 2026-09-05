"""Bundled crystal library (CIF files inherited from Avogadro 1, see data/crystals/README.md)."""

from __future__ import annotations

import re
import warnings
from functools import cache
from pathlib import Path

import ase.io

from atomscope.io import read_structure
from atomscope.model import Structure
from atomscope.model.common import StrictModel

LIBRARY_DIR = Path(__file__).resolve().parent.parent / "data" / "crystals"

_FORMULA_TAG = re.compile(r"^_chemical_formula_sum\s+'?([^'\n]*)'?", re.MULTILINE)


class LibraryEntry(StrictModel):
    category: str
    name: str
    formula: str
    readable: bool


def _formula_from_text(path: Path) -> str:
    m = _FORMULA_TAG.search(path.read_text(errors="replace"))
    return m.group(1).replace(" ", "") if m else ""


def _entry(path: Path) -> LibraryEntry:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            atoms = ase.io.read(str(path), format="cif")
        if isinstance(atoms, list):
            atoms = atoms[-1]
        formula = str(atoms.get_chemical_formula("metal", empirical=True))
        readable = True
    except Exception:  # noqa: BLE001 - malformed CIFs must not break the listing
        formula, readable = _formula_from_text(path), False
    return LibraryEntry(
        category=path.parent.name, name=path.stem, formula=formula, readable=readable
    )


@cache
def library_entries() -> tuple[LibraryEntry, ...]:
    """All CIF entries, sorted by category then name (computed once per process)."""
    files = sorted(LIBRARY_DIR.glob("*/*.cif"), key=lambda p: (p.parent.name, p.stem.lower()))
    return tuple(_entry(p) for p in files)


def library_path(category: str, name: str) -> Path:
    """Path of a library CIF; ``KeyError`` when no such entry exists."""
    if not any(e.category == category and e.name == name for e in library_entries()):
        msg = f"no library entry {category}/{name}"
        raise KeyError(msg)
    return LIBRARY_DIR / category / f"{name}.cif"


def load_entry(category: str, name: str) -> Structure:
    """Read one library entry as a Structure (bonds perceived)."""
    path = library_path(category, name)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        structure = read_structure(path, "cif")
    structure.name = name
    return structure
