import numpy as np
import pytest

from atomscope.chem import forcefield as ffm
from atomscope.chem.geometry import angle_deg, dihedral_deg
from atomscope.chem.obmol import kekulized_orders, with_positions
from atomscope.io.rdkit_io import from_smiles
from atomscope.model import (
    Atom,
    Bond,
    FixAngle,
    FixAtoms,
    FixBondLength,
    FixCartesian,
    FixDihedral,
    IgnoreAtoms,
    Structure,
)


def test_force_fields_discovered() -> None:
    names = ffm.available_force_fields()
    assert {"UFF", "MMFF94", "MMFF94s", "GAFF", "Ghemical"} <= set(names)


def test_methane_mmff94_energy_is_finite_and_in_ev() -> None:
    res = ffm.single_point(from_smiles("C"), "MMFF94")
    assert np.isfinite(res.energy.value)
    assert res.energy.unit == "eV" and res.energy_native.unit == "kcal/mol"
    assert res.energy.value == pytest.approx(res.energy_native.value * 0.0433641, rel=1e-4)
    assert len(res.forces) == 5
    assert set(res.terms) >= {"bond", "angle", "torsion", "van_der_waals", "electrostatic"}
    assert sum(res.terms.values()) == pytest.approx(res.energy.value, abs=1e-6)


def test_forces_match_finite_differences() -> None:
    s = from_smiles("CCO")
    pos = s.positions()
    pos[0] += [0.05, -0.03, 0.02]  # off the minimum so forces are non-zero
    s = with_positions(s, pos)
    forces = np.array(ffm.single_point(s, "UFF").forces)
    h = 1e-4
    for k in range(3):
        p = pos.copy()
        p[0, k] += h
        e_plus = ffm.single_point(with_positions(s, p), "UFF").energy.value
        p[0, k] -= 2 * h
        e_minus = ffm.single_point(with_positions(s, p), "UFF").energy.value
        assert forces[0, k] == pytest.approx(-(e_plus - e_minus) / (2 * h), abs=2e-3)


@pytest.mark.parametrize("algorithm", ["steepest_descent", "conjugate_gradients"])
def test_uff_optimization_lowers_energy(algorithm: str) -> None:
    s = from_smiles("CCO")
    pos = s.positions()
    pos[0] += [0.3, 0.0, 0.0]
    s = with_positions(s, pos)
    e0 = ffm.single_point(s, "UFF").energy.value
    res = ffm.optimize(s, "UFF", algorithm=algorithm, max_steps=200, record_every=20)  # type: ignore[arg-type]
    assert res.energy.value < e0
    assert res.structure.n_atoms == 9 and res.structure.bonds == s.bonds
    assert res.structure.atoms[0].uid == s.atoms[0].uid
    assert res.structure.properties["energy"].value == pytest.approx(res.energy.value)
    assert "forces" in res.structure.atomic_vectors
    assert res.trajectory is not None and res.trajectory.n_frames >= 2
    energies = [f.energy for f in res.trajectory.frames]
    assert energies[0] is not None and energies[-1] is not None and energies[-1] <= energies[0]


def test_water_angle_converges_towards_reference() -> None:
    s = Structure(
        name="bent water",
        atoms=[
            Atom(element="O", position=(0, 0, 0)),
            Atom(element="H", position=(0.9, 0.2, 0)),
            Atom(element="H", position=(-0.5, 0.9, 0)),
        ],
        bonds=[Bond(a=0, b=1), Bond(a=0, b=2)],
    )
    res = ffm.optimize(s, "MMFF94", max_steps=500, convergence=1e-8)
    p = res.structure.positions()
    v1, v2 = p[1] - p[0], p[2] - p[0]
    ang = np.degrees(np.arccos(np.dot(v1, v2) / np.linalg.norm(v1) / np.linalg.norm(v2)))
    assert 100 < ang < 110


