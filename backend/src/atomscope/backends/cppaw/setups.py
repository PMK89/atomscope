"""External setup libraries: files holding ``!SPECIES ... !AUGMENT ... !END !END`` blocks.

The CP-PAW hands-on course distributes such a file (``setups.rslv``) and inlines the matching
blocks into ``.strc`` decks with ``paw_resolve``. Atomscope does the same in Python: the library
is keyed by the species ``NAME`` (element symbol padded with ``_``), and a generated structure
uses the library block for every element it contains, falling back to internal setup IDs.
"""

from __future__ import annotations

import copy
from pathlib import Path

from atomscope.backends.cppaw.deck import Block, parse_deck


class SetupsLibrary:
    def __init__(self, species: dict[str, Block], source: Path | None = None) -> None:
        self.species = species
        self.source = source

    @classmethod
    def from_text(cls, text: str, source: Path | None = None) -> SetupsLibrary:
        root = parse_deck(text)
        species: dict[str, Block] = {}
        for blk in root.children_named("SPECIES"):
            name = blk.get("NAME")
            if isinstance(name, str):
                species[name.upper()] = blk
        if not species:
            msg = f"no !SPECIES blocks found in {source or 'setups text'}"
            raise ValueError(msg)
        return cls(species, source)

    @classmethod
    def from_file(cls, path: Path) -> SetupsLibrary:
        return cls.from_text(path.read_text(encoding="utf-8", errors="replace"), path)

    def elements(self) -> list[str]:
        return sorted(name.rstrip("_").capitalize() for name in self.species)

    def block_for(self, species_name: str) -> Block | None:
        blk = self.species.get(species_name.upper())
        return copy.deepcopy(blk) if blk is not None else None
