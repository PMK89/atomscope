"""Representative test data for the benchmarks, generated once and cached in .scratch/bench.

Two structure families are used everywhere:

``bulk``       ``ase.build.bulk("Cu", cubic=True).repeat(r)`` -- a periodic FCC crystal, the
               shape of a solid-state calculation (dense, every atom has 12 neighbours).
``protein``    copies of the Avogadro test file ``1CRN.pdb`` (crambin, 327 atoms) placed on a
               30 Å lattice -- molecular, non-periodic, realistic bond density and element mix.

Volumetric grids are smooth sums of Gaussians so that isovalue statistics are meaningful.
Cube fixtures are written by a private NumPy writer, *not* by ``atomscope.parsers.cube``, so the
files exist independently of the writer that is itself under measurement.
"""

from __future__ import annotations

import os
import struct
from functools import lru_cache
from pathlib import Path

import numpy as np
from ase import Atoms
from ase.build import bulk
from ase.units import Bohr

from atomscope.ase_bridge.convert import from_atoms
from atomscope.model import Structure

#: Crambin (1CRN), from the copy of the Avogadro 1 test file that lives in this repository, so a
#: benchmark run needs nothing outside it. `ATOMSCOPE_BENCH_PDB` overrides it.
CRAMBIN = Path(
    os.environ.get(
        "ATOMSCOPE_BENCH_PDB",
        str(Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "bio" / "1crn.pdb"),
    )
)

#: repeat factors giving ~1e3 / 1e4 / 1e5 atoms of cubic FCC copper (4 atoms per cell).
BULK_REPEATS: dict[str, int] = {"1e3": 6, "1e4": 14, "1e5": 29}
#: number of crambin copies giving ~1e3 / 1e4 / 1e5 atoms (327 atoms each).
PROTEIN_COPIES: dict[str, int] = {"1e3": 3, "1e4": 31, "1e5": 306}

SIZES: tuple[str, ...] = ("1e3", "1e4", "1e5")
GRID_SHAPES: dict[str, int] = {"80": 80, "160": 160, "256": 256}


def root() -> Path:
    """Cache directory for generated fixtures (inside the gitignored scratch tree)."""
    d = Path(
        os.environ.get(
            "ATOMSCOPE_BENCH_DIR", Path(__file__).resolve().parents[2] / ".scratch" / "bench"
        )
    )
    (d / "fixtures").mkdir(parents=True, exist_ok=True)
    return d / "fixtures"


# ---- structures ---------------------------------------------------------------------------


@lru_cache(maxsize=8)
def bulk_atoms(size: str) -> Atoms:
    """Periodic FCC copper with roughly ``size`` atoms."""
    return bulk("Cu", cubic=True).repeat(BULK_REPEATS[size])


