"""Open Babel force fields: energies, forces, constrained optimization and conformer search.

Force fields are discovered at runtime (``OBForceField.FindForceField``); Open Babel 3.1 ships
UFF, MMFF94, MMFF94s, GAFF and Ghemical. Energies are reported by Open Babel in the force
field's own unit (``GetUnit()``: kcal/mol for MMFF94, kJ/mol for the others) and converted here
to eV and eV/Å, the internal units of the data model.
"""

from __future__ import annotations

import math
from typing import Literal

import numpy as np
from openbabel import openbabel as ob
from pydantic import Field, model_validator

from atomscope.chem.obmol import OB_LOCK, positions_from_obmol, to_obmol, with_positions
from atomscope.model import (
    AtomicVectorProperty,
    FixAtoms,
    FixBondLength,
    FixCartesian,
    Frame,
    Quantity,
    Structure,
    Trajectory,
)
from atomscope.model.common import StrictModel, Vec3
from atomscope.units import Unit, convert

FORCE_FIELD_CANDIDATES = ("MMFF94", "MMFF94s", "UFF", "GAFF", "Ghemical")
Algorithm = Literal["steepest_descent", "conjugate_gradients"]
ConformerMethod = Literal["systematic", "random", "weighted"]
ConstraintKind = Literal["ignore", "fix", "fix_x", "fix_y", "fix_z", "distance", "angle", "torsion"]
_N_ATOMS: dict[str, int] = {
    "ignore": 1,
    "fix": 1,
    "fix_x": 1,
    "fix_y": 1,
    "fix_z": 1,
    "distance": 2,
    "angle": 3,
    "torsion": 4,
}


class FFConstraint(StrictModel):
    """One Open Babel force-field constraint on 0-based atom indices."""

    kind: ConstraintKind
    atoms: list[int]
    value: float | None = Field(default=None, description="Å for distance, degrees for angles")

    @model_validator(mode="after")
    def _arity(self) -> FFConstraint:
        if len(self.atoms) != _N_ATOMS[self.kind]:
            msg = f"{self.kind} constraint needs {_N_ATOMS[self.kind]} atoms, got {len(self.atoms)}"
            raise ValueError(msg)
        if self.kind in ("distance", "angle", "torsion") and self.value is None:
            msg = f"{self.kind} constraint needs a target value"
            raise ValueError(msg)
        return self


class EnergyResult(StrictModel):
    force_field: str
    energy: Quantity = Field(description="total energy in eV")
    energy_native: Quantity = Field(description="the same energy in the force field's unit")
    forces: list[Vec3] = Field(description="eV/Å")
    terms: dict[str, float] = Field(default_factory=dict, description="energy breakdown in eV")


class OptimizeResult(StrictModel):
    structure: Structure
    energy: Quantity
    converged: bool
    steps: int
    trajectory: Trajectory | None = None


class ConformerResult(StrictModel):
    structure: Structure = Field(description="lowest-energy conformer")
    trajectory: Trajectory = Field(description="all conformers with energies (eV)")


class ForceFieldError(ValueError):
    """Raised when a force field cannot be set up for the molecule."""


def available_force_fields() -> list[str]:
    with OB_LOCK:
        return [n for n in FORCE_FIELD_CANDIDATES if ob.OBForceField.FindForceField(n) is not None]


def structure_constraints(structure: Structure) -> list[FFConstraint]:
    """Map the model's geometric constraints to force-field constraints."""
    out: list[FFConstraint] = []
    pos = structure.positions()
    for c in structure.constraints:
        if isinstance(c, FixAtoms):
            out.extend(FFConstraint(kind="fix", atoms=[i]) for i in c.indices)
        elif isinstance(c, FixCartesian):
            if all(c.mask):
                out.append(FFConstraint(kind="fix", atoms=[c.index]))
            else:
                for k, name in enumerate(("fix_x", "fix_y", "fix_z")):
                    if c.mask[k]:
                        out.append(FFConstraint(kind=name, atoms=[c.index]))  # type: ignore[arg-type]
        elif isinstance(c, FixBondLength):
            d = float(np.linalg.norm(pos[c.a] - pos[c.b]))
            out.append(FFConstraint(kind="distance", atoms=[c.a, c.b], value=d))
    return out


