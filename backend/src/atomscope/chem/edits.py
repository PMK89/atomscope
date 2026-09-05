"""Structure edits with chemistry rules: invert chirality, H -> methyl (Avogadro 1 Build menu)."""

from __future__ import annotations

import math

import numpy as np
from ase.data import atomic_numbers, covalent_radii

from atomscope.chem.hydrogens import neighbors
from atomscope.model import Atom, Bond, Structure
from atomscope.model.common import Vec3

C_H = 1.09
TETRAHEDRAL = math.radians(109.5)


def _v3(v: np.ndarray) -> Vec3:
    return (float(v[0]), float(v[1]), float(v[2]))


def _unit(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    return v / n if n > 1e-9 else np.array([1.0, 0.0, 0.0])


def _perpendicular(u: np.ndarray, hint: np.ndarray | None = None) -> np.ndarray:
    """Unit vector perpendicular to ``u``, as close to ``hint`` as possible."""
    if hint is not None:
        v = hint - np.dot(hint, u) * u
        if np.linalg.norm(v) > 1e-6:
            return _unit(v)
    trial = np.array([1.0, 0.0, 0.0]) if abs(u[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    return _unit(np.cross(u, trial))


def _substituent(nb: list[list[int]], center: int, start: int) -> set[int] | None:
    """Atoms reachable from ``start`` without passing through ``center``; None if the walk
    returns to another neighbour of ``center`` (ring)."""
    seen = {start}
    stack = [start]
    others = set(nb[center]) - {start}
    while stack:
        i = stack.pop()
        for j in nb[i]:
            if j == center:
                continue
            if j in others:
                return None
            if j not in seen:
                seen.add(j)
                stack.append(j)
    return seen


def invert_chirality(structure: Structure, indices: set[int] | None = None) -> Structure:
    """Mirror the whole structure (x -> -x) when nothing is selected, otherwise swap the two
    smallest acyclic substituents of each selected centre by reflecting them through the plane
    spanned by the remaining substituent directions (bisector plane for < 4 neighbours)."""
    pos = structure.positions()
    if not indices:
        pos[:, 0] *= -1
        return _with(structure, pos)
    nb = neighbors(structure)
    for c in sorted(indices):
        if c >= structure.n_atoms or len(nb[c]) < 2:
            continue
        groups = [(n, _substituent(nb, c, n)) for n in nb[c]]
        acyclic = sorted(
            [(n, g) for n, g in groups if g is not None], key=lambda t: (len(t[1]), t[0])
        )
        if len(acyclic) < 2:
            continue
        (n1, g1), (n2, g2) = acyclic[0], acyclic[1]
        u1 = _unit(pos[n1] - pos[c])
        u2 = _unit(pos[n2] - pos[c])
        rest = [n for n in nb[c] if n not in (n1, n2)]
        normal = None
        if len(rest) >= 2:
            normal = np.cross(_unit(pos[rest[0]] - pos[c]), _unit(pos[rest[1]] - pos[c]))
            if np.linalg.norm(normal) < 1e-3:
                normal = None
        if normal is None:
            normal = u1 - u2
        if np.linalg.norm(normal) < 1e-6:
            continue
        n = _unit(normal)
        for i in g1 | g2:
            d = pos[i] - pos[c]
            pos[i] = pos[c] + d - 2.0 * np.dot(d, n) * n
    return _with(structure, pos)


def _with(structure: Structure, pos: np.ndarray) -> Structure:
    atoms = [
        a.model_copy(update={"position": _v3(p)}) for a, p in zip(structure.atoms, pos, strict=True)
    ]
    return structure.model_copy(update={"atoms": atoms})


def h_to_methyl(structure: Structure, indices: set[int]) -> Structure:
    """Replace each selected hydrogen (bonded to exactly one atom) by a methyl group with
    tetrahedral geometry, staggered with respect to the parent's other substituents."""
    nb = neighbors(structure)
    pos = structure.positions()
    atoms = list(structure.atoms)
    bonds = list(structure.bonds)
    new_atoms: list[Atom] = []
    new_bonds: list[Bond] = []
    for h in sorted(indices):
        if h >= len(atoms) or atoms[h].element != "H" or len(nb[h]) != 1:
            continue
        x = nb[h][0]
        u = _unit(pos[h] - pos[x])
        r_cx = float(covalent_radii[atomic_numbers[atoms[x].element]] + covalent_radii[6])
        c_pos = pos[x] + r_cx * u
        atoms[h] = atoms[h].model_copy(update={"element": "C", "position": _v3(c_pos)})
        hint = None
        for other in nb[x]:
            if other != h:
                hint = pos[other] - pos[x]
                break
        v = _perpendicular(u, hint)  # points towards a substituent of x: H opposite = staggered
        w = np.cross(u, v)
        for k in range(3):
            phi = math.pi + 2.0 * math.pi * k / 3.0
            d = math.cos(math.pi - TETRAHEDRAL) * u + math.sin(math.pi - TETRAHEDRAL) * (
                math.cos(phi) * v + math.sin(phi) * w
            )
            new_atoms.append(Atom(element="H", position=_v3(c_pos + C_H * d)))
            new_bonds.append(Bond(a=h, b=len(atoms) + len(new_atoms) - 1))
    if not new_atoms:
        return structure
    # the atom count changed: per-atom data and residues can no longer be aligned
    return structure.model_copy(
        update={
            "atoms": atoms + new_atoms,
            "bonds": bonds + new_bonds,
            "atomic_scalars": {},
            "atomic_vectors": {},
            "residues": [],
        }
    )
