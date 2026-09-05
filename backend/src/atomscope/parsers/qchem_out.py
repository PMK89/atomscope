"""Q-Chem output: vibrational analysis and NMR shielding tensors.

Avogadro 1's spectra test files are Q-Chem outputs (``methane.out`` for IR, ``ch3oh-nmr.qcout``
for NMR), so this parser exists next to the Gaussian and ORCA ones. Quoted from
``backend/tests/fixtures/spectra/methane_qchem.out``::

     Mode:                 1                      2                      3
     Frequency:      1575.73                1581.40                1584.19
     Force Cnst:      1.7356                 1.7455                 1.7511
     Red. Mass:       1.1864                 1.1846                 1.1843
     IR Active:          YES                    YES                    YES
     IR Intens:       13.763                 12.309                 12.408
     Raman Active:       YES                    YES                    YES
                   X      Y      Z        X      Y      Z        X      Y      Z
     C         -0.012  0.000 -0.127    0.000 -0.127  0.000   -0.126  0.000  0.012
     TransDip   0.012  0.000  0.118    0.000  0.112  0.000    0.112  0.000 -0.009

Q-Chem prints only the ``3N-6`` vibrations, so the trivial modes never appear. The ``TransDip``
row is the transition dipole and is skipped; ``IR Intens`` is in km/mol.

and from ``backend/tests/fixtures/spectra/ch3oh_nmr.qcout``::

           ATOM           ISOTROPIC        ANISOTROPIC       REL. SHIFTS
    ------------------------------------------------------------------------
       Atom C     1     139.54974364       74.34978117

Shieldings are absolute (ppm); converting them to chemical shifts needs a reference shielding
from an equivalent calculation, which the caller supplies (see
:func:`atomscope.analysis.spectra.nmr_spectrum`).

Q-Chem's ``CIS/TDDFT Excitation Energies`` block is **not** parsed: no fixture in the Avogadro 1
corpus contains one.
"""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np

from atomscope.model import NmrShielding
from atomscope.model.common import Vec3
from atomscope.parsers.spectra_common import (
    ParsedSpectra,
    SpectraParseError,
    normalized_modes,
    vibrational_spectrum,
)

GEOMETRY = "Standard Nuclear Orientation (Angstroms)"
LABELLED = re.compile(r"^\s*(Mode|Frequency|Force Cnst|Red\. Mass|IR Intens|Raman Intens):\s+(.*)$")
DISPLACEMENT = re.compile(r"^\s*([A-Za-z]+)((\s+-?\d+\.\d+)+)\s*$")
# the transition-dipole row sits in the middle of the displacement table and is not an atom
SKIP_ROWS = frozenset({"TransDip"})
SHIELDING = re.compile(r"^\s*Atom\s+([A-Z][a-z]?)\s+(\d+)\s+(-?\d+\.\d+)(?:\s+(-?\d+\.\d+))?\s*$")


def _geometry(lines: list[str]) -> tuple[list[str], list[Vec3]]:
    start = -1
    for i, line in enumerate(lines):
        if GEOMETRY in line:
            start = i
    if start < 0:
        return [], []
    symbols: list[str] = []
    positions: list[Vec3] = []
    for line in lines[start + 3 :]:
        parts = line.split()
        if len(parts) != 5 or not parts[0].isdigit():
            break
        symbols.append(parts[1])
        positions.append((float(parts[2]), float(parts[3]), float(parts[4])))
    return symbols, positions


def _vibrations(lines: list[str]) -> tuple[list[float], np.ndarray, list[float | None]]:
    frequencies: list[float] = []
    intensities: list[float | None] = []
    vectors: list[list[Vec3]] = []
    block_size = 0
    block_rows: list[list[float]] = []

    def flush() -> None:
        if not block_size:
            return
        for k in range(block_size):
            vectors.append([(r[3 * k], r[3 * k + 1], r[3 * k + 2]) for r in block_rows])
        block_rows.clear()

    for line in lines:
        m = LABELLED.match(line)
        if m:
            key, values = m.group(1), m.group(2).split()
            if key == "Mode":
                flush()
                block_size = len(values)
            elif key == "Frequency":
                frequencies.extend(float(v) for v in values)
            elif key == "IR Intens":
                intensities.extend(float(v) for v in values)
            continue
        d = DISPLACEMENT.match(line)
        if d and block_size and d.group(1) not in SKIP_ROWS:
            row = [float(v) for v in d.group(2).split()]
            if len(row) == 3 * block_size:
                block_rows.append(row)
    flush()
    if not frequencies:
        msg = "no 'Frequency:' block found; is this a Q-Chem freq job?"
        raise SpectraParseError(msg)
    n_atoms = min(len(v) for v in vectors)
    array = np.array([v[:n_atoms] for v in vectors], dtype=float)
    if not intensities:
        return frequencies, array, [None] * len(frequencies)
    return frequencies, array, intensities


def _shieldings(lines: list[str], symbols: list[str]) -> list[NmrShielding]:
    """The 'Summary' table of the NMR section; the per-atom tensor blocks are skipped."""
    try:
        start = next(i for i, line in enumerate(lines) if line.strip() == "Summary")
    except StopIteration:
        return []
    out: list[NmrShielding] = []
    for line in lines[start:]:
        m = SHIELDING.match(line)
        if m:
            index = int(m.group(2)) - 1
            element = symbols[index] if index < len(symbols) else m.group(1)
            out.append(
                NmrShielding(
                    index=index,
                    element=element,
                    isotropic=float(m.group(3)),
                    anisotropic=None if m.group(4) is None else float(m.group(4)),
                )
            )
        elif out and line.strip().startswith("---"):
            break
    return out


def parse_qchem_output(text: str, *, source: str = "q-chem output") -> ParsedSpectra:
    """Read geometry, vibrations and/or NMR shieldings from a Q-Chem output file."""
    lines = text.splitlines()
    symbols, positions = _geometry(lines)
    shieldings = _shieldings(lines, symbols)
    vibrations = None
    if any(line.lstrip().startswith("Frequency:") for line in lines):
        frequencies, vectors, intensities = _vibrations(lines)
        modes = normalized_modes(frequencies, vectors, ir=intensities)
        vibrations = vibrational_spectrum(modes, symbols, positions, "Q-Chem", source=source)
    if vibrations is None and not shieldings:
        msg = "no vibrational or NMR block found in this Q-Chem output"
        raise SpectraParseError(msg)
    return ParsedSpectra(
        program="qchem",
        symbols=symbols,
        positions=positions,
        vibrations=vibrations,
        shieldings=shieldings,
    )


def read_qchem_output(path: Path) -> ParsedSpectra:
    return parse_qchem_output(path.read_text(errors="replace"), source=str(path))


__all__ = ["parse_qchem_output", "read_qchem_output"]
