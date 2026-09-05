"""Trajectories (optimization, MD, NEB images) and vibrational modes."""

from __future__ import annotations

from pydantic import Field, model_validator

from atomscope.model.common import Mat3, Provenance, StrictModel, Vec3


class Frame(StrictModel):
    """One frame: positions (Å) and optional cell, plus per-frame scalars/vectors."""

    positions: list[Vec3]
    cell: Mat3 | None = None
    energy: float | None = Field(default=None, description="eV")
    forces: list[Vec3] | None = Field(default=None, description="eV/Å")
    time: float | None = Field(default=None, description="fs")
    temperature: float | None = Field(default=None, description="K")
    step: int | None = None
    extra: dict[str, float] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _lengths(self) -> Frame:
        if self.forces is not None and len(self.forces) != len(self.positions):
            msg = "forces must have one vector per atom"
            raise ValueError(msg)
        return self


class Trajectory(StrictModel):
    """A sequence of frames sharing the topology of ``structure_id``."""

    id: str
    name: str
    structure_id: str | None = None
    symbols: list[str]
    frames: list[Frame] = Field(default_factory=list)
    kind: str = Field(
        default="generic", description="optimization | md | neb | vibration | generic"
    )
    provenance: Provenance | None = None

    @model_validator(mode="after")
    def _consistent(self) -> Trajectory:
        n = len(self.symbols)
        for i, f in enumerate(self.frames):
            if len(f.positions) != n:
                msg = f"frame {i} has {len(f.positions)} atoms, expected {n}"
                raise ValueError(msg)
        return self

    @property
    def n_frames(self) -> int:
        return len(self.frames)


class VibrationalMode(StrictModel):
    """One normal mode.

    ``displacements`` are *Cartesian* displacement vectors, one per atom, normalised so that
    ``sum_i |d_i|^2 == 1``. This is the convention Gaussian and ORCA print (ORCA states that the
    1/sqrt(m) weighting has already been applied to its printed vectors), and it is what an
    animation needs: atom ``i`` moves along ``amplitude * d_i``. Mass-weighted eigenvectors are
    converted by dividing by sqrt(m_i) and renormalising.
    """

    frequency: float = Field(description="cm^-1; negative = imaginary")
    displacements: list[Vec3] = Field(description="Cartesian, unit-normalised over all atoms")
    ir_intensity: float | None = Field(default=None, description="km/mol")
    raman_activity: float | None = Field(default=None, description="Å^4/amu")
    symmetry: str | None = None
    reduced_mass: float | None = Field(default=None, description="amu")
    force_constant: float | None = Field(default=None, description="mDyne/Å")
    kind: str = Field(
        default="vibration",
        description="vibration | translation | rotation (trivial modes are reported separately)",
    )


class VibrationalSpectrum(StrictModel):
    """The modes of one structure plus the summary numbers a Vibrations dock shows."""

    id: str
    structure_id: str | None = None
    symbols: list[str] = Field(default_factory=list)
    positions: list[Vec3] = Field(
        default_factory=list, description="Å, the equilibrium geometry the modes belong to"
    )
    modes: list[VibrationalMode] = Field(description="the 3N-6 (3N-5) vibrational modes")
    trivial_modes: list[VibrationalMode] = Field(
        default_factory=list,
        description="the 6 (5 for linear molecules) translations/rotations, for diagnostics",
    )
    zero_point_energy: float | None = Field(
        default=None, description="eV, 1/2 sum h*nu over the real vibrational modes"
    )
    linear: bool | None = Field(default=None, description="True when the molecule is linear")
    method: str | None = Field(default=None, description="how the modes were obtained")
    provenance: Provenance | None = None


__all__ = ["Frame", "Trajectory", "VibrationalMode", "VibrationalSpectrum"]
