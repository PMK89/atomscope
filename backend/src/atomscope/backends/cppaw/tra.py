# ruff: noqa: E501, PLR0912, PLR0915, S603
"""Reader for CP-PAW binary trajectories (``ROOT_r.tra``, ``_e.tra``).

Fortran sequential unformatted records (``paw_iotra.f90``): each record is
``int32 ISTEP, float64 TIME (a.u.), int32 NSIZE, float64 ARRAY[NSIZE]`` wrapped in 4-byte
record markers. ``_r.tra`` holds NSIZE = 9 + 8·NAT doubles: lattice (9, column-major, Bohr),
positions (3·NAT, Bohr), point charges (NAT), then (q, mx, my, mz) per atom. Files are opened
in APPEND mode by CP-PAW, so several runs may be concatenated; ISTEP restarts at 1 per run.
"""

from __future__ import annotations

import struct
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from ase.units import Bohr, _aut


@dataclass
class TraRecord:
    istep: int
    time_au: float
    data: np.ndarray


def iter_records(path: Path) -> Iterator[TraRecord]:
    with path.open("rb") as fh:
        while True:
            marker = fh.read(4)
            if len(marker) < 4:
                return
            (n,) = struct.unpack("<i", marker)
            rec = fh.read(n)
            fh.read(4)
            if len(rec) < 16:
                return
            istep, time, nsize = struct.unpack_from("<idi", rec, 0)
            data = np.frombuffer(rec, dtype="<f8", count=nsize, offset=16)
            yield TraRecord(istep, time, data)


@dataclass
class PositionTrajectory:
    steps: list[int]
    times_fs: list[float]
    cells_ang: list[np.ndarray]
    positions_ang: list[np.ndarray]
    charges: list[np.ndarray]


def read_position_trajectory(
    path: Path, n_atoms: int, *, last_run_only: bool = True
) -> PositionTrajectory:
    """Decode ``_r.tra``. With ``last_run_only`` only records after the last ISTEP reset are kept."""
    recs = list(iter_records(path))
    if last_run_only:
        start = 0
        for i in range(1, len(recs)):
            if recs[i].istep <= recs[i - 1].istep:
                start = i
        recs = recs[start:]
    out = PositionTrajectory([], [], [], [], [])
    expected = 9 + 8 * n_atoms
    au_to_fs = _aut * 1e15
    for r in recs:
        if r.data.size < 9 + 3 * n_atoms:
            continue
        if r.data.size != expected:
            # tolerate older layouts as long as lattice + positions fit
            pass
        cell = r.data[:9].reshape(3, 3) * Bohr  # column-major RBAS -> rows are lattice vectors
        pos = r.data[9 : 9 + 3 * n_atoms].reshape(n_atoms, 3) * Bohr
        q = (
            r.data[9 + 3 * n_atoms : 9 + 4 * n_atoms]
            if r.data.size >= 9 + 4 * n_atoms
            else np.zeros(n_atoms)
        )
        out.steps.append(r.istep)
        out.times_fs.append(r.time_au * au_to_fs)
        out.cells_ang.append(cell)
        out.positions_ang.append(pos)
        out.charges.append(np.array(q))
    return out
