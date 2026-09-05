"""Molecular point-group detection and symmetrization.

The reference answers are textbook: every molecule here has a point group that any inorganic
chemistry course states, which is a stronger check than a golden file would be.
"""

from __future__ import annotations

import numpy as np
import pytest
from ase import Atoms
from ase.build import molecule

from atomscope.ase_bridge.convert import from_atoms
from atomscope.chem.pointgroup import MAX_ATOMS, detect, symmetrize
from atomscope.model import Atom, Structure


def octahedron() -> Structure:
    d = 1.56
    return from_atoms(
        Atoms(
            "SF6",
            positions=[
                (0, 0, 0),
                (d, 0, 0),
                (-d, 0, 0),
                (0, d, 0),
                (0, -d, 0),
                (0, 0, d),
                (0, 0, -d),
            ],
        )
    )


def sandwich(twist: float) -> Structure:
    """A metallocene: two cyclopentadienyl rings, eclipsed (twist 0) or staggered (pi/5)."""
    angles = np.arange(5) * 2 * np.pi / 5
    ring = [(1.2 * np.cos(a), 1.2 * np.sin(a)) for a in angles]
    twisted = [(1.2 * np.cos(a + twist), 1.2 * np.sin(a + twist)) for a in angles]
    positions = [(0.0, 0.0, 0.0)]
    positions += [(x, y, 1.65) for x, y in ring]
    positions += [(x, y, -1.65) for x, y in twisted]
    return from_atoms(Atoms("Fe" + "C" * 10, positions=positions))


@pytest.mark.parametrize(
    "name,symbol,order",
    [
        ("H2O", "C2v", 4),
        ("NH3", "C3v", 6),
        ("CH4", "Td", 24),
        ("C6H6", "D6h", 24),
        ("C2H6", "D3d", 12),  # ASE's ethane is staggered
        ("C2H4", "D2h", 8),
        ("CH3Cl", "C3v", 6),
        ("C3H4_D2d", "D2d", 8),  # allene
        ("H2O2", "C2", 2),
        ("CH3CH2OH", "Cs", 2),
    ],
)
def test_textbook_point_groups(name: str, symbol: str, order: int) -> None:
    found = detect(from_atoms(molecule(name)))
    assert found.symbol == symbol
    assert found.order == order


def test_linear_molecules_get_the_infinite_groups() -> None:
    assert detect(from_atoms(molecule("CO"))).symbol == "C*v"
    assert detect(from_atoms(molecule("CO2"))).symbol == "D*h"
    # a single atom is fully isotropic
    assert detect(from_atoms(Atoms("Xe", positions=[(0, 0, 0)]))).symbol == "R3"


def test_octahedron_is_oh_with_all_its_axes() -> None:
    """The C3 axes of an octahedron lie along body diagonals, which no pair of atoms points at;
    finding them is what separates Oh from D4h."""
    found = detect(octahedron())
    assert found.symbol == "Oh"
    assert found.order == 48
    assert "C3" in found.operations and "C4" in found.operations and "i" in found.operations


def test_metallocene_conformers_differ() -> None:
    assert detect(sandwich(np.pi / 5)).symbol == "D5d"  # staggered
    assert detect(sandwich(0.0)).symbol == "D5h"  # eclipsed


def test_tolerance_decides_how_much_distortion_is_symmetric() -> None:
    """One O-H stretched inside the molecular plane: the C2 axis is gone at a tight tolerance but
    the plane itself survives, and a loose tolerance still calls the molecule C2v."""
    distorted = molecule("H2O")
    distorted.positions[1] += [0.05, -0.03, 0.0]
    structure = from_atoms(distorted)
    assert detect(structure, "tight").symbol == "Cs"
    assert detect(structure, "loose").symbol == "C2v"


def test_symmetrize_idealizes_a_distorted_molecule() -> None:
    distorted = molecule("H2O")
    distorted.positions[1] += [0.05, -0.03, 0.0]
    structure = from_atoms(distorted)
    ideal = symmetrize(structure, "loose")
    # the loose group is now exact enough to survive the tight test
    assert detect(ideal, "tight").symbol == "C2v"
    # the O-H bonds became equal and the atoms barely moved
    positions = ideal.positions()
    assert np.linalg.norm(positions[1] - positions[0]) == pytest.approx(
        float(np.linalg.norm(positions[2] - positions[0])), abs=1e-6
    )
    assert np.abs(positions - structure.positions()).max() < 0.1


def test_symmetrize_keeps_an_already_symmetric_molecule_in_place() -> None:
    """Ethanol is exactly Cs in ASE's geometry: idealizing it must not move or translate it."""
    structure = from_atoms(molecule("CH3CH2OH"))
    ideal = symmetrize(structure, "tight")
    assert np.abs(ideal.positions() - structure.positions()).max() < 1e-9


def test_refuses_an_empty_or_oversized_structure() -> None:
    with pytest.raises(ValueError, match="empty"):
        detect(Structure(atoms=[]))
    big = Structure(
        atoms=[Atom(element="H", position=(float(i), 0.0, 0.0)) for i in range(MAX_ATOMS + 1)]
    )
    with pytest.raises(ValueError, match="limited"):
        detect(big)
