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
    frequency: float = Field(description="cm^-1; negative = imaginary")
    displacements: list[Vec3] = Field(description="Å, one per atom")
    ir_intensity: float | None = None
    raman_activity: float | None = None
    symmetry: str | None = None


class VibrationalSpectrum(StrictModel):
    id: str
    structure_id: str | None = None
    modes: list[VibrationalMode]
    provenance: Provenance | None = None


__all__ = ["Frame", "Trajectory", "VibrationalMode", "VibrationalSpectrum"]
