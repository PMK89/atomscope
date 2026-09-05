"""Gaussian log files: harmonic frequencies, IR/Raman intensities and normal coordinates.

ASE's ``gaussian-out`` reader returns geometries and energies but no vibrational data, so this
module reads the ``Harmonic frequencies`` section itself. Two printed layouts exist:

**Standard** (default), three modes per block, displacements to two decimals::

                       1                      2                      3
                      ?A                     ?A                     ?A
   Frequencies --  1575.7247              1581.4013              1584.1918
   Red. masses --     1.1864                 1.1846                 1.1842
   Frc consts  --     1.7356                 1.7455                 1.7511
   IR Inten    --    13.7596                12.3060                12.4057
   Raman Activ --     3.4382                 3.9867                 4.0189
   Atom AN      X      Y      Z        X      Y      Z        X      Y      Z
     1   0     0.30   0.00   0.95     0.00   1.00   0.00     0.95   0.00  -0.30

(quoted from ``backend/tests/fixtures/spectra/methane.g03``). The second line holds the symmetry
labels; ``?A`` means Gaussian could not assign one.

**High precision** (``freq=hpmodes``), five modes per block, displacements to five decimals,
distinguished by three dashes after the keyword instead of two::

                       1         2         3         4         5
                       A1        A1        E         E         T2
   Frequencies ---  1000.0000 2000.0000 3000.0000 4000.0000 5000.0000
   Reduced masses ---  1.0000    1.0000    1.0000    1.0000    1.0000
   IR Intensities ---  1.0000    1.0000    1.0000    1.0000    1.0000
   Coord Atom Element:
     1     1     6    0.00000   0.00000   0.00000   0.00000   0.00000

Both are read; when a file contains both (Gaussian prints the high-precision block first) the
high-precision one wins. Ghost atoms (atomic number 0, "Bq") are dropped from the geometry and
from the displacement vectors, matching :func:`atomscope.io.qc_outputs.read_output`.

Electronic transitions (``Excited State``) and NMR shieldings are **not** read here: Gaussian's
TD-DFT and NMR sections are not covered by the Avogadro 1 test corpus this parser was written
against, and a parser without a golden fixture is worse than none.
"""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np
from ase.data import chemical_symbols

from atomscope.model.common import Vec3
from atomscope.parsers.spectra_common import (
    ParsedSpectra,
    SpectraParseError,
    normalized_modes,
    vibrational_spectrum,
)

ORIENTATION = re.compile(r"(Input|Standard) orientation:")
FREQ_STD = re.compile(r"^\s*Frequencies\s+--\s+(.*)$")
FREQ_HP = re.compile(r"^\s*Frequencies\s+---\s+(.*)$")
VALUE_STD = re.compile(r"^\s*(IR Inten|Raman Activ|Red\. masses|Frc consts)\s+--\s+(.*)$")
VALUE_HP = re.compile(r"^\s*(IR Intensities|Reduced masses|Force constants)\s+---\s+(.*)$")
ATOM_ROW = re.compile(r"^\s*\d+\s+\d+(\s+\d+)?((\s+-?\d+\.\d+)+)\s*$")


def _floats(text: str) -> list[float]:
    return [float(v) for v in text.split()]


def _geometry(lines: list[str]) -> tuple[list[str], list[Vec3]]:
    """Last Input/Standard orientation block; ghost atoms (Z = 0) are dropped."""
    start = -1
    for i, line in enumerate(lines):
        if ORIENTATION.search(line):
            start = i
    if start < 0:
        return [], []
    symbols: list[str] = []
    positions: list[Vec3] = []
    # skip the three-line header, then read until the closing dashed rule
    for line in lines[start + 5 :]:
        if line.strip().startswith("---"):
            break
        parts = line.split()
        if len(parts) < 6:
            break
        z = int(parts[1])
        if z <= 0:
            continue
        symbols.append(chemical_symbols[z])
        positions.append((float(parts[-3]), float(parts[-2]), float(parts[-1])))
    return symbols, positions


def _ghost_mask(lines: list[str]) -> list[bool]:
    """True for rows that are real atoms, in the order the displacement rows use."""
    start = -1
    for i, line in enumerate(lines):
        if ORIENTATION.search(line):
            start = i
    if start < 0:
        return []
    mask: list[bool] = []
    for line in lines[start + 5 :]:
        if line.strip().startswith("---"):
            break
        parts = line.split()
        if len(parts) < 6:
            break
        mask.append(int(parts[1]) > 0)
    return mask


class _Block:
    """One printed block of up to 3 (standard) or 5 (high precision) modes."""

    def __init__(self, symmetries: list[str]) -> None:
        self.symmetries = symmetries
        self.frequencies: list[float] = []
        self.values: dict[str, list[float]] = {}
        self.rows: list[list[float]] = []


