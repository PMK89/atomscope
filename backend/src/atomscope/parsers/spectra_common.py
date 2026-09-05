"""Shared result shape and helpers for the spectroscopy output parsers.

Every parser in this package reads one program's output text and returns a
:class:`ParsedSpectra`: the geometry the data belongs to plus whatever spectroscopic blocks the
file contained. Missing blocks are ``None`` or empty lists, never zeros (see
``docs/architecture/output-parsing.md``).
"""

from __future__ import annotations

import numpy as np
from pydantic import Field

from atomscope.model import (
    Atom,
    ElectronicTransition,
    NmrShielding,
    Provenance,
    Structure,
    VibrationalMode,
    VibrationalSpectrum,
    new_uid,
)
from atomscope.model.common import StrictModel, Vec3


class SpectraParseError(ValueError):
    """Raised when a file does not contain the block a parser was asked for."""


class ParsedSpectra(StrictModel):
    """Spectroscopic data read from one output file."""

    program: str
    symbols: list[str] = Field(default_factory=list)
    positions: list[Vec3] = Field(default_factory=list, description="Å")
    vibrations: VibrationalSpectrum | None = None
    shieldings: list[NmrShielding] = Field(default_factory=list)
    transitions: list[ElectronicTransition] = Field(default_factory=list)

    def structure(self, name: str) -> Structure | None:
        """The geometry as a Structure, or None when the file carried no coordinates."""
        if not self.symbols:
            return None
        return Structure(
            name=name,
            atoms=[
                Atom(element=s, position=p)
                for s, p in zip(self.symbols, self.positions, strict=True)
            ],
            provenance=Provenance(source=name, software=self.program),
        )


def normalized_modes(
    frequencies: list[float],
    vectors: np.ndarray,
    *,
    ir: list[float | None] | None = None,
    raman: list[float | None] | None = None,
    symmetries: list[str | None] | None = None,
) -> list[VibrationalMode]:
    """Build modes from ``vectors`` of shape (n_modes, n_atoms, 3), renormalising each mode.

    Gaussian and ORCA print Cartesian displacement vectors that are normalised to unit length
    over all atoms, but rounded to two or six decimals; renormalising here makes the stored
    convention exact regardless of the printed precision.
    """
    modes: list[VibrationalMode] = []
    for k, freq in enumerate(frequencies):
        v = np.asarray(vectors[k], dtype=float)
        norm = float(np.linalg.norm(v))
        if norm > 0:
            v = v / norm
        modes.append(
            VibrationalMode(
                frequency=float(freq),
                displacements=[(float(a[0]), float(a[1]), float(a[2])) for a in v],
                ir_intensity=None if ir is None else ir[k],
                raman_activity=None if raman is None else raman[k],
                symmetry=None if symmetries is None else symmetries[k],
            )
        )
    return modes


def vibrational_spectrum(
    modes: list[VibrationalMode],
    symbols: list[str],
    positions: list[Vec3],
    method: str,
    *,
    source: str,
) -> VibrationalSpectrum:
    """Wrap parsed modes; the zero-point energy is the sum over the real frequencies."""
    from ase import units  # noqa: PLC0415

    zpe = 0.5 * sum(m.frequency for m in modes if m.frequency > 0) * units.invcm
    return VibrationalSpectrum(
        id=new_uid(),
        symbols=symbols,
        positions=positions,
        modes=modes,
        zero_point_energy=zpe,
        method=method,
        provenance=Provenance(source=source, software=method),
    )


__all__ = [
    "ElectronicTransition",
    "NmrShielding",
    "ParsedSpectra",
    "SpectraParseError",
    "normalized_modes",
    "vibrational_spectrum",
]