@lru_cache(maxsize=8)
def protein_atoms(size: str) -> Atoms:
    """``PROTEIN_COPIES[size]`` copies of crambin on a 30 Å lattice, non-periodic."""
    import ase.io  # noqa: PLC0415 - keep module import cost out of the import baseline

    if not CRAMBIN.is_file():
        msg = f"benchmark PDB {CRAMBIN} not found (set ATOMSCOPE_BENCH_PDB)"
        raise FileNotFoundError(msg)
    one = ase.io.read(str(CRAMBIN), format="proteindatabank")
    one.set_cell(None)
    one.set_pbc(False)
    n = PROTEIN_COPIES[size]
    side = int(np.ceil(n ** (1 / 3)))
    offsets = np.array(
        [(k % side, (k // side) % side, k // (side * side)) for k in range(n)], dtype=float
    )
    positions = (one.get_positions()[None, :, :] + 30.0 * offsets[:, None, :]).reshape(-1, 3)
    return Atoms(symbols=one.get_chemical_symbols() * n, positions=positions, pbc=False)


def structure(family: str, size: str) -> Structure:
    """A fresh ``Structure`` (no bonds) for ``family`` in {bulk, protein}."""
    atoms = bulk_atoms(size) if family == "bulk" else protein_atoms(size)
    return from_atoms(atoms, name=f"{family}-{size}")


def bonded_structure(size: str) -> Structure:
    """The periodic bulk structure with real perceived bonds (~12 per atom, the worst case)."""
    from atomscope.chem.bonds import perceive_bonds  # noqa: PLC0415 - avoids an import cycle

    s = structure("bulk", size)
    s.bonds = perceive_bonds(s)
    return s


# ---- structure files ----------------------------------------------------------------------

#: format -> (extension, family) for the file IO benchmarks
IO_FORMATS: dict[str, tuple[str, str]] = {
    "xyz": ("xyz", "bulk"),
    "extxyz": ("extxyz", "bulk"),
    "cif": ("cif", "bulk"),
    "pdb": ("pdb", "protein"),
}


def structure_file(fmt: str, size: str) -> Path:
    """Path to a cached structure file, written with ASE on first use."""
    import ase.io  # noqa: PLC0415

    ext, family = IO_FORMATS[fmt]
    path = root() / f"{family}-{size}.{ext}"
    if not path.is_file():
        atoms = bulk_atoms(size) if family == "bulk" else protein_atoms(size)
        ase_fmt = {"pdb": "proteindatabank"}.get(fmt, fmt)
        ase.io.write(str(path), atoms, format=ase_fmt)
    return path


# ---- volumetric grids ---------------------------------------------------------------------


def grid_values(n: int) -> np.ndarray:
    """A smooth positive (n,n,n) field: four Gaussians on the diagonal."""
    ax = np.linspace(-1.0, 1.0, n)
    x, y, z = np.meshgrid(ax, ax, ax, indexing="ij")
    out = np.zeros((n, n, n))
    for c in (-0.5, -0.15, 0.2, 0.55):
        out += np.exp(-12.0 * ((x - c) ** 2 + (y - c * 0.4) ** 2 + (z + c * 0.7) ** 2))
    return out


def cube_file(n: int) -> Path:
    """Path to a cached Gaussian cube of shape (n,n,n) with 4 atoms."""
    path = root() / f"grid-{n}.cube"
    if path.is_file():
        return path
    values = grid_values(n)
    step = 0.25 / Bohr  # Bohr per voxel
    lines = [
        "benchmark grid",
        "generated by benchmarks.fixtures",
        "    4     0.000000     0.000000     0.000000",
    ]
    for i in range(3):
        v = [0.0, 0.0, 0.0]
        v[i] = step
        lines.append(f"{n:5d} {v[0]:12.6f} {v[1]:12.6f} {v[2]:12.6f}")
    for k in range(4):
        p = (k + 1) * n * step / 5.0
        lines.append(f"{8:5d} {8.0:12.6f} {p:12.6f} {p:12.6f} {p:12.6f}")
    flat = values.reshape(-1)
    pad = (-flat.size) % 6
    block = np.concatenate([flat, np.zeros(pad)]).reshape(-1, 6)
    with path.open("w", encoding="ascii") as fh:
        fh.write("\n".join(lines) + "\n")
        np.savetxt(fh, block, fmt="%13.5E", delimiter=" ")
    if pad:  # trim the padding values from the final line
        text = path.read_text(encoding="ascii").rstrip("\n").rsplit("\n", 1)
        last = text[1].split()[: 6 - pad]
        path.write_text(text[0] + "\n" + " ".join(last) + "\n", encoding="ascii")
    return path


# ---- trajectories -------------------------------------------------------------------------


def tra_file(n_frames: int, n_atoms: int) -> Path:
    """A synthetic CP-PAW ``_r.tra``: Fortran sequential records, 9 + 8*NAT doubles each."""
    path = root() / f"traj-{n_frames}x{n_atoms}_r.tra"
    if path.is_file():
        return path
    rng = np.random.default_rng(7)
    nsize = 9 + 8 * n_atoms
    header = struct.Struct("<idi")
    payload_len = header.size + 8 * nsize
    base = rng.normal(size=(n_atoms, 3)) * 10.0
    with path.open("wb") as fh:
        for step in range(1, n_frames + 1):
            data = np.zeros(nsize)
            data[:9] = np.eye(3).reshape(-1) * 20.0
            data[9 : 9 + 3 * n_atoms] = (base + 0.01 * step).reshape(-1)
            fh.write(struct.pack("<i", payload_len))
            fh.write(header.pack(step, step * 10.0, nsize))
            fh.write(data.astype("<f8").tobytes())
            fh.write(struct.pack("<i", payload_len))
    return path


def extxyz_trajectory(n_frames: int, n_atoms: int) -> Path:
    """A multi-frame extxyz file with per-frame energy (the ASE trajectory import path)."""
    import ase.io  # noqa: PLC0415
    from ase.calculators.singlepoint import SinglePointCalculator  # noqa: PLC0415

    path = root() / f"traj-{n_frames}x{n_atoms}.extxyz"
    if path.is_file():
        return path
    rng = np.random.default_rng(11)
    base = bulk_atoms("1e3")[:n_atoms]
    images = []
    for step in range(n_frames):
        img = base.copy()
        img.positions += rng.normal(scale=0.01, size=img.positions.shape)
        img.calc = SinglePointCalculator(img, energy=-1000.0 - 0.001 * step)
        images.append(img)
    ase.io.write(str(path), images, format="extxyz")
    return path


def prepare(*, full: bool) -> list[str]:
    """Generate every cached fixture up front so case timeouts measure work, not setup."""
    made: list[str] = []
    sizes = SIZES if full else SIZES[:2]
    for size in sizes:
        for fmt in IO_FORMATS:
            # ASE's CIF reader is O(N^2) in the number of sites; writing stays cheap.
            made.append(str(structure_file(fmt, size)))
    for label, n in GRID_SHAPES.items():
        if full or label == "80":
            made.append(str(cube_file(n)))
    for frames in (200, 1000) if full else (200,):
        made.append(str(tra_file(frames, 100)))
        made.append(str(extxyz_trajectory(frames, 100)))
    return made


__all__ = [
    "BULK_REPEATS",
    "CRAMBIN",
    "GRID_SHAPES",
    "IO_FORMATS",
    "PROTEIN_COPIES",
    "SIZES",
    "bonded_structure",
    "bulk_atoms",
    "cube_file",
    "extxyz_trajectory",
    "grid_values",
    "protein_atoms",
    "prepare",
    "root",
    "structure",
    "structure_file",
    "tra_file",
]
