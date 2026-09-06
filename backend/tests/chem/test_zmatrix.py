"""Internal coordinates: the Z-matrix a quantum-chemistry deck can be written in."""

from __future__ import annotations

import numpy as np
import pytest
from rdkit import Chem
from rdkit.Chem import AllChem

from atomscope.chem.zmatrix import ZMatrixRow, zmatrix
from atomscope.io.rdkit_io import read_text
from atomscope.model import Atom, Structure


def molecule(smiles: str, name: str = "m") -> Structure:
    """A 3D structure from SMILES, so the test says what it is testing rather than shipping it."""
    mol = Chem.AddHs(Chem.MolFromSmiles(smiles))
    AllChem.EmbedMolecule(mol, randomSeed=0xC0FFEE)
    AllChem.MMFFOptimizeMolecule(mol)
    return read_text(Chem.MolToMolBlock(mol), "mol", name=name)


def rebuild(rows: list[ZMatrixRow]) -> np.ndarray:
    """Cartesian coordinates from a Z-matrix: the definition of what the numbers mean.

    Atom 0 at the origin, atom 1 along x, atom 2 in the xy plane, and every atom after that
    placed from its distance, angle and torsion (the NeRF construction). Reading the matrix back
    is the only check that says the references and the values belong to each other.
    """
    out = np.zeros((len(rows), 3))
    for i, row in enumerate(rows):
        if i == 0:
            continue
        assert row.a is not None and row.distance is not None
        if i == 1:
            out[1] = out[row.a] + np.array([row.distance, 0.0, 0.0])
            continue
        assert row.b is not None and row.angle is not None
        if i == 2:
            # in the plane, at the angle from the a->b direction
            direction = out[row.b] - out[row.a]
            direction /= np.linalg.norm(direction)
            perpendicular = np.array([0.0, 1.0, 0.0])
            theta = np.radians(row.angle)
            out[2] = out[row.a] + row.distance * (
                np.cos(theta) * direction + np.sin(theta) * perpendicular
            )
            continue
        assert row.c is not None and row.torsion is not None
        a, b, c = out[row.a], out[row.b], out[row.c]
        axis = a - b
        axis /= np.linalg.norm(axis)
        reference = c - b
        n = np.cross(reference, axis)
        n /= np.linalg.norm(n)
        m = np.cross(axis, n)
        theta, phi = np.radians(row.angle), np.radians(row.torsion)
        local = row.distance * np.array(
            [-np.cos(theta), np.sin(theta) * np.cos(phi), np.sin(theta) * np.sin(phi)]
        )
        out[i] = a + local[0] * axis + local[1] * m + local[2] * n
    return out


def distances(positions: np.ndarray) -> np.ndarray:
    """Every interatomic distance: what a rigid motion leaves alone and a wrong angle does not."""
    delta = positions[:, None, :] - positions[None, :, :]
    return np.sqrt((delta**2).sum(axis=-1))


def test_a_z_matrix_puts_the_molecule_back_where_it_was() -> None:
    """The values and their references have to describe the geometry they were measured from.

    A Z-matrix says nothing about where the molecule sits or how it is turned, so the comparison
    is over the distances between every pair of atoms, which are what the internal coordinates
    are supposed to preserve.
    """
    for smiles in ("CCO", "c1ccccc1", "CC(=O)N(C)C", "O"):
        structure = molecule(smiles)
        rebuilt = rebuild(zmatrix(structure))
        original = np.array([a.position for a in structure.atoms])
        assert distances(rebuilt) == pytest.approx(distances(original), abs=1e-6), smiles


def test_the_first_three_rows_of_a_z_matrix_are_short() -> None:
    """Nothing to measure against yet: no distance, then no angle, then no torsion."""
    rows = zmatrix(molecule("CCO"))
    assert (rows[0].a, rows[0].distance) == (None, None)
    assert rows[1].a == 0 and rows[1].angle is None
    assert rows[2].b is not None and rows[2].torsion is None
    assert all(r.torsion is not None for r in rows[3:])


def test_one_atom_has_a_z_matrix_of_one_row() -> None:
    single = Structure(name="he", atoms=[Atom(element="He", position=(1.0, 2.0, 3.0))])
    assert zmatrix(single) == [ZMatrixRow(element="He")]
