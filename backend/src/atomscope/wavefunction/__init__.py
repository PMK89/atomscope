"""Molecular wavefunctions: readers (Gaussian fchk, Molden) and volumetric field generation."""

from atomscope.wavefunction.cubes import (
    EvaluationCancelledError,
    EvaluationHooks,
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
from atomscope.wavefunction.gamess import read_gamess
from atomscope.wavefunction.model import MolecularOrbital, Shell, Wavefunction
from atomscope.wavefunction.molden import read_molden

__all__ = [
    "EvaluationCancelledError",
    "EvaluationHooks",
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
    "read_gamess",
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
    if suffix in (".gamess", ".gamout") or stem_suffix in (".gamess", ".gamout"):
        return read_gamess(p)
    head = _head(p)
    if "[Molden Format]" in head or "[Atoms]" in head:
        return read_molden(p)
    # a GAMESS log is prose; the banner is the only thing at the top that names the program
    if "GAMESS VERSION" in head or "GAMESS execution script" in head:
        return read_gamess(p)
    return read_fchk(p)


def _head(path: "Path", n: int = 4000) -> str:  # type: ignore[name-defined] # noqa: F821
    """The first bytes as text, through gzip when the file is compressed."""
    import gzip  # noqa: PLC0415

    if path.suffix == ".gz":
        with gzip.open(path, "rt", errors="replace") as fh:
            return str(fh.read(n))
    # `Path` is only a forward reference here (the import is deferred), so spell out the type
    return str(path.open("rb").read(n).decode(errors="replace"))
