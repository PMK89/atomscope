"""Spectra: the generic plottable :class:`Spectrum` plus the electronic
(projected) densities of states and band structures. Energies in eV.

``Spectrum`` is the one shape the frontend plots: an x axis with unit and label, a y axis with
unit and label, an optional broadened curve and optional stick peaks with assignments. IR, Raman,
NMR, UV-Vis, CD, DOS and imported experimental data all use it, so the chart component needs no
per-spectrum-type knowledge.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from atomscope.model.common import Provenance, StrictModel, Vec3

Spin = Literal["up", "down", "none"]

SpectrumKind = Literal["ir", "raman", "nmr", "uvvis", "cd", "dos", "experimental", "other"]
LineShape = Literal["gaussian", "lorentzian"]


class SpectrumAxis(StrictModel):
    """One axis of a spectrum: what is plotted, in which unit, and in which direction."""

    label: str = Field(description="axis label, e.g. 'wavenumber'")
    unit: str = Field(description="free-form unit string, e.g. 'cm^-1', 'km/mol', 'ppm'")
    descending: bool = Field(
        default=False,
        description="draw the axis from high to low (IR wavenumbers, NMR chemical shifts)",
    )


class SpectrumPeak(StrictModel):
    """One stick: a transition at ``x`` with ``intensity`` in the spectrum's y unit."""

    x: float
    intensity: float
    label: str | None = Field(default=None, description="short label drawn next to the stick")
    assignment: str | None = Field(default=None, description="symmetry, nucleus, orbital pair ...")
    source_index: int | None = Field(
        default=None, description="index into the originating list (vibrational mode, transition)"
    )


class Spectrum(StrictModel):
    """A plottable spectrum: stick peaks and/or a sampled curve on a shared pair of axes."""

    id: str
    kind: SpectrumKind
    name: str
    x: SpectrumAxis
    y: SpectrumAxis
    peaks: list[SpectrumPeak] = Field(default_factory=list)
    x_values: list[float] = Field(default_factory=list, description="broadened curve grid")
    y_values: list[float] = Field(default_factory=list, description="broadened curve values")
    line_shape: LineShape | None = Field(default=None, description="shape used for the curve")
    width: float | None = Field(default=None, description="FWHM of the line shape, x units")
    provenance: Provenance | None = None

    @model_validator(mode="after")
    def _lengths(self) -> Spectrum:
        if len(self.x_values) != len(self.y_values):
            msg = f"{len(self.x_values)} x values but {len(self.y_values)} y values"
            raise ValueError(msg)
        return self


class DosSeries(StrictModel):
    """One weight (total, per atom, per angular momentum ...) in one spin channel.

    ``dos`` counts all states, ``occupied_dos`` weights them with the occupations; both in
    states/eV. Spin-down series are stored as written by the code (negative sign) so that
    mirrored plots need no extra convention.
    """

    id: str = Field(description="weight id, e.g. 'total', 'SI1_p'")
    label: str
    spin: Spin = "none"
    kind: Literal["dos", "coop"] = Field(
        default="dos",
        description="a COOP is a population, not a count: it is negative where antibonding,"
        " so it is plotted about zero rather than stacked",
    )
    group: str | None = Field(
        default=None,
        description="id of the weight this one is part of, and its own id when it is a whole atom"
        " or element. None for the total and for hand-built orbital weights, which overlap"
        " whatever else was asked for. Series sharing a group partition it, so they can be"
        " stacked; series with no group cannot.",
    )
    channel: str | None = Field(
        default=None, description="'s', 'p', 'd' or 'f' when this is one channel of its group"
    )
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


class NmrShielding(StrictModel):
    """One nucleus' magnetic shielding tensor summary, as printed by NMR codes (ppm)."""

    index: int = Field(description="0-based atom index in the structure")
    element: str
    isotropic: float = Field(description="ppm, 1/3 tr(sigma)")
    anisotropic: float | None = Field(default=None, description="ppm")


class ElectronicTransition(StrictModel):
    """One electronic excitation, for UV-Vis and CD spectra."""

    energy: float | None = Field(default=None, description="eV")
    wavelength: float = Field(description="nm")
    oscillator_strength: float | None = Field(default=None, description="dimensionless")
    rotatory_strength: float | None = Field(default=None, description="10^-40 erg cm^3")
    label: str | None = None


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


__all__ = [
    "BandStructure",
    "DosSeries",
    "DosSpectrum",
    "ElectronicTransition",
    "KPathLabel",
    "KPathPoint",
    "LineShape",
    "NmrShielding",
    "Spectrum",
    "SpectrumAxis",
    "SpectrumKind",
    "SpectrumPeak",
]