def _ob_constraints(constraints: list[FFConstraint], n_atoms: int) -> ob.OBFFConstraints:
    obc = ob.OBFFConstraints()
    for c in constraints:
        if any(i < 0 or i >= n_atoms for i in c.atoms):
            msg = f"constraint {c.kind} references atom outside 0..{n_atoms - 1}"
            raise ForceFieldError(msg)
        idx = [i + 1 for i in c.atoms]  # Open Babel atoms are 1-based
        match c.kind:
            case "ignore":
                obc.AddIgnore(idx[0])
            case "fix":
                obc.AddAtomConstraint(idx[0])
            case "fix_x":
                obc.AddAtomXConstraint(idx[0])
            case "fix_y":
                obc.AddAtomYConstraint(idx[0])
            case "fix_z":
                obc.AddAtomZConstraint(idx[0])
            case "distance":
                obc.AddDistanceConstraint(idx[0], idx[1], float(c.value or 0.0))
            case "angle":
                obc.AddAngleConstraint(idx[0], idx[1], idx[2], float(c.value or 0.0))
            case "torsion":
                obc.AddTorsionConstraint(idx[0], idx[1], idx[2], idx[3], float(c.value or 0.0))
    return obc


class _Session:
    """A force field set up for one molecule; must be used while holding OB_LOCK."""

    def __init__(
        self, structure: Structure, force_field: str, constraints: list[FFConstraint]
    ) -> None:
        if structure.n_atoms == 0:
            raise ForceFieldError("structure has no atoms")
        self.name = force_field
        self.ff = ob.OBForceField.FindForceField(force_field)
        if self.ff is None:
            msg = f"force field {force_field!r} is not available"
            raise ForceFieldError(msg)
        self.mol = to_obmol(structure)
        self.unit = Unit(self.ff.GetUnit())
        self.factor = convert(1.0, self.unit, Unit.EV)
        all_constraints = structure_constraints(structure) + list(constraints)
        # FindForceField returns a shared singleton: always install fresh constraints.
        if not self.ff.Setup(self.mol, _ob_constraints(all_constraints, structure.n_atoms)):
            msg = (
                f"{force_field} could not be set up for {structure.formula()} (missing atom types?)"
            )
            raise ForceFieldError(msg)

    def energy(self) -> float:
        e = float(self.ff.Energy(False))
        if not math.isfinite(e):
            raise ForceFieldError("force field energy is not finite")
        return e * self.factor

    def forces(self) -> list[Vec3]:
        """Forces in eV/Å. Open Babel's ``GetGradient`` already returns -dE/dx."""
        self.ff.Energy(True)
        out: list[Vec3] = []
        for oa in ob.OBMolAtomIter(self.mol):
            g = self.ff.GetGradient(oa)
            out.append((g.GetX() * self.factor, g.GetY() * self.factor, g.GetZ() * self.factor))
        return out

    def terms(self) -> dict[str, float]:
        f = self.factor
        ff = self.ff
        return {
            "bond": ff.E_Bond(False) * f,
            "angle": ff.E_Angle(False) * f,
            "stretch_bend": ff.E_StrBnd(False) * f,
            "torsion": ff.E_Torsion(False) * f,
            "out_of_plane": ff.E_OOP(False) * f,
            "van_der_waals": ff.E_VDW(False) * f,
            "electrostatic": ff.E_Electrostatic(False) * f,
        }

    def positions(self) -> np.ndarray:
        self.ff.GetCoordinates(self.mol)
        return positions_from_obmol(self.mol)


def single_point(
    structure: Structure, force_field: str, constraints: list[FFConstraint] | None = None
) -> EnergyResult:
    with OB_LOCK:
        s = _Session(structure, force_field, constraints or [])
        e = s.energy()
        return EnergyResult(
            force_field=force_field,
            energy=Quantity(value=e, unit=Unit.EV),
            energy_native=Quantity(value=e / s.factor, unit=s.unit),
            forces=s.forces(),
            terms=s.terms(),
        )


def _frame(s: _Session, pos: np.ndarray, energy: float, step: int) -> Frame:
    return Frame(
        positions=[(float(p[0]), float(p[1]), float(p[2])) for p in pos],
        energy=energy,
        forces=s.forces(),
        step=step,
    )


