"""Nudged elastic band: the minimum-energy path between two geometries.

ASE's own example runs NEB with EMT and reports the barrier as the highest image on the relaxed
band. What Atomscope needs from it is a *picture*: the band as a trajectory the player can step
through, and the energy against reaction coordinate as a chart -- which together are what a NEB
is for.

Two things that matter for the result to mean anything:

* The endpoints must describe the same system in the same order. ASE will interpolate anything
  with matching lengths, so a mismatched pair produces a smooth path between unrelated structures
  and a barrier that is arithmetic rather than chemistry.
* The barrier is read off the *relaxed* band, and only when the band actually converged. An
  unconverged band's maximum is a lower bound on the barrier and is reported as such rather than
  as the answer.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import pairwise
from typing import Any

import numpy as np
from ase import Atoms
from ase.mep import NEB
from ase.optimize import BFGS, FIRE, LBFGS

from atomscope.ase_bridge.convert import from_atoms, to_atoms
from atomscope.model.structure import Structure, new_uid
from atomscope.model.trajectory import Frame, Trajectory

OPTIMIZERS = {"bfgs": BFGS, "lbfgs": LBFGS, "fire": FIRE}


class NebError(ValueError):
    """The band could not be set up or run."""


@dataclass
class NebResult:
    trajectory: Trajectory
    energies_ev: list[float]
    #: Cumulative distance along the band (Å), the reaction coordinate a NEB plot uses for x.
    coordinate: list[float]
    barrier_ev: float
    #: Index of the highest image; the saddle point when the band has converged.
    transition_index: int
    converged: bool
    steps: int


def _interpolate(initial: Atoms, final: Atoms, images: int, method: str) -> list[Atoms]:
    band = [initial] + [initial.copy() for _ in range(images - 2)] + [final]
    neb = NEB(band)
    # 'idpp' interpolates in distance space, which avoids the atom overlaps a straight-line
    # interpolation produces whenever the two ends differ by a rotation as well as a displacement
    neb.interpolate(method=method)
    return band


def run_neb(
    initial: Structure,
    final: Structure,
    calculator_factory: Any,
    *,
    images: int = 7,
    k: float = 0.1,
    climb: bool = False,
    interpolation: str = "idpp",
    optimizer: str = "bfgs",
    fmax: float = 0.05,
    max_steps: int = 100,
) -> NebResult:
    """Relax a band between ``initial`` and ``final`` and report the path.

    ``calculator_factory`` is called once per image: ASE requires a separate calculator per image
    unless the band is told otherwise, because each image is evaluated independently.
    """
    if initial.n_atoms != final.n_atoms:
        msg = f"the two ends have {initial.n_atoms} and {final.n_atoms} atoms"
        raise NebError(msg)
    if initial.symbols() != final.symbols():
        msg = "the two ends must list the same elements in the same order"
        raise NebError(msg)
    if images < 3:
        msg = "a band needs at least three images (two ends and something between them)"
        raise NebError(msg)
    if optimizer not in OPTIMIZERS:
        msg = f"unknown optimizer {optimizer!r}"
        raise NebError(msg)

    band = _interpolate(to_atoms(initial), to_atoms(final), images, interpolation)
    for image in band:
        image.calc = calculator_factory()

    neb = NEB(band, k=k, climb=climb)
    opt = OPTIMIZERS[optimizer](neb, logfile=None)
    converged = bool(opt.run(fmax=fmax, steps=max_steps))

    energies = [float(image.get_potential_energy()) for image in band]
    # the reaction coordinate a NEB plot uses: distance travelled along the band, not image number,
    # so that unevenly spaced images are not drawn as if they were evenly spaced
    coordinate = [0.0]
    for a, b in pairwise(band):
        coordinate.append(coordinate[-1] + float(np.linalg.norm(b.positions - a.positions)))

    top = int(np.argmax(energies))
    frames = [
        Frame(
            positions=[(float(p[0]), float(p[1]), float(p[2])) for p in image.positions],
            energy=energies[i],
            step=i,
        )
        for i, image in enumerate(band)
    ]
    return NebResult(
        trajectory=Trajectory(
            id=new_uid(),
            name=f"{initial.name or 'band'} → {final.name or 'band'}",
            symbols=initial.symbols(),
            frames=frames,
            kind="neb",
        ),
        energies_ev=energies,
        coordinate=coordinate,
        barrier_ev=energies[top] - energies[0],
        transition_index=top,
        converged=converged,
        steps=int(opt.get_number_of_steps()),
    )


def relaxed_structures(result: NebResult, symbols: list[str]) -> list[Structure]:
    """Each image as a structure, so any of them can be sent on to another calculation."""
    return [
        from_atoms(Atoms(symbols=symbols, positions=[list(p) for p in frame.positions]))
        for frame in result.trajectory.frames
    ]
