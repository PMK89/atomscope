"""Electronic spectra: (projected) densities of states and band structures. Energies in eV."""

from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from atomscope.model.common import StrictModel, Vec3

Spin = Literal["up", "down", "none"]


class DosSeries(StrictModel):
    """One weight (total, per atom, per angular momentum ...) in one spin channel.

    ``dos`` counts all states, ``occupied_dos`` weights them with the occupations; both in
    states/eV. Spin-down series are stored as written by the code (negative sign) so that
    mirrored plots need no extra convention.
    """

    id: str = Field(description="weight id, e.g. 'total', 'SI1_p'")
    label: str
    spin: Spin = "none"
    dos: list[float]
    occupied_dos: list[float]


class DosSpectrum(StrictModel):
    energies: list[float] = Field(description="eV, shared by all series")
    series: list[DosSeries]
    fermi_level: float | None = Field(default=None, description="eV, as reported by the tool")
    homo_energy: float | None = Field(default=None, description="eV, from the eigenvalues")
    broadening: float | None = Field(default=None, description="eV")

    @model_validator(mode="after")
    def _lengths(self) -> DosSpectrum:
        n = len(self.energies)
        for s in self.series:
            if len(s.dos) != n or len(s.occupied_dos) != n:
                msg = f"series {s.id} has {len(s.dos)} values, energy grid has {n}"
                raise ValueError(msg)
        return self


class KPathLabel(StrictModel):
    label: str
    distance: float = Field(description="position along the path (same axis as k_distance)")


class KPathPoint(StrictModel):
    label: str
    xk: Vec3 = Field(description="reciprocal (fractional) coordinates")


class BandStructure(StrictModel):
    k_distance: list[float] = Field(description="cumulative distance along the path")
    labels: list[KPathLabel]
    energies: list[list[list[float]]] = Field(
        description="eV; energies[spin][k][band] (one spin entry for non-polarized runs)"
    )
    fermi_level: float | None = Field(default=None, description="eV")
    homo_energy: float | None = Field(default=None, description="eV")

    @model_validator(mode="after")
    def _shapes(self) -> BandStructure:
        for spin in self.energies:
            if len(spin) != len(self.k_distance):
                msg = f"{len(spin)} k rows but {len(self.k_distance)} distances"
                raise ValueError(msg)
        return self


__all__ = ["BandStructure", "DosSeries", "DosSpectrum", "KPathLabel", "KPathPoint"]
