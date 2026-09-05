"""Internal coordinates from Cartesian positions.

The frontend measures the same quantities in ``model/geometry.ts``; these are for the places
where the backend has to know the current value of a constraint (the force-field bridge and the
ASE bridge, both of which need a target when the user did not type one).
"""

from __future__ import annotations

import numpy as np


def angle_deg(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """The a-b-c angle in degrees, ``b`` being the vertex."""
    u = np.asarray(a, dtype=float) - np.asarray(b, dtype=float)
    v = np.asarray(c, dtype=float) - np.asarray(b, dtype=float)
    n = float(np.linalg.norm(u) * np.linalg.norm(v))
    if n == 0.0:
        return 0.0
    return float(np.degrees(np.arccos(np.clip(float(np.dot(u, v)) / n, -1.0, 1.0))))


def dihedral_deg(a: np.ndarray, b: np.ndarray, c: np.ndarray, d: np.ndarray) -> float:
    """The a-b-c-d torsion in degrees, in (-180, 180] and signed by the IUPAC convention."""
    b0 = np.asarray(a, dtype=float) - np.asarray(b, dtype=float)
    b1 = np.asarray(c, dtype=float) - np.asarray(b, dtype=float)
    b2 = np.asarray(d, dtype=float) - np.asarray(c, dtype=float)
    n = float(np.linalg.norm(b1))
    if n == 0.0:
        return 0.0
    b1 = b1 / n
    # project the end bonds onto the plane perpendicular to the central bond
    v = b0 - np.dot(b0, b1) * b1
    w = b2 - np.dot(b2, b1) * b1
    x = float(np.dot(v, w))
    y = float(np.dot(np.cross(b1, v), w))
    return float(np.degrees(np.arctan2(y, x)))


__all__ = ["angle_deg", "dihedral_deg"]
