"""ORCA output: vibrational frequencies, normal modes and the IR spectrum table.

Three blocks are read, quoted here from ``backend/tests/fixtures/spectra/caffeine_orca.out``::

    -----------------------
    VIBRATIONAL FREQUENCIES
    -----------------------

       0:         0.00 cm**-1
       6:        25.60 cm**-1

    NORMAL MODES
    ------------
    These modes are the cartesian displacements weighted by the diagonal matrix
    M(i,i)=1/sqrt(m[i]) where m[i] is the mass of the displaced atom
                      0          1          2          3          4          5
          0       0.000000   0.000000   0.000000   0.000000   0.000000   0.000000

    IR SPECTRUM
    -----------
     Mode    freq (cm**-1)   T**2         TX         TY         TZ
       7:        71.13    0.038378  ( -0.000010   0.000030   0.195903)

``NORMAL MODES`` is the full 3N x 3N matrix printed in blocks of six columns: column ``k`` is
mode ``k``, row ``j`` is degree of freedom ``j`` (atom ``j // 3``, Cartesian component
``j % 3``). ORCA states that the 1/sqrt(m) weighting has already been applied, so the columns are
Cartesian displacements -- the same convention as :class:`atomscope.model.VibrationalMode`.

The IR table lists only the modes ORCA considers vibrations (index 6 or 5 upwards). ORCA 4 and
earlier print ``T**2`` in km/mol; ORCA 5 and later add an explicit ``Int`` column in km/mol,
which is used when the header contains it. Modes missing from the table get ``ir_intensity =
None`` rather than zero.

The geometry comes from the last ``CARTESIAN COORDINATES (ANGSTROEM)`` block. ORCA's TD-DFT
``ABSORPTION SPECTRUM`` and ``CD SPECTRUM`` tables are **not** parsed: no file in the Avogadro 1
test corpus contains them, so there is no golden fixture to check a parser against.
"""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np

from atomscope.model.common import Vec3
from atomscope.parsers.spectra_common import (
    ParsedSpectra,
    SpectraParseError,
    normalized_modes,
    vibrational_spectrum,
)

GEOMETRY = "CARTESIAN COORDINATES (ANGSTROEM)"
FREQ_LINE = re.compile(r"^\s*(\d+):\s+(-?\d+\.\d+)\s*cm\*\*-1")
IR_LINE = re.compile(r"^\s*(\d+):\s+(-?\d+\.\d+)\s+(.*)$")
COLUMN_HEADER = re.compile(r"^\s*(\d+\s+)+\d+\s*$")
MATRIX_ROW = re.compile(r"^\s*(\d+)((\s+-?\d+\.\d+)+)\s*$")


def _geometry(lines: list[str]) -> tuple[list[str], list[Vec3]]:
    start = -1
    for i, line in enumerate(lines):
        if GEOMETRY in line:
            start = i
    if start < 0:
        return [], []
    symbols: list[str] = []
    positions: list[Vec3] = []
    for line in lines[start + 2 :]:
        parts = line.split()
        if len(parts) != 4 or not parts[0].isalpha():
            break
        symbols.append(parts[0])
        positions.append((float(parts[1]), float(parts[2]), float(parts[3])))
    return symbols, positions


def _frequencies(lines: list[str]) -> list[float]:
    try:
        start = next(i for i, line in enumerate(lines) if line.strip() == "VIBRATIONAL FREQUENCIES")
    except StopIteration:
        msg = "no 'VIBRATIONAL FREQUENCIES' block found; is this an ORCA freq job?"
        raise SpectraParseError(msg) from None
    values: dict[int, float] = {}
    for line in lines[start:]:
        m = FREQ_LINE.match(line)
        if m:
            values[int(m.group(1))] = float(m.group(2))
        elif values and line.strip() and not line.startswith(("-", " " * 4)):
            break
    if not values:
        raise SpectraParseError("the 'VIBRATIONAL FREQUENCIES' block was empty")
    return [values[i] for i in sorted(values)]


def _normal_modes(lines: list[str], ndof: int) -> np.ndarray:
    """3N x 3N matrix of Cartesian displacements, columns = modes."""
    try:
        start = next(i for i, line in enumerate(lines) if line.strip() == "NORMAL MODES")
    except StopIteration:
        raise SpectraParseError("no 'NORMAL MODES' block found") from None
    matrix = np.zeros((ndof, ndof), dtype=float)
    columns: list[int] = []
    seen = 0
    for line in lines[start + 1 :]:
        if COLUMN_HEADER.match(line):
            columns = [int(v) for v in line.split()]
            continue
        m = MATRIX_ROW.match(line)
        if m and columns:
            row = int(m.group(1))
            values = [float(v) for v in m.group(2).split()]
            if row >= ndof:
                continue
            for k, value in zip(columns, values, strict=False):
                if k < ndof:
                    matrix[row, k] = value
            seen += 1
            continue
        if seen and line.strip() and not line.strip().startswith("-"):
            break
    return matrix


def _ir_table(lines: list[str]) -> dict[int, float]:
    try:
        start = next(i for i, line in enumerate(lines) if line.strip() == "IR SPECTRUM")
    except StopIteration:
        return {}
    header = ""
    for line in lines[start : start + 6]:
        if "Mode" in line and "freq" in line:
            header = line
            break
    # ORCA >= 5: Mode freq eps Int T**2 TX TY TZ -> the intensity is the third number
    column = 2 if " Int" in header else 0
    out: dict[int, float] = {}
    for line in lines[start:]:
        m = IR_LINE.match(line)
        if m:
            rest = m.group(3).split("(")[0].split()
            if len(rest) > column:
                out[int(m.group(1))] = float(rest[column])
        elif out and line.strip() and not line.strip().startswith("-"):
            break
    return out


def parse_orca_output(text: str, *, source: str = "orca output") -> ParsedSpectra:
    """Read geometry, normal modes and IR intensities from an ORCA output file."""
    lines = text.splitlines()
    symbols, positions = _geometry(lines)
    frequencies = _frequencies(lines)
    ndof = len(frequencies)
    if symbols and ndof != 3 * len(symbols):
        msg = f"{ndof} frequencies do not match {len(symbols)} atoms"
        raise SpectraParseError(msg)
    n_atoms = ndof // 3
    matrix = _normal_modes(lines, ndof)
    vectors = matrix.T.reshape(ndof, n_atoms, 3)
    ir_table = _ir_table(lines)
    ir: list[float | None] = [ir_table.get(k) for k in range(ndof)]
    modes = normalized_modes(frequencies, vectors, ir=ir)
    return ParsedSpectra(
        program="orca",
        symbols=symbols,
        positions=positions,
        vibrations=vibrational_spectrum(modes, symbols, positions, "ORCA", source=source),
    )


def read_orca_output(path: Path) -> ParsedSpectra:
    return parse_orca_output(path.read_text(errors="replace"), source=str(path))


__all__ = ["parse_orca_output", "read_orca_output"]
