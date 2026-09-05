"""Build plottable :class:`Spectrum` objects from modes, transitions and shieldings.

Every spectrum type reduces to the same two steps: pick the x/y axes and turn the underlying data
into stick peaks, then broaden the sticks with :mod:`atomscope.analysis.broadening`. Avogadro 1
does the same thing per tab in ``libavogadro/src/extensions/spectra`` (``ir.cpp``, ``raman.cpp``,
``nmr.cpp``, ``uv.cpp``, ``cd.cpp``); here it is one function with different axes.
"""

from __future__ import annotations

import numpy as np

from atomscope.analysis.broadening import auto_grid, broaden, to_transmittance
from atomscope.model import (
    ElectronicTransition,
    NmrShielding,
    Provenance,
    Spectrum,
    SpectrumAxis,
    SpectrumKind,
    SpectrumPeak,
    VibrationalSpectrum,
    new_uid,
)
from atomscope.model.spectrum import LineShape

WAVENUMBER = SpectrumAxis(label="wavenumber", unit="cm^-1", descending=True)
IR_INTENSITY = SpectrumAxis(label="IR intensity", unit="km/mol")
TRANSMITTANCE = SpectrumAxis(label="transmittance", unit="%")
RAMAN_ACTIVITY = SpectrumAxis(label="Raman activity", unit="A^4/amu")
CHEMICAL_SHIFT = SpectrumAxis(label="chemical shift", unit="ppm", descending=True)
NMR_INTENSITY = SpectrumAxis(label="relative intensity", unit="")
WAVELENGTH = SpectrumAxis(label="wavelength", unit="nm")
EPSILON = SpectrumAxis(label="oscillator strength", unit="")
ROTATORY = SpectrumAxis(label="rotatory strength", unit="10^-40 erg cm^3")


def build_spectrum(
    peaks: list[SpectrumPeak],
    *,
    kind: SpectrumKind,
    name: str,
    x_axis: SpectrumAxis,
    y_axis: SpectrumAxis,
    width: float | None = None,
    shape: LineShape = "gaussian",
    points: int = 1000,
    provenance: Provenance | None = None,
) -> Spectrum:
    """Sticks plus, when ``width`` is given, the broadened curve on an automatic grid."""
    x_values: list[float] = []
    y_values: list[float] = []
    if width is not None and peaks:
        centers = np.array([p.x for p in peaks], dtype=float)
        intensities = np.array([p.intensity for p in peaks], dtype=float)
        grid = auto_grid(centers, width, points=points)
        curve = broaden(grid, centers, intensities, width, shape)
        x_values = [float(v) for v in grid]
        y_values = [float(v) for v in curve]
    return Spectrum(
        id=new_uid(),
        kind=kind,
        name=name,
        x=x_axis,
        y=y_axis,
        peaks=peaks,
        x_values=x_values,
        y_values=y_values,
        line_shape=shape if width is not None else None,
        width=width,
        provenance=provenance,
    )


def ir_spectrum(
    vibrations: VibrationalSpectrum,
    *,
    width: float = 30.0,
    shape: LineShape = "gaussian",
    scale_factor: float = 1.0,
    transmittance: bool = False,
    transmittance_scale: float = 0.01,
    points: int = 1000,
) -> Spectrum:
    """IR spectrum from the modes' IR intensities.

    ``scale_factor`` multiplies the frequencies -- the usual empirical correction for harmonic
    frequencies (Avogadro 1's "Scale by" field; see NIST CCCBDB scaling factors). Modes without
    an intensity (e.g. imported files that print none) contribute a zero-height stick so that the
    mode list and the plot stay index-aligned.
    """
    peaks = [
        SpectrumPeak(
            x=m.frequency * scale_factor,
            intensity=m.ir_intensity or 0.0,
            label=f"{m.frequency * scale_factor:.0f}",
            assignment=m.symmetry,
            source_index=i,
        )
        for i, m in enumerate(vibrations.modes)
    ]
    spectrum = build_spectrum(
        peaks,
        kind="ir",
        name="IR spectrum",
        x_axis=WAVENUMBER,
        y_axis=IR_INTENSITY,
        width=width,
        shape=shape,
        points=points,
        provenance=vibrations.provenance,
    )
    if not transmittance:
        return spectrum
    curve = to_transmittance(np.array(spectrum.y_values), transmittance_scale)
    return spectrum.model_copy(update={"y": TRANSMITTANCE, "y_values": [float(v) for v in curve]})


