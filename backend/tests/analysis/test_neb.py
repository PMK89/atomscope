"""Nudged elastic band, against the system ASE's own tutorial uses.

Au hopping between two hollow sites on Al(100) with EMT. ASE documents a barrier of about
0.40 eV, so the number is checkable rather than merely self-consistent.
"""

from itertools import pairwise

import pytest
from ase import Atoms
from ase.build import add_adsorbate, fcc100
from ase.calculators.emt import EMT
from ase.constraints import FixAtoms
from ase.optimize import BFGS

from atomscope.analysis.neb import NebError, run_neb
from atomscope.ase_bridge import from_atoms
from atomscope.model.structure import Structure


@pytest.fixture(scope="module")
def au_on_al() -> tuple[Structure, Structure]:
    slab = fcc100("Al", size=(2, 2, 3))
    add_adsorbate(slab, "Au", 1.7, "hollow")
    slab.center(axis=2, vacuum=4.0)
    slab.set_constraint(FixAtoms(mask=[a.symbol != "Au" for a in slab]))
    slab.calc = EMT()
    BFGS(slab, logfile=None).run(fmax=0.01)
    initial = slab.copy()
    final = slab.copy()
    final[-1].x += final.get_cell()[0, 0] / 2  # the neighbouring hollow site
    final.calc = EMT()
    BFGS(final, logfile=None).run(fmax=0.01)
    return from_atoms(initial, name="start"), from_atoms(final, name="end")


def test_the_barrier_is_the_one_ase_documents(au_on_al: tuple[Structure, Structure]) -> None:
    initial, final = au_on_al
    r = run_neb(initial, final, EMT, images=5, fmax=0.05, max_steps=100)
    assert r.converged
    # ASE's NEB tutorial gives ~0.40 eV for this hop
    assert r.barrier_ev == pytest.approx(0.40, abs=0.02)
    assert r.transition_index == 2  # the middle image, for a symmetric hop


def test_the_path_is_symmetric_because_the_two_sites_are(
    au_on_al: tuple[Structure, Structure],
) -> None:
    """Both ends are equivalent hollow sites, so an asymmetric path means the band is wrong."""
    initial, final = au_on_al
    r = run_neb(initial, final, EMT, images=5, fmax=0.05, max_steps=100)
    e = r.energies_ev
    assert e[0] == pytest.approx(e[-1], abs=1e-3)
    assert e[1] == pytest.approx(e[-2], abs=1e-3)
    # and the ends are the minima: a band that pushed them uphill was set up wrongly
    assert e[0] < e[1] < e[2]


def test_the_reaction_coordinate_is_distance_not_image_number(
    au_on_al: tuple[Structure, Structure],
) -> None:
    """Unevenly spaced images must not be drawn as if they were evenly spaced."""
    initial, final = au_on_al
    r = run_neb(initial, final, EMT, images=5, fmax=0.05, max_steps=100)
    assert r.coordinate[0] == 0.0
    assert all(b > a for a, b in pairwise(r.coordinate))
    # the Au moves half a cell edge, and the coordinate has to be about that far
    assert r.coordinate[-1] == pytest.approx(2.9, abs=0.3)
    assert len(r.coordinate) == len(r.energies_ev) == r.trajectory.n_frames


def test_the_trajectory_is_the_band(au_on_al: tuple[Structure, Structure]) -> None:
    initial, final = au_on_al
    r = run_neb(initial, final, EMT, images=5, fmax=0.05, max_steps=100)
    assert r.trajectory.kind == "neb"
    assert r.trajectory.n_frames == 5
    assert r.trajectory.symbols == initial.symbols()
    # the first and last frames are the endpoints that went in, not interpolations of them
    first = r.trajectory.frames[0].positions
    for got, want in zip(first, initial.positions(), strict=True):
        assert got == pytest.approx(tuple(want), abs=1e-6)
    assert all(f.energy is not None for f in r.trajectory.frames)


def test_mismatched_ends_are_refused() -> None:
    """ASE interpolates anything of matching length, so a mismatch has to be caught here.

    Otherwise it produces a smooth path between unrelated structures and a barrier that is
    arithmetic rather than chemistry.
    """
    a = from_atoms(Atoms("H2", positions=[(0, 0, 0), (0, 0, 1)]))
    b = from_atoms(Atoms("H3", positions=[(0, 0, 0), (0, 0, 1), (0, 0, 2)]))
    with pytest.raises(NebError, match="atoms"):
        run_neb(a, b, EMT, images=3)

    swapped = from_atoms(Atoms("HHe", positions=[(0, 0, 0), (0, 0, 1)]))
    other = from_atoms(Atoms("HeH", positions=[(0, 0, 0), (0, 0, 1)]))
    with pytest.raises(NebError, match="same order"):
        run_neb(swapped, other, EMT, images=3)


def test_a_band_needs_something_between_its_ends() -> None:
    a = from_atoms(Atoms("H2", positions=[(0, 0, 0), (0, 0, 1)]))
    with pytest.raises(NebError, match="three images"):
        run_neb(a, a, EMT, images=2)
    with pytest.raises(NebError, match="optimizer"):
        run_neb(a, a, EMT, images=3, optimizer="nope")


def test_an_unconverged_band_says_so(au_on_al: tuple[Structure, Structure]) -> None:
    """The maximum of an unconverged band is a lower bound, and must not be reported as more."""
    initial, final = au_on_al
    r = run_neb(initial, final, EMT, images=5, fmax=1e-6, max_steps=1)
    assert r.converged is False
    assert r.steps <= 1