def _parse_blocks(lines: list[str], high_precision: bool) -> list[_Block]:
    freq_re = FREQ_HP if high_precision else FREQ_STD
    value_re = VALUE_HP if high_precision else VALUE_STD
    blocks: list[_Block] = []
    current: _Block | None = None
    for i, line in enumerate(lines):
        m = freq_re.match(line)
        if m:
            current = _Block(lines[i - 1].split())
            current.frequencies = _floats(m.group(1))
            blocks.append(current)
            continue
        if current is None:
            continue
        v = value_re.match(line)
        if v:
            current.values[v.group(1)] = _floats(v.group(2))
            continue
        if ATOM_ROW.match(line):
            current.rows.append(_floats(line))
            continue
        if line.strip() and not line.lstrip().startswith(
            ("Atom AN", "Coord Atom", "Depolar", "Frequencies")
        ):
            current = None
    return blocks


def _standard_vectors(blocks: list[_Block], keep: list[bool]) -> tuple[np.ndarray, int]:
    """(n_modes, n_atoms, 3) from ``Atom AN X Y Z ...`` rows."""
    per_mode: list[list[Vec3]] = []
    for block in blocks:
        n = len(block.frequencies)
        rows = block.rows
        vectors: list[list[Vec3]] = [[] for _ in range(n)]
        for r, row in enumerate(rows):
            if keep and r < len(keep) and not keep[r]:
                continue
            values = row[2:]  # drop the atom index and atomic number
            for k in range(n):
                vectors[k].append((values[3 * k], values[3 * k + 1], values[3 * k + 2]))
        per_mode.extend(vectors)
    return np.array(per_mode, dtype=float), len(per_mode)


def _hp_vectors(blocks: list[_Block], keep: list[bool]) -> tuple[np.ndarray, int]:
    """(n_modes, n_atoms, 3) from ``Coord Atom Element:`` rows (coord-major)."""
    per_mode: list[np.ndarray] = []
    for block in blocks:
        n_modes = len(block.frequencies)
        n_atoms = max((int(row[1]) for row in block.rows), default=0)
        buf = np.zeros((n_modes, n_atoms, 3), dtype=float)
        for row in block.rows:
            coord = int(row[0]) - 1
            atom = int(row[1]) - 1
            for k in range(n_modes):
                buf[k, atom, coord] = row[3 + k]
        if keep:
            mask = np.array(keep[:n_atoms], dtype=bool)
            buf = buf[:, mask, :]
        per_mode.extend(list(buf))
    return np.array(per_mode, dtype=float), len(per_mode)


def _collect(blocks: list[_Block], key: str) -> list[float | None] | None:
    if not any(key in b.values for b in blocks):
        return None
    out: list[float | None] = []
    for b in blocks:
        values = b.values.get(key)
        for k in range(len(b.frequencies)):
            out.append(None if values is None else values[k])
    return out


def parse_gaussian_log(text: str, *, source: str = "gaussian log") -> ParsedSpectra:
    """Read geometry and harmonic frequencies from a Gaussian log file."""
    lines = text.splitlines()
    symbols, positions = _geometry(lines)
    keep = _ghost_mask(lines)
    high_precision = any(FREQ_HP.match(line) for line in lines)
    blocks = _parse_blocks(lines, high_precision)
    if not blocks:
        msg = "no 'Frequencies --' block found; is this a Gaussian freq= job?"
        raise SpectraParseError(msg)
    vectors, n_modes = (_hp_vectors if high_precision else _standard_vectors)(blocks, keep)
    frequencies = [f for b in blocks for f in b.frequencies]
    symmetries: list[str | None] = []
    for b in blocks:
        labels = b.symmetries if len(b.symmetries) == len(b.frequencies) else []
        for k in range(len(b.frequencies)):
            label = labels[k] if labels else None
            symmetries.append(None if label in (None, "?A") else label)
    ir_key = "IR Intensities" if high_precision else "IR Inten"
    modes = normalized_modes(
        frequencies[:n_modes],
        vectors,
        ir=_collect(blocks, ir_key),
        raman=_collect(blocks, "Raman Activ"),
        symmetries=symmetries[:n_modes],
    )
    method = "Gaussian (hpmodes)" if high_precision else "Gaussian"
    return ParsedSpectra(
        program="gaussian",
        symbols=symbols,
        positions=positions,
        vibrations=vibrational_spectrum(modes, symbols, positions, method, source=source),
    )


def read_gaussian_log(path: Path) -> ParsedSpectra:
    return parse_gaussian_log(path.read_text(errors="replace"), source=str(path))


__all__ = ["parse_gaussian_log", "read_gaussian_log"]
