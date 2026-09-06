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
from atomscope.wavefunction.molpro import read_molpro
from atomscope.wavefunction.orca import read_orca

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
    "read_molpro",
    "read_orca",
    "read_wavefunction",
    "spin_density_values",
    "vdw_values",
]


# The readers a file name picks out, and the markers that name the program when it does not.
# A GAMESS log and an ORCA output are prose; their banners are the only thing at the top that
# says which program wrote them.
_BY_SUFFIX = {
    ".fchk": read_fchk,
    ".fch": read_fchk,
    ".molden": read_molden,
    ".mold": read_molden,
    ".input": read_molden,
    ".gamess": read_gamess,
    ".gamout": read_gamess,
    ".orcaout": read_orca,
    ".mpo": read_molpro,
}
_BY_BANNER = (
    ("O   R   C   A", read_orca),
    ("PROGRAM SYSTEM MOLPRO", read_molpro),
    ("[Molden Format]", read_molden),
    ("[Atoms]", read_molden),
    ("GAMESS VERSION", read_gamess),
    ("GAMESS execution script", read_gamess),
)


def read_wavefunction(path: "Path") -> Wavefunction:  # type: ignore[name-defined] # noqa: F821
    """Read a wavefunction, choosing the reader from the file name and first lines."""
    from pathlib import Path  # noqa: PLC0415

    p = Path(path)
    suffix = p.suffix.lower()
    if suffix == ".gz":
        suffix = Path(p.stem).suffix.lower()
    reader = _BY_SUFFIX.get(suffix)
    if reader is not None:
        return reader(p)
    head = _head(p)
    for marker, by_banner in _BY_BANNER:
        if marker in head:
            return by_banner(p)
    return read_fchk(p)


def _head(path: "Path", n: int = 4000) -> str:  # type: ignore[name-defined] # noqa: F821
    """The first bytes as text, through gzip when the file is compressed."""
    import gzip  # noqa: PLC0415

    if path.suffix == ".gz":
        with gzip.open(path, "rt", errors="replace") as fh:
            return str(fh.read(n))
    # `Path` is only a forward reference here (the import is deferred), so spell out the type
    return str(path.open("rb").read(n).decode(errors="replace"))