def test_fixed_atoms_and_constraints_are_respected() -> None:
    s = from_smiles("CCO")
    pos = s.positions()
    pos[1] += [0.4, 0.0, 0.0]
    s = with_positions(s, pos)
    s.constraints = [
        FixAtoms(indices=[0]),
        FixCartesian(index=2, mask=(False, False, True)),
        FixBondLength(a=1, b=2),
    ]
    d0 = float(np.linalg.norm(pos[1] - pos[2]))
    res = ffm.optimize(s, "UFF", max_steps=100, constraints=[FFC(kind="fix", atoms=[3])])
    p = res.structure.positions()
    assert np.allclose(p[0], pos[0], atol=1e-6)
    assert np.allclose(p[3], pos[3], atol=1e-6)
    assert p[2, 2] == pytest.approx(pos[2, 2], abs=1e-6)
    assert float(np.linalg.norm(p[1] - p[2])) == pytest.approx(d0, abs=0.02)
    assert not np.allclose(p[1], pos[1])


FFC = ffm.FFConstraint


def test_constraint_validation() -> None:
    with pytest.raises(ValueError, match="needs 2 atoms"):
        FFC(kind="distance", atoms=[1], value=1.0)
    with pytest.raises(ValueError, match="target value"):
        FFC(kind="angle", atoms=[0, 1, 2])
    with pytest.raises(ffm.ForceFieldError, match="outside"):
        ffm.single_point(from_smiles("O"), "UFF", [FFC(kind="fix", atoms=[7])])


def test_benzene_is_kekulized_for_open_babel() -> None:
    s = from_smiles("c1ccccc1")
    assert any(b.aromatic for b in s.bonds)
    orders = kekulized_orders(s)
    ring = [o for b, o in zip(s.bonds, orders, strict=True) if b.aromatic]
    assert sorted(ring) == [1, 1, 1, 2, 2, 2]
    res = ffm.single_point(s, "MMFF94")
    assert np.isfinite(res.energy.value)


def test_unknown_force_field_and_bad_setup() -> None:
    with pytest.raises(ffm.ForceFieldError, match="not available"):
        ffm.single_point(from_smiles("C"), "AMBER99")


def test_conformer_search_returns_conformers_with_energies() -> None:
    s = from_smiles("CCCCO")
    res = ffm.conformer_search(s, "MMFF94", method="systematic", steps=20)
    assert res.trajectory.n_frames >= 2
    assert all(f.energy is not None for f in res.trajectory.frames)
    best = min(f.energy or 0.0 for f in res.trajectory.frames)
    assert res.structure.properties["energy"].value == pytest.approx(best)
    assert res.structure.n_atoms == s.n_atoms
    res2 = ffm.conformer_search(s, "MMFF94", method="random", n_conformers=3, steps=10)
    assert res2.trajectory.n_frames >= 1


def test_an_angle_constraint_holds_the_target_it_was_given() -> None:
    s = from_smiles("CCCC")
    s.constraints = [FixAngle(a=0, b=1, c=2, value=100.0)]
    res = ffm.optimize(s, "UFF", max_steps=200)
    p = res.structure.positions()
    assert angle_deg(p[0], p[1], p[2]) == pytest.approx(100.0, abs=2.0)


def test_a_torsion_constraint_without_a_target_keeps_the_current_one() -> None:
    """Open Babel treats a torsion constraint as a restraint: it holds, but only approximately."""
    s = from_smiles("CCCC")
    pos0 = s.positions()
    tor0 = dihedral_deg(pos0[0], pos0[1], pos0[2], pos0[3])
    s.constraints = [FixDihedral(a=0, b=1, c=2, d=3)]
    res = ffm.optimize(s, "UFF", max_steps=400)
    p = res.structure.positions()
    assert dihedral_deg(p[0], p[1], p[2], p[3]) == pytest.approx(tor0, abs=2.0)


def test_structure_constraints_cover_every_kind() -> None:
    s = from_smiles("CCO")
    pos = s.positions()
    s.constraints = [
        FixAngle(a=0, b=1, c=2),
        FixDihedral(a=0, b=1, c=2, d=3, value=60.0),
        IgnoreAtoms(indices=[3, 4]),
    ]
    got = ffm.structure_constraints(s)
    assert [c.kind for c in got] == ["angle", "torsion", "ignore", "ignore"]
    # a constraint without a target value takes the one the geometry has now
    assert got[0].value == pytest.approx(angle_deg(pos[0], pos[1], pos[2]))
    assert got[1].value == pytest.approx(60.0)
    assert [c.atoms for c in got[2:]] == [[3], [4]]
    # and Open Babel sets the force field up with them: an ignored atom is not a rejected one
    assert np.isfinite(ffm.single_point(s, "MMFF94").energy.value)
    assert ffm.optimize(s, "MMFF94", max_steps=50).converged
