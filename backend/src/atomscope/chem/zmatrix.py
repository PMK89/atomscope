"""Cartesian geometry as a Z-matrix (internal coordinates).

Which atoms each row is measured against is Open Babel's choice: its ``gzmat`` writer is where
Avogadro 1's Z-matrix output came from (``gaussianinputdialog.cpp:606`` says so), and picking
references well is the whole difficulty -- a reference that is nearly collinear with the two
before it makes a torsion that swings wildly for a small movement. The distances, angles and
torsions themselves are computed here from the Cartesian coordinates rather than read back out
of Open Babel's text, which prints them to four decimals.

Angles and torsions are in degrees, and a negative torsion is written as its positive equivalent
(Avogadro did the same), which is what quantum-chemistry decks expect.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from openbabel import openbabel as ob

from atomscope.chem.obmol import OB_LOCK, to_obmol
from atomscope.model import Structure


@dataclass(frozen=True)
class ZMatrixRow:
    """One line of a Z-matrix. The first atom has no references, the second only `a`, and so on."""

    element: str
    a: int | None = None
    b: int | None = None
    c: int | None = None
    distance: float | None = None
    angle: float | None = None
    torsion: float | None = None


def _references(structure: Structure) -> list[tuple[int | None, int | None, int | None]]:
    """The reference atoms Open Babel's Z-matrix writer picks, as 0-based indices."""
    with OB_LOCK:
        mol = to_obmol(structure)
        conversion = ob.OBConversion()
        if not conversion.SetOutFormat("gzmat"):
            msg = "this Open Babel build has no gzmat writer"
            raise RuntimeError(msg)
        text = str(conversion.WriteString(mol))
    lines = text.splitlines()
    end = next((i for i, line in enumerate(lines) if line.strip() == "Variables:"), None)
    if end is None:  # one atom, or two: Open Babel writes no variables section
        end = len(lines)
        while end > 0 and not lines[end - 1].strip():
            end -= 1
    rows = lines[end - structure.n_atoms : end]
    out: list[tuple[int | None, int | None, int | None]] = []
    for i, row in enumerate(rows):
        parts = row.split()
        # "H  2  r7  1  a7  3  d7": the symbol, then a reference and a variable name per column
        indices = [int(parts[k]) - 1 for k in (1, 3, 5) if len(parts) > k]
        if len(indices) != min(i, 3):
            msg = f"Open Babel's Z-matrix line {i + 1} does not name {min(i, 3)} atoms: {row!r}"
            raise ValueError(msg)
        while len(indices) < 3:
            indices.append(-1)
        out.append(tuple(None if k < 0 else k for k in indices))  # type: ignore[arg-type]
    return out


def _angle(u: np.ndarray, v: np.ndarray) -> float:
    cosine = float(np.dot(u, v) / (np.linalg.norm(u) * np.linalg.norm(v)))
    return float(np.degrees(np.arccos(np.clip(cosine, -1.0, 1.0))))


def _torsion(p0: np.ndarray, p1: np.ndarray, p2: np.ndarray, p3: np.ndarray) -> float:
    """The dihedral p0-p1-p2-p3 in degrees, 0 to 360, in the sense a Z-matrix is read back in."""
    b0, b1, b2 = p0 - p1, p2 - p1, p3 - p2
    axis = b1 / np.linalg.norm(b1)
    v = b0 - np.dot(b0, axis) * axis
    w = b2 - np.dot(b2, axis) * axis
    angle = float(np.degrees(np.arctan2(float(np.dot(np.cross(axis, v), w)), float(np.dot(v, w)))))
    return angle + 360.0 if angle < 0.0 else angle


def zmatrix(structure: Structure) -> list[ZMatrixRow]:
    """The structure as a Z-matrix, one row per atom in the order the atoms are stored."""
    positions = np.array([a.position for a in structure.atoms], dtype=float)
    rows: list[ZMatrixRow] = []
    for i, (references, atom) in enumerate(
        zip(_references(structure), structure.atoms, strict=True)
    ):
        a, b, c = references
        row = ZMatrixRow(element=atom.element, a=a, b=b, c=c)
        if a is not None:
            row = ZMatrixRow(
                element=atom.element,
                a=a,
                b=b,
                c=c,
                distance=float(np.linalg.norm(positions[i] - positions[a])),
                angle=(
                    None
                    if b is None
                    else _angle(positions[i] - positions[a], positions[b] - positions[a])
                ),
                torsion=(
                    None
                    if c is None or b is None
                    else _torsion(positions[i], positions[a], positions[b], positions[c])
                ),
            )
        rows.append(row)
    return rows
