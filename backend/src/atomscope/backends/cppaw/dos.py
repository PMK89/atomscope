"""Read the ``.dos`` files of ``paw_dos.x`` into a :class:`DosSpectrum`.

File format (``paw_dos.f90`` ``PUTONGRID_*``, format ``(F14.8,2F20.8)``): rows ``E[eV]
DOS[1/eV] DOS_occupied[1/eV]``. One block per spin channel; every block starts with a sentinel
row ``EMIN 0 0`` and ends with ``EMAX 0 0`` right after the real value at EMAX. Spin-down blocks
carry a negative sign. A single trailer line ``# THIS WAS: <legend>`` closes the file.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import numpy as np

from atomscope.backends.cppaw.deck import parse_deck
from atomscope.backends.cppaw.tools import dos_prefix
from atomscope.model.spectrum import DosSeries, DosSpectrum

_FERMI = re.compile(r"^FERMI LEVEL\.*:\s*([-+\d.Ee]+)\s*EV", re.MULTILINE)


@dataclass
class DosBlock:
    energies: list[float] = field(default_factory=list)
    dos: list[float] = field(default_factory=list)
    occupied: list[float] = field(default_factory=list)


def parse_dos_text(text: str) -> list[DosBlock]:
    """Split a ``.dos`` file into spin blocks (sentinel rows removed)."""
    rows: list[tuple[float, float, float]] = []
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        parts = s.split()
        if len(parts) != 3:
            msg = f"unexpected .dos row: {line!r}"
            raise ValueError(msg)
        rows.append((float(parts[0]), float(parts[1]), float(parts[2])))
    blocks: list[list[tuple[float, float, float]]] = []
    for i, row in enumerate(rows):
        if i == 0 or row[0] < rows[i - 1][0]:
            blocks.append([])
        blocks[-1].append(row)
    out: list[DosBlock] = []
    for raw in blocks:
        body = raw[1:-1] if len(raw) >= 2 else raw  # drop the EMIN/EMAX sentinels
        out.append(
            DosBlock(
                energies=[r[0] for r in body],
                dos=[r[1] for r in body],
                occupied=[r[2] for r in body],
            )
        )
    return out


def read_fermi_level(dprot: Path) -> float | None:
    if not dprot.is_file():
        return None
    m = _FERMI.search(dprot.read_text(errors="replace"))
    return float(m.group(1)) if m else None


def dcntl_weights(text: str) -> tuple[str, list[tuple[str, str]], float | None]:
    """(prefix, [(weight id, legend)], broadening eV) from a generated ``.dcntl``."""
    deck = parse_deck(text)
    d = deck.child("DCNTL")
    if d is None:
        msg = "no !DCNTL block"
        raise ValueError(msg)
    gen = d.child("GENERIC")
    prefix = str(gen.get("PREFIX", "")) if gen is not None else ""
    grid = d.child("GRID")
    broad = grid.get("BROADENING[EV]") if grid is not None else None
    weights = [
        (str(w.get("ID")), str(w.get("LEGEND", w.get("ID"))))
        for w in d.children_named("WEIGHT")
        if w.get("ID") is not None
    ]
    return prefix, weights, float(broad) if isinstance(broad, int | float) else None


def _scaled(block: DosBlock, factor: float) -> DosBlock:
    return DosBlock(
        energies=block.energies,
        dos=[v * factor for v in block.dos],
        occupied=[v * factor for v in block.occupied],
    )


def _is_empty(block: DosBlock) -> bool:
    """A spin block that carries no weight at all (spin-restricted second channel)."""
    return not any(abs(v) > 0.0 for v in block.dos)


def read_dos(
    work: Path,
    root: str,
    *,
    homo_energy: float | None = None,
    n_spins: int | None = None,
) -> DosSpectrum:
    """Assemble the spectrum of a finished ``paw_dos.x`` run in ``work``.

    ``paw_dos.x`` always writes two spin blocks, even for a spin-restricted calculation, where
    the second one is identically zero (the code expands its data model to two spin components;
    see docs/cppaw-analysis.md 4.7). Pass ``n_spins=1`` — or let the all-zero test detect it — so
    that a restricted run yields one series per weight instead of a phantom spin-down channel.

    Units: the returned DOS is states/eV *including* spin degeneracy, so integrating the occupied
    DOS over the energy grid gives the number of valence electrons. CP-PAW counts states per spin
    channel, so the retained channel of a restricted run is multiplied by two.
    """
    dcntl = work / f"{root}.dcntl"
    if not dcntl.is_file():
        msg = f"{dcntl.name} not found: no DOS has been requested"
        raise FileNotFoundError(msg)
    prefix, weights, broadening = dcntl_weights(dcntl.read_text(errors="replace"))
    prefix = prefix or dos_prefix(root)
    energies: np.ndarray | None = None
    series: list[DosSeries] = []
    for wid, legend in weights:
        path = work / f"{prefix}{wid}.dos"
        if not path.is_file():
            msg = f"{path.name} not found (paw_dos.x did not finish?)"
            raise FileNotFoundError(msg)
        blocks = parse_dos_text(path.read_text(errors="replace"))
        restricted = len(blocks) == 2 and (
            n_spins == 1 or (n_spins is None and _is_empty(blocks[1]))
        )
        if restricted:
            # keep the populated channel and restore the spin degeneracy (see the module docstring)
            blocks = [_scaled(blocks[0], 2.0)]
        for ispin, block in enumerate(blocks):
            e = np.asarray(block.energies)
            if energies is None:
                energies = e
            elif e.shape != energies.shape or not np.allclose(e, energies, atol=1e-6):
                msg = f"{path.name}: energy grid differs between DOS files"
                raise ValueError(msg)
            spin: Literal["up", "down", "none"] = (
                "none" if len(blocks) == 1 else ("up" if ispin == 0 else "down")
            )
            series.append(
                DosSeries(
                    id=wid, label=legend, spin=spin, dos=block.dos, occupied_dos=block.occupied
                )
            )
    return DosSpectrum(
        energies=[float(x) for x in energies] if energies is not None else [],
        series=series,
        fermi_level=read_fermi_level(work / f"{root}.dprot"),
        homo_energy=homo_energy,
        broadening=broadening,
    )


def integrate(energies: list[float], values: list[float]) -> float:
    """Trapezoidal integral (states) over the possibly gap-skipping energy grid."""
    return float(np.trapezoid(np.asarray(values), np.asarray(energies)))


__all__ = [
    "DosBlock",
    "dcntl_weights",
    "integrate",
    "parse_dos_text",
    "read_dos",
    "read_fermi_level",
]
