"""Molecular wavefunctions: readers (Gaussian fchk, Molden) and volumetric field generation."""

from atomscope.wavefunction.cubes import (
    GridBox,
    bounding_box,
    density_values,
    electrostatic_potential_values,
    make_grid,
    orbital_values,
    spin_density_values,
    vdw_values,
)
from atomscope.wavefunction.fchk import read_fchk
from atomscope.wavefunction.model import MolecularOrbital, Shell, Wavefunction
from atomscope.wavefunction.molden import read_molden

__all__ = [
    "GridBox",
    "MolecularOrbital",
    "Shell",
    "Wavefunction",
    "bounding_box",
    "density_values",
    "electrostatic_potential_values",
    "make_grid",
    "orbital_values",
    "read_fchk",
    "read_molden",
    "read_wavefunction",
    "spin_density_values",
    "vdw_values",
]


def read_wavefunction(path: "Path") -> Wavefunction:  # type: ignore[name-defined] # noqa: F821
    """Read a wavefunction, choosing the reader from the file name and first lines."""
    from pathlib import Path  # noqa: PLC0415

    p = Path(path)
    suffix = p.suffix.lower()
    stem_suffix = Path(p.stem).suffix.lower() if suffix == ".gz" else ""
    if suffix in (".fchk", ".fch") or stem_suffix in (".fchk", ".fch"):
        return read_fchk(p)
    if suffix in (".molden", ".mold", ".input") or stem_suffix in (".molden", ".mold"):
        return read_molden(p)
    head = p.open("rb").read(400).decode(errors="replace")
    if "[Molden Format]" in head or "[Atoms]" in head:
        return read_molden(p)
    return read_fchk(p)
