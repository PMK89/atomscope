"""Read the band files of ``paw_bands.x`` into a :class:`BandStructure`.

Rows are ``x E1 ... ENB`` (``F10.5``); ``x`` is the cumulative length along the path (the tool
continues it across ``TAPPEND=T`` segments), energies are in eV for both modes as verified on the
si2 example (``LINEARINTERPOLATION`` and ``DIAG`` agree to 1e-4 eV). ``DIAG`` output additionally
carries ``#`` header lines per segment, which are skipped.
"""

from __future__ import annotations

import json
from pathlib import Path

from atomscope.backends.cppaw.tools import band_file, band_sidecar, path_segments
from atomscope.model.spectrum import BandStructure, KPathLabel, KPathPoint


def parse_band_text(text: str) -> tuple[list[float], list[list[float]]]:
    """(x values, energies[k][band]) from one band file."""
    xs: list[float] = []
    rows: list[list[float]] = []
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        parts = [float(p) for p in s.split()]
        xs.append(parts[0])
        rows.append(parts[1:])
    if rows and any(len(r) != len(rows[0]) for r in rows):
        msg = "band file rows have different numbers of bands"
        raise ValueError(msg)
    return xs, rows


def read_bands(
    work: Path,
    root: str,
    *,
    fermi_level: float | None = None,
    homo_energy: float | None = None,
) -> BandStructure:
    sidecar = work / band_sidecar(root)
    if not sidecar.is_file():
        msg = f"{sidecar.name} not found: no band structure has been requested"
        raise FileNotFoundError(msg)
    meta = json.loads(sidecar.read_text(encoding="utf-8"))
    path = [KPathPoint.model_validate(p) for p in meta["path"]]
    nk = int(meta["nk"])
    n_spins = int(meta["n_spins"])
    energies: list[list[list[float]]] = []
    xs: list[float] = []
    for spin in range(1, n_spins + 1):
        f = work / band_file(root, spin)
        if not f.is_file():
            msg = f"{f.name} not found (paw_bands.x did not finish?)"
            raise FileNotFoundError(msg)
        # The sidecar is written when the run is requested. A .dat older than it belongs to an
        # earlier request, so the last run failed (older paw_bands.x builds reject MODE=DIAG, for
        # instance) and serving the file would answer a question nobody asked.
        if f.stat().st_mtime < sidecar.stat().st_mtime:
            msg = (
                f"{f.name} predates the last band request (mode {meta.get('mode', '?')}): "
                "that run did not produce a band file, see the job log"
            )
            raise FileNotFoundError(msg)
        x, rows = parse_band_text(f.read_text(errors="replace"))
        if spin == 1:
            xs = x
        elif len(x) != len(xs):
            msg = "spin channels have different numbers of k-points"
            raise ValueError(msg)
        energies.append(rows)
    segments = path_segments(path)
    if len(xs) != nk * len(segments):
        msg = f"expected {nk * len(segments)} rows, found {len(xs)}"
        raise ValueError(msg)
    labels: list[KPathLabel] = []
    for i, (a, b) in enumerate(segments):
        start, end = xs[i * nk], xs[(i + 1) * nk - 1]
        if labels and abs(labels[-1].distance - start) < 1e-9:
            if labels[-1].label != a.label:
                labels[-1] = KPathLabel(label=f"{labels[-1].label}|{a.label}", distance=start)
        else:
            labels.append(KPathLabel(label=a.label, distance=start))
        labels.append(KPathLabel(label=b.label, distance=end))
    return BandStructure(
        k_distance=xs,
        labels=labels,
        energies=energies,
        fermi_level=fermi_level,
        homo_energy=homo_energy,
    )


__all__ = ["parse_band_text", "read_bands"]
