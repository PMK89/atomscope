"""Gaussian cube file reader.

Format (all lengths in Bohr, values in the file's own unit):

    line 1-2  comments
    line 3    NATOMS  OX OY OZ            (NATOMS < 0 => an orbital-list line follows the atoms)
    line 4-6  N1 V1x V1y V1z  (etc.)      grid axes; negative N means Å instead of Bohr
    NATOMS    Z  CHARGE  X Y Z
    [if NATOMS<0] NORB  IDX1 IDX2 ...
    values    fastest index = third axis, 6 per line

CP-PAW's `paw_wave.x` writes this format (with periodic images of atoms inside the view box).
"""

from __future__ import annotations

import gzip
from pathlib import Path

import numpy as np
from ase.data import chemical_symbols
from ase.units import Bohr

from atomscope.model import Atom, Provenance, Structure, VolumetricGrid, new_uid
from atomscope.model.grid import GridKind
from atomscope.units import Unit

#: values per data line, as written by every cube producer
VALUES_PER_LINE = 6


class CubeData:
    """Result of reading a cube: grid metadata, values (C-order, shape) and atoms."""

    def __init__(self, grid: VolumetricGrid, values: np.ndarray, structure: Structure) -> None:
        self.grid = grid
        self.values = values
        self.structure = structure


def _open(path: Path):  # type: ignore[no-untyped-def]  # noqa: ANN202
    return gzip.open(path, "rt") if path.suffix == ".gz" else path.open("rt")


def read_cube(path: Path, *, kind: GridKind = "other", unit: Unit = Unit.E_PER_BOHR3) -> CubeData:
    with _open(path) as fh:
        title = fh.readline().strip()
        fh.readline()
        parts = fh.readline().split()
        natoms = int(parts[0])
        origin = np.array(parts[1:4], dtype=float)
        shape: list[int] = []
        axes = np.zeros((3, 3))
        scale = [Bohr, Bohr, Bohr]
        for i in range(3):
            p = fh.readline().split()
            n = int(p[0])
            if n < 0:
                n = -n
                scale[i] = 1.0
            shape.append(n)
            axes[i] = np.array(p[1:4], dtype=float) * scale[i]
        origin_ang = origin * Bohr
        atoms = []
        for _ in range(abs(natoms)):
            p = fh.readline().split()
            z = int(float(p[0]))
            pos = np.array(p[2:5], dtype=float) * Bohr
            atoms.append(Atom(element=chemical_symbols[z], position=(pos[0], pos[1], pos[2])))
        if natoms < 0:
            fh.readline()  # orbital index line; not needed for a single-orbital cube
        data = np.fromstring(fh.read(), sep=" ", dtype=np.float64)
    n_total = shape[0] * shape[1] * shape[2]
    if data.size < n_total:
        msg = f"cube {path.name}: expected {n_total} values, found {data.size}"
        raise ValueError(msg)
    values = data[:n_total].reshape(shape[0], shape[1], shape[2])
    structure = Structure(name=title or path.stem, atoms=atoms)
    grid = VolumetricGrid(
        id=new_uid(),
        name=title or path.stem,
        kind=kind,
        origin=(float(origin_ang[0]), float(origin_ang[1]), float(origin_ang[2])),
        axes=(tuple(axes[0]), tuple(axes[1]), tuple(axes[2])),
        shape=(shape[0], shape[1], shape[2]),
        unit=unit,
        dtype="float64",
        data_ref=str(path),
        structure_id=structure.id,
        provenance=Provenance(source=str(path)),
    )
    return CubeData(grid, values, structure)


def write_cube(path: Path, grid: VolumetricGrid, values: np.ndarray, structure: Structure) -> None:
    """Write a cube with lengths in Bohr (the conventional choice)."""
    origin = np.array(grid.origin) / Bohr
    with path.open("w") as fh:
        fh.write(f"{grid.name}\nwritten by Atomscope\n")
        fh.write(f"{structure.n_atoms:5d} {origin[0]:12.6f} {origin[1]:12.6f} {origin[2]:12.6f}\n")
        for n, ax in zip(grid.shape, grid.axes, strict=True):
            v = np.array(ax) / Bohr
            fh.write(f"{n:5d} {v[0]:12.6f} {v[1]:12.6f} {v[2]:12.6f}\n")
        for a in structure.atoms:
            p = np.array(a.position) / Bohr
            z = a.atomic_number
            fh.write(f"{z:5d} {float(z):12.6f} {p[0]:12.6f} {p[1]:12.6f} {p[2]:12.6f}\n")
        # One %-format call per line instead of six f-strings plus a join: a 256^3 grid is
        # 2.8 million lines and the per-value formatting dominated the write (see
        # docs/performance.md). The bytes produced are identical.
        flat = np.asarray(values, dtype=float).reshape(-1).tolist()
        full = len(flat) - len(flat) % VALUES_PER_LINE
        row = " ".join(["%13.5E"] * VALUES_PER_LINE) + "\n"
        fh.writelines(row % tuple(flat[i : i + VALUES_PER_LINE]) for i in range(0, full, VALUES_PER_LINE))
        if full != len(flat):
            tail = flat[full:]
            fh.write(" ".join(["%13.5E"] * len(tail)) % tuple(tail) + "\n")
