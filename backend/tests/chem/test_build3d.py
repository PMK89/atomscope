"""Rough 3D geometry from a flat drawing (Avogadro 1's build-on-load offer)."""

from __future__ import annotations

import numpy as np
import pytest
from rdkit import Chem
from rdkit.Chem import AllChem

from atomscope.chem.build3d import generate_3d
from atomscope.io.rdkit_io import read_text
from atomscope.model import Atom, Structure


def flat(smiles: str, name: str = "drawing") -> Structure:
    """A 2D molfile of `smiles`, written here rather than shipped: it is the input under test."""
    mol = Chem.MolFromSmiles(smiles)
    AllChem.Compute2DCoords(mol)
    return read_text(Chem.MolToMolBlock(mol), "mol", name=name)


def flat_z(s: Structure) -> bool:
    """Every atom in one plane, which is what a drawing gives and what a build must not."""
    return all(abs(a.position[2]) <= 1e-6 for a in s.atoms)


def bond_lengths(s: Structure) -> list[float]:
    pos = np.array([a.position for a in s.atoms])
    return [float(np.linalg.norm(pos[b.a] - pos[b.b])) for b in s.bonds]


def test_a_flat_drawing_becomes_a_geometry_without_moving_the_atoms_it_names() -> None:
    drawing = flat("c1ccccc1C(=O)O", name="benzoic acid")
    assert flat_z(drawing)
    assert drawing.n_atoms == 9  # the drawing carries no hydrogens

    built = generate_3d(drawing)
    assert not flat_z(built)
    assert built.name == "benzoic acid"
    # the heavy atoms keep their indices and elements; the hydrogens come after them
    assert [a.element for a in built.atoms[:9]] == [a.element for a in drawing.atoms]
    assert built.formula() == "C7H6O2"
    lengths = bond_lengths(built)
    assert min(lengths) > 0.9  # nothing left on top of anything else
    assert max(lengths) < 1.6
    ring = [d for d, b in zip(bond_lengths(built), built.bonds, strict=True) if b.aromatic]
    assert ring and all(1.34 < d < 1.45 for d in ring)


def test_the_geometry_is_three_dimensional_where_the_molecule_is() -> None:
    """Cyclohexane drawn flat comes back as a chair, which is the point of building at all."""
    built = generate_3d(flat("C1CCCCC1"))
    z = np.array([a.position for a in built.atoms])[:, 2]
    assert float(np.ptp(z)) > 1.0


def test_hydrogens_can_be_left_off() -> None:
    built = generate_3d(flat("C1CCCCC1"), add_hydrogens=False)
    assert built.n_atoms == 6
    assert not flat_z(built)


def test_what_cannot_be_built_says_so() -> None:
    empty = Structure(name="nothing", atoms=[], bonds=[])
    with pytest.raises(ValueError, match="without atoms"):
        generate_3d(empty)
    # the builder walks bonds; a bare point cloud would be scattered, not built
    cloud = Structure(
        name="cloud",
        atoms=[Atom(element="C", position=(float(i), 0.0, 0.0)) for i in range(3)],
        bonds=[],
    )
    with pytest.raises(ValueError, match="without bonds"):
        generate_3d(cloud)


def test_cis_and_trans_survive_the_build() -> None:
    """A drawing carries double-bond stereochemistry in its coordinates, so the build must keep it.

    Open Babel perceives it only when asked (`StereoFrom2D`): without that call both isomers of
    difluoroethene build trans, which is this test's reason for existing.
    """
    from atomscope.chem.geometry import dihedral_deg  # noqa: PLC0415 (only this test needs it)

    def fluorine_dihedral(smiles: str) -> float:
        built = generate_3d(flat(smiles))
        assert [a.element for a in built.atoms[:4]] == ["F", "C", "C", "F"]
        p = [a.position for a in built.atoms[:4]]
        return abs(dihedral_deg(p[0], p[1], p[2], p[3]))

    assert fluorine_dihedral(r"F/C=C\F") < 30.0
    assert fluorine_dihedral("F/C=C/F") > 150.0
