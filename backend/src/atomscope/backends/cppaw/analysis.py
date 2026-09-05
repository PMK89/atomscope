"""Post-processing analysis of a finished CP-PAW calculation: electronic bookkeeping shared by
the orbital browser, DOS and band-structure tools (labels, occupations, default k-paths)."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import numpy as np
from ase.cell import Cell as AseCell
from ase.dft.kpoints import parse_path_string
from pydantic import Field

from atomscope.backends.cppaw.protocol import Eigenvalues, parse_protocol_text
from atomscope.backends.cppaw.results import last_run
from atomscope.model import Structure, VolumetricGrid
from atomscope.model.common import StrictModel
from atomscope.model.spectrum import KPathPoint

AnalysisKind = Literal["dos", "bands", "orbitals"]
SPIN_NAMES: dict[int, Literal["up", "down", "none"]] = {1: "up", 2: "down"}


class OrbitalEntry(StrictModel):
    """One Kohn-Sham state as CP-PAW numbers it (1-based band, k-point and spin)."""

    band: int
    kpoint: int
    spin: int = Field(description="1 or 2; 1 for non-spin-polarized runs")
    energy: float = Field(description="eV")
    occupation: float
    label: str = Field(description="HOMO-n / HOMO / LUMO / LUMO+n")
    grid_id: str | None = Field(default=None, description="exported cube, if any")


@dataclass
class ElectronicInfo:
    eigenvalues: list[Eigenvalues] = field(default_factory=list)
    homo_by_spin: dict[int, int] = field(default_factory=dict)

    @property
    def n_spins(self) -> int:
        return max((e.spin for e in self.eigenvalues), default=1)

    @property
    def n_kpoints(self) -> int:
        return max((e.kpoint for e in self.eigenvalues), default=1)

    @property
    def n_bands(self) -> int:
        return max((len(e.energies_ev) for e in self.eigenvalues), default=0)

    def homo(self, spin: int) -> int | None:
        return self.homo_by_spin.get(spin, self.homo_by_spin.get(1))

    @property
    def homo_energy(self) -> float | None:
        """Highest occupied eigenvalue over all k-points and spins (eV)."""
        vals = [
            e.energies_ev[h - 1]
            for e in self.eigenvalues
            if (h := self.homo(e.spin)) is not None and 0 < h <= len(e.energies_ev)
        ]
        return max(vals) if vals else None


def electronic_info(work: Path, root: str) -> ElectronicInfo:
    prot = work / f"{root}.prot"
    if not prot.is_file():
        return ElectronicInfo()
    data = parse_protocol_text(last_run(prot.read_text(errors="replace")))
    eigs = data.eigenvalues[-1] if data.eigenvalues else []
    return ElectronicInfo(eigenvalues=eigs, homo_by_spin=dict(data.homo_band_index_by_spin))


def orbital_label(band: int, homo: int | None) -> str:
    if homo is None:
        return f"band {band}"
    d = band - homo
    if d == 0:
        return "HOMO"
    if d == 1:
        return "LUMO"
    return f"HOMO{d}" if d < 0 else f"LUMO+{d - 1}"


def _grid_matches(grid: VolumetricGrid, band: int, kpoint: int, spin: int) -> bool:
    o = grid.orbital
    if o is None or grid.kind != "orbital":
        return False
    spin_index = {"up": 1, "down": 2, "none": 1}[o.spin]
    return o.index == band - 1 and (o.kpoint or 1) == kpoint and spin_index == spin


def list_orbitals(info: ElectronicInfo, grids: list[VolumetricGrid]) -> list[OrbitalEntry]:
    out: list[OrbitalEntry] = []
    per_state = 2.0 if info.n_spins == 1 else 1.0
    for e in info.eigenvalues:
        homo = info.homo(e.spin)
        for i, energy in enumerate(e.energies_ev):
            band = i + 1
            grid = next((g for g in grids if _grid_matches(g, band, e.kpoint, e.spin)), None)
            out.append(
                OrbitalEntry(
                    band=band,
                    kpoint=e.kpoint,
                    spin=e.spin,
                    energy=energy,
                    occupation=per_state if homo is not None and band <= homo else 0.0,
                    label=orbital_label(band, homo),
                    grid_id=grid.id if grid else None,
                )
            )
    return out


def default_kpath(structure: Structure) -> list[KPathPoint]:
    """High-symmetry path of the structure's lattice (ASE); a break in the path is encoded as a
    point labelled ``,`` so that :func:`tools.path_segments` skips the jump."""
    if structure.cell is None or not structure.is_periodic():
        msg = "band structures need a periodic cell"
        raise ValueError(msg)
    cell = AseCell(np.array(structure.cell.vectors, dtype=float))  # type: ignore[no-untyped-call]
    bp = cell.bandpath()
    points: list[KPathPoint] = []
    for i, part in enumerate(parse_path_string(bp.path)):  # type: ignore[no-untyped-call]
        if i > 0:
            points.append(KPathPoint(label=",", xk=(0.0, 0.0, 0.0)))
        for name in part:
            xk = bp.special_points[name]
            points.append(KPathPoint(label=name, xk=(float(xk[0]), float(xk[1]), float(xk[2]))))
    return points


__all__ = [
    "AnalysisKind",
    "ElectronicInfo",
    "OrbitalEntry",
    "default_kpath",
    "electronic_info",
    "list_orbitals",
    "orbital_label",
]
