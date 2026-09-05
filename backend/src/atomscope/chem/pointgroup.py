"""Molecular point-group detection and symmetrization (Avogadro's Symmetry properties).

Space groups of periodic systems come from spglib (:mod:`atomscope.crystal.symmetry`); a finite
molecule needs a different treatment, implemented here directly:

1. move to the centre of mass and classify the inertia tensor (linear / spherical / symmetric /
   asymmetric top), which bounds what can be present;
2. generate candidate axes and mirror normals from the geometry itself -- every symmetry axis of
   a molecule passes through an atom, through the midpoint of two like atoms, or along the normal
   of the plane of two like atoms -- and keep those that map the atom set onto itself within the
   tolerance;
3. read the point group off the standard flow chart (highest proper axis, perpendicular C2 axes,
   horizontal/vertical mirrors, inversion, improper axes);
4. close the found operations into a group, which gives both the group order and the projector
   used to symmetrize coordinates.

Tolerances are distances in Angstrom, matching Avogadro's Loose/Normal/Tight choice.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

import numpy as np
from ase.data import atomic_masses, atomic_numbers

from atomscope.model import Atom, Structure

Tolerance = Literal["loose", "normal", "tight"]
TOLERANCES: dict[Tolerance, float] = {"loose": 0.3, "normal": 0.1, "tight": 0.02}

MAX_ORDER = 8  # highest proper rotation searched for; C60 needs 5, benzene 6
NEIGHBOURS = 5  # like neighbours per atom whose planes provide face-normal axis candidates
PROBE_MIN = 12  # atoms that must take part in generating axis candidates (see _probe_set)
MAX_ATOMS = 250  # measured: 1.4 s at 53 atoms, 1.8 s at 103, 6.3 s at 203 (quadratic in both
#                the candidate count and the cost of testing one)
MAX_GROUP = 200  # |Ih| = 120; anything larger means the closure is not converging


@dataclass(frozen=True)
class PointGroup:
    """Detected point group: Schoenflies symbol, group order and the operations found."""

    symbol: str
    order: int
    operations: list[str]
    principal_axis: tuple[float, float, float] | None
    tolerance: float


def _weights(structure: Structure) -> np.ndarray:
    return np.array([atomic_masses[atomic_numbers[a.element]] for a in structure.atoms])


def _centred(structure: Structure) -> np.ndarray:
    positions = structure.positions()
    masses = _weights(structure)
    return np.asarray(positions - (masses[:, None] * positions).sum(axis=0) / masses.sum())


def _classes(structure: Structure) -> np.ndarray:
    """Integer label per atom; only atoms of the same element may be interchanged."""
    return np.array([atomic_numbers[a.element] for a in structure.atoms])


def _normalize(v: np.ndarray) -> np.ndarray | None:
    n = float(np.linalg.norm(v))
    if n < 1e-6:
        return None
    v = v / n
    # fix the sign so that an axis and its reverse are the same candidate
    for component in v:
        if abs(component) > 1e-9:
            return v if component > 0 else -v
    return None


def _unique_axes(candidates: list[np.ndarray]) -> list[np.ndarray]:
    """Drop repeated directions. Sign-fixed unit vectors are bucketed on a fine grid rather than
    compared pairwise, which matters for a fullerene where the raw candidate list has thousands of
    entries; a near-duplicate that survives only costs one more symmetry test."""
    kept: dict[tuple[float, float, float], np.ndarray] = {}
    for c in candidates:
        key = (round(float(c[0]), 3), round(float(c[1]), 3), round(float(c[2]), 3))
        kept.setdefault(key, c)
    return list(kept.values())


def _candidate_axes(positions: np.ndarray, classes: np.ndarray) -> list[np.ndarray]:
    """Axes worth testing.

    A symmetry axis of a molecule either passes through an atom, through the midpoint of two like
    atoms, or along the normal of a plane spanned by like atoms -- the last case is what carries
    the C3 axes of an octahedron and the C5 axes of a fullerene, which no pair of atoms points
    along. Planes are taken from each atom and its nearest like neighbours, which keeps the
    generation linear in the atom count instead of cubic.
    """
    axes: list[np.ndarray] = [np.eye(3)[i] for i in range(3)]
    for i in range(len(positions)):
        candidate = _normalize(positions[i])
        if candidate is not None:
            axes.append(candidate)
    probe = _probe_set(positions, classes)
    for a in range(len(probe)):
        for b in range(a + 1, len(probe)):
            i, j = probe[a], probe[b]
            for v in (positions[i] + positions[j], positions[i] - positions[j]):
                candidate = _normalize(v)
                if candidate is not None:
                    axes.append(candidate)
            candidate = _normalize(np.cross(positions[i], positions[j]))
            if candidate is not None:
                axes.append(candidate)
    axes.extend(_plane_normals(positions, probe))
    return _unique_axes(axes)


def _probe_set(positions: np.ndarray, classes: np.ndarray) -> np.ndarray:
    """Indices of the atoms used to generate pair and plane candidates.

    Every symmetry operation permutes the atoms of one element among themselves, so the axes of
    the molecule are already determined by the smallest elements -- pairing up all 200 atoms of a
    peptide to rediscover that it is C1 is what made detection quadratic in a way that hurt.
    Elements are added smallest first until the set is large enough not to be degenerate (three
    collinear carbons would hide the C2 axes of allene, which run through its hydrogens), so a
    small molecule ends up contributing all of its atoms anyway.
    """
    del positions
    groups: dict[int, list[int]] = {}
    for i, element in enumerate(classes):
        groups.setdefault(int(element), []).append(i)
    probe: list[int] = []
    for group in sorted(groups.values(), key=len):
        if len(probe) >= PROBE_MIN:
            break
        probe.extend(group)
    return np.array(sorted(probe))


def _plane_normals(positions: np.ndarray, probe: np.ndarray) -> list[np.ndarray]:
    """Normals of the planes through each probe atom and pairs of its nearest probe neighbours."""
    normals: list[np.ndarray] = []
    distances = np.linalg.norm(positions[:, None, :] - positions[None, :, :], axis=2)
    for i in probe:
        like = probe[probe != i]
        if len(like) < 2:
            continue
        nearest = like[np.argsort(distances[i, like])[:NEIGHBOURS]]
        for a in range(len(nearest)):
            for b in range(a + 1, len(nearest)):
                normal = _normalize(
                    np.cross(
                        positions[nearest[a]] - positions[i], positions[nearest[b]] - positions[i]
                    )
                )
                if normal is not None:
                    normals.append(normal)
    return normals


def _rotation(axis: np.ndarray, angle: float) -> np.ndarray:
    x, y, z = axis
    k = np.array([[0.0, -z, y], [z, 0.0, -x], [-y, x, 0.0]])
    return np.asarray(np.eye(3) + np.sin(angle) * k + (1 - np.cos(angle)) * (k @ k))


def _reflection(normal: np.ndarray) -> np.ndarray:
    return np.eye(3) - 2.0 * np.outer(normal, normal)


def _maps_onto_itself(
    matrix: np.ndarray, positions: np.ndarray, classes: np.ndarray, tolerance: float
) -> np.ndarray | None:
    """Permutation induced by ``matrix``, or None when it is not a symmetry operation."""
    transformed = positions @ matrix.T
    distances = np.linalg.norm(transformed[:, None, :] - positions[None, :, :], axis=2)
    distances[classes[:, None] != classes[None, :]] = np.inf
    partner = distances.argmin(axis=1)
    if distances[np.arange(len(positions)), partner].max() > tolerance:
        return None
    if len(set(partner.tolist())) != len(positions):  # must be a bijection
        return None
    return np.asarray(partner)


def _is_symmetry(
    matrix: np.ndarray, positions: np.ndarray, classes: np.ndarray, tolerance: float
) -> bool:
    return _maps_onto_itself(matrix, positions, classes, tolerance) is not None


def _proper_axes(
    positions: np.ndarray, classes: np.ndarray, tolerance: float
) -> list[tuple[int, np.ndarray]]:
    """(order, axis) of every proper rotation axis, highest order per axis only."""
    found: list[tuple[int, np.ndarray]] = []
    for axis in _candidate_axes(positions, classes):
        best = 1
        for n in range(2, MAX_ORDER + 1):
            if _is_symmetry(_rotation(axis, 2 * np.pi / n), positions, classes, tolerance):
                best = n
        if best > 1:
            found.append((best, axis))
    return found


def _mirrors(positions: np.ndarray, classes: np.ndarray, tolerance: float) -> list[np.ndarray]:
    normals: list[np.ndarray] = []
    for normal in _candidate_axes(positions, classes):
        if _is_symmetry(_reflection(normal), positions, classes, tolerance):
            normals.append(normal)
    return normals


def _improper_order(
    axis: np.ndarray, positions: np.ndarray, classes: np.ndarray, tolerance: float, n: int
) -> bool:
    matrix = _reflection(axis) @ _rotation(axis, 2 * np.pi / n)
    return _is_symmetry(matrix, positions, classes, tolerance)


def _is_linear(positions: np.ndarray, tolerance: float) -> bool:
    if len(positions) < 3:
        return True
    direction = None
    for p in positions:
        direction = _normalize(p)
        if direction is not None:
            break
    if direction is None:
        return True
    return bool(
        np.linalg.norm(positions - np.outer(positions @ direction, direction), axis=1).max()
        < tolerance
    )


def _close_group(generators: list[np.ndarray]) -> list[np.ndarray]:
    """Multiplicative closure of the generators, as a list of distinct 3x3 matrices.

    Every element is built as (element already in the group) x (generator), so the longest product
    chain is the group order and rounding never accumulates -- multiplying arbitrary pairs would
    let the drift of near-orthogonal matrices compound without bound.
    """
    group: list[np.ndarray] = [np.eye(3)]

    def known(m: np.ndarray) -> bool:
        return any(np.abs(g - m).max() < 1e-3 for g in group)

    frontier: list[np.ndarray] = [np.asarray(g, dtype=float) for g in generators]
    while frontier and len(group) < MAX_GROUP:
        current = frontier.pop()
        if known(current):
            continue
        group.append(current)
        for generator in generators:
            product = current @ generator
            if not known(product):
                frontier.append(product)
    return group


def detect(structure: Structure, tolerance: Tolerance | float = "normal") -> PointGroup:
    """Detect the Schoenflies point group of a molecule."""
    if structure.n_atoms == 0:
        msg = "cannot determine the point group of an empty structure"
        raise ValueError(msg)
    if structure.n_atoms > MAX_ATOMS:
        msg = f"point-group detection is limited to {MAX_ATOMS} atoms"
        raise ValueError(msg)
    tol = TOLERANCES[tolerance] if isinstance(tolerance, str) else float(tolerance)
    positions = _centred(structure)
    classes = _classes(structure)

    if structure.n_atoms == 1:
        return PointGroup("R3", 0, ["E"], None, tol)

    inversion = _is_symmetry(-np.eye(3), positions, classes, tol)
    if _is_linear(positions, tol):
        symbol = "D*h" if inversion else "C*v"
        return PointGroup(
            symbol, 0, ["E", "C*"] + (["i", "sigma_h"] if inversion else []), None, tol
        )

    axes = _proper_axes(positions, classes, tol)
    mirrors = _mirrors(positions, classes, tol)
    generators = [_rotation(a, 2 * np.pi / n) for n, a in axes]
    generators += [_reflection(m) for m in mirrors]
    if inversion:
        generators.append(-np.eye(3))

    operations = sorted({f"C{n}" for n, _ in axes})
    if mirrors:
        operations.append(f"{len(mirrors)} sigma")
    if inversion:
        operations.append("i")
    operations.insert(0, "E")

    symbol, principal = _classify(positions, classes, tol, axes, mirrors, inversion=inversion)
    axis_tuple = (
        (float(principal[0]), float(principal[1]), float(principal[2]))
        if principal is not None
        else None
    )
    return PointGroup(symbol, group_order(symbol), operations, axis_tuple, tol)


CUBIC_ORDERS = {"T": 12, "Td": 24, "Th": 24, "O": 24, "Oh": 48, "I": 60, "Ih": 120}


def group_order(symbol: str) -> int:  # noqa: PLR0911 - one branch per family of the symbol
    """|G| for a Schoenflies symbol; 0 for the infinite groups of a linear molecule or an atom.

    The order follows from the symbol, and taking it from there rather than from the closure of
    the operations that happened to be found keeps it exact: at a loose tolerance a distorted
    molecule yields near-duplicate mirrors whose products never close into a finite group.
    """
    if symbol in ("R3", "C*v", "D*h"):
        return 0
    if symbol in CUBIC_ORDERS:
        return CUBIC_ORDERS[symbol]
    if symbol in ("C1",):
        return 1
    if symbol in ("Cs", "Ci"):
        return 2
    match = re.fullmatch(r"([CDS])(\d+)([vhd]?)", symbol)
    if match is None:  # unreachable for symbols this module produces
        msg = f"unknown point group symbol {symbol!r}"
        raise ValueError(msg)
    family, n_text, suffix = match.groups()
    n = int(n_text)
    if family == "S":
        return n
    if family == "C":
        return n * (2 if suffix else 1)
    return 2 * n * (2 if suffix else 1)


def _classify(  # noqa: PLR0911 - the Schoenflies flow chart is a chain of decisions
    positions: np.ndarray,
    classes: np.ndarray,
    tol: float,
    axes: list[tuple[int, np.ndarray]],
    mirrors: list[np.ndarray],
    *,
    inversion: bool,
) -> tuple[str, np.ndarray | None]:
    """The Schoenflies flow chart, given the elements that were found."""
    if not axes:
        if mirrors:
            return "Cs", None
        return ("Ci" if inversion else "C1"), None

    c3_axes = [a for n, a in axes if n % 3 == 0]
    if len(c3_axes) >= 4:  # cubic family: T, O or I
        if any(n % 5 == 0 for n, _ in axes):
            return ("Ih" if inversion else "I"), None
        if any(n % 4 == 0 for n, _ in axes):
            return ("Oh" if inversion else "O"), None
        if inversion:
            return "Th", None
        return ("Td" if mirrors else "T"), None

    top_order = max(n for n, _ in axes)
    # Several axes can share the highest order -- D2 and D2d have three mutually perpendicular C2
    # axes, only one of which carries the S4 or the mirrors. Classifying each of them and keeping
    # the richest group makes the answer independent of the order the candidates were generated
    # in, and so of how the molecule happens to be oriented.
    best: tuple[str, np.ndarray] | None = None
    for principal in (a for n, a in axes if n == top_order):
        symbol = _axial_symbol(positions, classes, tol, axes, mirrors, principal, top_order)
        if best is None or group_order(symbol) > group_order(best[0]):
            best = (symbol, principal)
    assert best is not None  # noqa: S101 - axes is non-empty here
    return best


def _axial_symbol(  # noqa: PLR0911, PLR0917 - the flow chart is a chain of decisions
    positions: np.ndarray,
    classes: np.ndarray,
    tol: float,
    axes: list[tuple[int, np.ndarray]],
    mirrors: list[np.ndarray],
    principal: np.ndarray,
    top_order: int,
) -> str:
    """The C/D branch of the flow chart for one choice of principal axis."""
    perpendicular_c2 = sum(
        1 for n, b in axes if n % 2 == 0 and abs(float(np.dot(principal, b))) < 1e-3
    )
    horizontal = any(abs(abs(float(np.dot(principal, m))) - 1.0) < 1e-3 for m in mirrors)
    vertical = sum(1 for m in mirrors if abs(float(np.dot(principal, m))) < 1e-3)

    if perpendicular_c2 >= top_order:
        if horizontal:
            return f"D{top_order}h"
        if vertical >= top_order:
            return f"D{top_order}d"
        return f"D{top_order}"
    if horizontal:
        return f"C{top_order}h"
    if vertical >= top_order:
        return f"C{top_order}v"
    if _improper_order(principal, positions, classes, tol, 2 * top_order):
        return f"S{2 * top_order}"
    return f"C{top_order}"


def symmetrize(structure: Structure, tolerance: Tolerance | float = "normal") -> Structure:
    """Idealize the geometry by averaging each atom over its orbit under the detected group.

    ``r_i -> (1/|G|) sum_R R^-1 r_{R(i)}`` is the projector onto the totally symmetric part of the
    coordinates, so the result is exactly invariant under every operation that was found.
    """
    tol = TOLERANCES[tolerance] if isinstance(tolerance, str) else float(tolerance)
    positions = _centred(structure)
    classes = _classes(structure)
    # the group acts about the centre of mass; put the molecule back where it was afterwards
    centre = structure.positions() - positions

    # The detected axes are only as accurate as the distorted geometry they were found in, so the
    # first average is not exactly invariant; repeating on the improved geometry converges fast.
    for _ in range(4):
        averaged = _project(positions, classes, tol)
        if averaged is None:
            break
        shift = float(np.abs(averaged - positions).max())
        positions = averaged
        if shift < 1e-9:
            break

    atoms = [
        Atom(**{**a.model_dump(), "position": (float(p[0]), float(p[1]), float(p[2]))})
        for a, p in zip(structure.atoms, positions + centre, strict=True)
    ]
    return structure.model_copy(update={"atoms": atoms})


def _project(positions: np.ndarray, classes: np.ndarray, tol: float) -> np.ndarray | None:
    """Average the coordinates over the group found in ``positions`` (None when there is none)."""
    axes = _proper_axes(positions, classes, tol)
    generators = [_rotation(a, 2 * np.pi / n) for n, a in axes]
    generators += [_reflection(m) for m in _mirrors(positions, classes, tol)]
    if _is_symmetry(-np.eye(3), positions, classes, tol):
        generators.append(-np.eye(3))
    if not generators:
        return None

    averaged = np.zeros_like(positions)
    used = 0
    for matrix in _close_group(generators):
        permutation = _maps_onto_itself(matrix, positions, classes, tol)
        if permutation is None:  # a product that drifted outside the tolerance
            continue
        averaged += positions[permutation] @ matrix  # R^-1 = R^T for orthogonal R
        used += 1
    return averaged / max(1, used)
