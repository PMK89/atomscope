"""Volumetric scalar fields (densities, orbitals, potentials) and orbital metadata."""

from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from atomscope.model.common import Provenance, StrictModel, Vec3
from atomscope.units import Unit

GridKind = Literal[
    "electron_density",
    "spin_density",
    "orbital",
    "orbital_density",
    "electrostatic_potential",
    "density_difference",
    "other",
]


class OrbitalInfo(StrictModel):
    """Metadata describing one orbital (band) for orbital selection UIs."""

    index: int = Field(description="0-based orbital/band index within its spin channel")
    energy: float | None = Field(default=None, description="eV")
    occupation: float | None = None
    spin: Literal["up", "down", "none"] = "none"
    kpoint: int | None = None
    label: str | None = Field(default=None, description="e.g. 'HOMO', 'LUMO+1', symmetry label")
    symmetry: str | None = None


class VolumetricGrid(StrictModel):
    """A regular 3D grid. Voxel (i,j,k) sits at origin + i*axes[0] + j*axes[1] + k*axes[2].

    Values are stored in a binary sidecar (``data_ref``: path relative to the owning
    project/calculation, little-endian float32 or float64, C order matching ``shape``) or
    inline for small grids. Exactly one of ``data_ref`` / ``inline_values`` is set.
    """

    id: str
    name: str
    kind: GridKind = "other"
    origin: Vec3 = Field(description="Å")
    axes: tuple[Vec3, Vec3, Vec3] = Field(description="step vectors in Å")
    shape: tuple[int, int, int]
    unit: Unit
    data_ref: str | None = None
    dtype: Literal["float32", "float64"] = "float32"
    inline_values: list[float] | None = None
    orbital: OrbitalInfo | None = None
    structure_id: str | None = Field(default=None, description="structure the grid belongs to")
    provenance: Provenance | None = None

    @model_validator(mode="after")
    def _one_storage(self) -> VolumetricGrid:
        if (self.data_ref is None) == (self.inline_values is None):
            msg = "exactly one of data_ref or inline_values must be set"
            raise ValueError(msg)
        n = self.shape[0] * self.shape[1] * self.shape[2]
        if self.inline_values is not None and len(self.inline_values) != n:
            msg = f"inline_values has {len(self.inline_values)} entries, shape needs {n}"
            raise ValueError(msg)
        if any(s <= 0 for s in self.shape):
            msg = "shape entries must be positive"
            raise ValueError(msg)
        return self

    @property
    def n_points(self) -> int:
        return self.shape[0] * self.shape[1] * self.shape[2]


__all__ = ["GridKind", "OrbitalInfo", "VolumetricGrid"]