def _finish(structure: Structure, s: _Session, energy: float, pos: np.ndarray) -> Structure:
    out = with_positions(structure, pos)
    out.properties = {**out.properties, "energy": Quantity(value=energy, unit=Unit.EV)}
    out.atomic_vectors = {
        **out.atomic_vectors,
        "forces": AtomicVectorProperty(
            values=s.forces(), unit=Unit.EV_PER_ANGSTROM, description=f"{s.name} forces"
        ),
    }
    return out


def optimize(
    structure: Structure,
    force_field: str,
    *,
    algorithm: Algorithm = "steepest_descent",
    max_steps: int = 500,
    convergence: float = 1e-6,
    constraints: list[FFConstraint] | None = None,
    record_every: int = 0,
) -> OptimizeResult:
    """Minimize the energy. ``record_every > 0`` records a trajectory frame every N steps."""
    if max_steps < 1:
        raise ForceFieldError("max_steps must be at least 1")
    with OB_LOCK:
        s = _Session(structure, force_field, constraints or [])
        ff = s.ff
        if algorithm == "conjugate_gradients":
            ff.ConjugateGradientsInitialize(max_steps, convergence)
            take = ff.ConjugateGradientsTakeNSteps
        else:
            ff.SteepestDescentInitialize(max_steps, convergence)
            take = ff.SteepestDescentTakeNSteps
        chunk = record_every if record_every > 0 else max_steps
        frames: list[Frame] = []
        if record_every > 0:
            frames.append(_frame(s, s.positions(), s.energy(), 0))
        done = 0
        more = True
        while more and done < max_steps:
            n = min(chunk, max_steps - done)
            more = bool(take(n))
            done += n
            if record_every > 0:
                frames.append(_frame(s, s.positions(), s.energy(), done))
        pos = s.positions()
        energy = s.energy()
        traj = None
        if record_every > 0:
            traj = Trajectory(
                id=f"{structure.id}-opt",
                name=f"{force_field} optimization",
                structure_id=structure.id,
                symbols=structure.symbols(),
                frames=frames,
                kind="optimization",
            )
        return OptimizeResult(
            structure=_finish(structure, s, energy, pos),
            energy=Quantity(value=energy, unit=Unit.EV),
            converged=not more,
            steps=done,
            trajectory=traj,
        )


def conformer_search(
    structure: Structure,
    force_field: str,
    *,
    method: ConformerMethod = "weighted",
    n_conformers: int = 10,
    steps: int = 100,
    constraints: list[FFConstraint] | None = None,
) -> ConformerResult:
    """Rotor search over rotatable bonds; each conformer is locally optimized for ``steps``."""
    with OB_LOCK:
        s = _Session(structure, force_field, constraints or [])
        ff = s.ff
        match method:
            case "systematic":
                ff.SystematicRotorSearch(steps)
            case "random":
                ff.RandomRotorSearch(n_conformers, steps)
            case "weighted":
                ff.WeightedRotorSearch(n_conformers, steps)
        ff.GetConformers(s.mol)
        energies = [float(e) * s.factor for e in s.mol.GetEnergies()]
        frames: list[Frame] = []
        for i in range(s.mol.NumConformers()):
            s.mol.SetConformer(i)
            pos = positions_from_obmol(s.mol)
            e = energies[i] if i < len(energies) else None
            frames.append(
                Frame(positions=[(float(p[0]), float(p[1]), float(p[2])) for p in pos], energy=e)
            )
        if not frames:
            raise ForceFieldError("conformer search produced no conformers")
        best = min(range(len(frames)), key=lambda i: frames[i].energy or math.inf)
        traj = Trajectory(
            id=f"{structure.id}-conformers",
            name=f"{force_field} {method} rotor search",
            structure_id=structure.id,
            symbols=structure.symbols(),
            frames=frames,
            kind="conformers",
        )
        best_struct = with_positions(structure, np.array(frames[best].positions))
        best_energy = frames[best].energy
        if best_energy is not None:
            best_struct.properties = {
                **best_struct.properties,
                "energy": Quantity(value=best_energy, unit=Unit.EV),
            }
        return ConformerResult(structure=best_struct, trajectory=traj)