def raman_spectrum(
    vibrations: VibrationalSpectrum,
    *,
    width: float = 30.0,
    shape: LineShape = "gaussian",
    scale_factor: float = 1.0,
    points: int = 1000,
) -> Spectrum:
    """Raman spectrum from the modes' Raman activities (only imported files carry them)."""
    peaks = [
        SpectrumPeak(
            x=m.frequency * scale_factor,
            intensity=m.raman_activity or 0.0,
            label=f"{m.frequency * scale_factor:.0f}",
            assignment=m.symmetry,
            source_index=i,
        )
        for i, m in enumerate(vibrations.modes)
    ]
    return build_spectrum(
        peaks,
        kind="raman",
        name="Raman spectrum",
        x_axis=WAVENUMBER,
        y_axis=RAMAN_ACTIVITY,
        width=width,
        shape=shape,
        points=points,
        provenance=vibrations.provenance,
    )


def nmr_spectrum(
    shieldings: list[NmrShielding],
    element: str,
    *,
    reference: float = 0.0,
    width: float = 0.05,
    shape: LineShape = "lorentzian",
    points: int = 1000,
) -> Spectrum:
    """1D NMR spectrum of one nucleus: chemical shift ``delta = sigma_ref - sigma``.

    ``reference`` is the shielding of the standard (TMS for 1H/13C) in the same calculation and
    basis set; with the default of 0 the plot shows negated absolute shieldings, which is what
    Avogadro 1 does until the user types a reference (``nmr.cpp``).
    """
    selected = [s for s in shieldings if s.element == element]
    peaks = [
        SpectrumPeak(
            x=reference - s.isotropic,
            intensity=1.0,
            label=f"{s.element}{s.index + 1}",
            assignment=f"atom {s.index + 1}",
            source_index=s.index,
        )
        for s in selected
    ]
    return build_spectrum(
        peaks,
        kind="nmr",
        name=f"{element} NMR",
        x_axis=CHEMICAL_SHIFT,
        y_axis=NMR_INTENSITY,
        width=width,
        shape=shape,
        points=points,
    )


def uvvis_spectrum(
    transitions: list[ElectronicTransition],
    *,
    width: float = 20.0,
    shape: LineShape = "gaussian",
    points: int = 1000,
) -> Spectrum:
    """UV-Vis absorption: oscillator strength vs wavelength."""
    peaks = [
        SpectrumPeak(
            x=t.wavelength,
            intensity=t.oscillator_strength or 0.0,
            label=f"{t.wavelength:.0f}",
            assignment=t.label,
            source_index=i,
        )
        for i, t in enumerate(transitions)
    ]
    return build_spectrum(
        peaks,
        kind="uvvis",
        name="UV-Vis spectrum",
        x_axis=WAVELENGTH,
        y_axis=EPSILON,
        width=width,
        shape=shape,
        points=points,
    )


def cd_spectrum(
    transitions: list[ElectronicTransition],
    *,
    width: float = 20.0,
    shape: LineShape = "gaussian",
    points: int = 1000,
) -> Spectrum:
    """Electronic circular dichroism: rotatory strength vs wavelength (signed)."""
    peaks = [
        SpectrumPeak(
            x=t.wavelength,
            intensity=t.rotatory_strength or 0.0,
            label=f"{t.wavelength:.0f}",
            assignment=t.label,
            source_index=i,
        )
        for i, t in enumerate(transitions)
    ]
    return build_spectrum(
        peaks,
        kind="cd",
        name="CD spectrum",
        x_axis=WAVELENGTH,
        y_axis=ROTATORY,
        width=width,
        shape=shape,
        points=points,
    )


__all__ = [
    "build_spectrum",
    "cd_spectrum",
    "ir_spectrum",
    "nmr_spectrum",
    "raman_spectrum",
    "uvvis_spectrum",
]
