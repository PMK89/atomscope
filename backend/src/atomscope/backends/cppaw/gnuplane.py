"""Contour and rubbersheet planes: the ``_c.gnu`` / ``_r.gnu`` files ``paw_wave.x`` writes.

``paw_wave.x`` writes these whenever its ``.wcntl`` carries a ``!PLANE`` block, and it writes
*both* at once (``MAKEGNU`` with ``'CONTOUR'`` and ``'SURFACE'``,
``cp-paw/src/Tools/Wave/paw_wave.f90:1493``). They are gnuplot scripts with the sampled field
inlined, and the two differ only in their header: the same 3600 numbers, once set up for a
2D contour and once for a 3D surface. So one file is enough to draw either, and Atomscope reads
whichever is present.

The format, read off the writer rather than guessed:

* a header of ``key= value`` assignments -- ``xmin``/``xmax``/``ymin``/``ymax``/``zmin``/``zmax``
  and the view (``rot_x``, ``rot_z``, ``scale``, ``scale_z``). CP-PAW's string module lowercases
  them on the way out, so they are matched case-insensitively;
* then ``# DATA SECTION``, and ``N1*N2`` rows of ``x y z``. There is an earlier line reading
  ``DATA SECTION TO BE CHANGED BY THE USER``, which is *not* the data -- the marker has to
  exclude it, as ``asecppaw``'s reader does;
* the grid is fixed at 60x60 (``N1``/``N2`` parameters in the writer), x in the outer loop and y
  in the inner, so the values reshape row-major as ``z[ix][iy]``. The reader below derives the
  shape from the data instead of trusting 60, because a parameter in a Fortran source is not a
  promise about a file already on disk;
* lengths are atomic units. ``paw_wave.x`` takes its box from the ``.wcntl`` in Bohr and writes
  x and y as half-widths of it.
"""

from __future__ import annotations

import re
from pathlib import Path

from ase.units import Bohr
from pydantic import Field

from atomscope.model.common import StrictModel

_ASSIGN = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([-+0-9.EeDd]+)\s*$")
#: The real data marker. ``DATA SECTION TO BE CHANGED BY THE USER`` is a header comment, not data.
_DATA_START = re.compile(r"^\s*#.*DATA SECTION(?!.*USER)")
_DATA_END = re.compile(r"^\s*#.*DATA SECTION FINISHED")


class PlaneView(StrictModel):
    """The view the file suggests for a rubbersheet, which is where its defaults come from."""

    rot_x: float = Field(default=30.0, description="degrees; gnuplot's first `set view` angle")
    rot_z: float = Field(default=20.0, description="degrees; gnuplot's second `set view` angle")
    scale: float = Field(default=1.8)
    scale_z: float = Field(default=1.0)


class PlaneField(StrictModel):
    """A scalar field sampled on a plane: what a contour or a rubbersheet is drawn from."""

    name: str
    nx: int
    ny: int
    x: list[float] = Field(description="Å, `nx` values, ascending; the plane's first axis")
    y: list[float] = Field(description="Å, `ny` values, ascending; the plane's second axis")
    values: list[list[float]] = Field(description="`values[ix][iy]`, as written (atomic units)")
    z_min: float
    z_max: float
    view: PlaneView = Field(default_factory=PlaneView)


def _floats(text: str) -> list[float]:
    return [float(t.replace("D", "E").replace("d", "e")) for t in text.split()]


def _scan(path: Path) -> tuple[dict[str, float], list[list[float]]]:
    """Split the file into its header assignments and its data rows."""
    header: dict[str, float] = {}
    rows: list[list[float]] = []
    in_data = False
    for line in path.read_text(errors="replace").splitlines():
        if _DATA_END.match(line):
            break
        if in_data:
            row = _floats_or_none(line)
            if row is not None:
                rows.append(row)
        elif _DATA_START.match(line):
            in_data = True
        else:
            m = _ASSIGN.match(line)
            if m:
                values = _floats_or_none(m.group(2))
                if values:
                    header[m.group(1).lower()] = values[0]
    return header, rows


def _floats_or_none(text: str) -> list[float] | None:
    """The numbers on one line, or ``None`` if it is a comment, blank, or not numeric."""
    if not text.strip() or text.lstrip().startswith("#"):
        return None
    try:
        return _floats(text)
    except ValueError:
        return None


def read_plane(path: Path, *, name: str | None = None) -> PlaneField:
    """Read one ``_c.gnu`` or ``_r.gnu`` file.

    Raises ``ValueError`` when the file has no data section or the rows do not form a rectangular
    grid -- a partially written file must not turn into a plausible-looking plot.
    """
    if not path.is_file():
        msg = f"{path.name} not found"
        raise FileNotFoundError(msg)

    header, rows = _scan(path)
    rows = [r for r in rows if len(r) >= 3]
    xs = [r[0] for r in rows]
    ys = [r[1] for r in rows]
    zs = [r[2] for r in rows]

    if not zs:
        msg = f"{path.name} has no data section"
        raise ValueError(msg)

    # x runs in the outer loop, so it repeats in blocks and y cycles. Counting the leading run of
    # one x value gives ny without assuming the writer's 60.
    ny = 0
    for value in xs:
        if value != xs[0]:
            break
        ny += 1
    nx = len(zs) // ny if ny else 0
    if ny == 0 or nx * ny != len(zs):
        msg = f"{path.name}: {len(zs)} points do not form a rectangular grid"
        raise ValueError(msg)

    return PlaneField(
        name=name or path.stem,
        nx=nx,
        ny=ny,
        x=[xs[i * ny] * Bohr for i in range(nx)],
        y=[y * Bohr for y in ys[:ny]],
        values=[zs[i * ny : (i + 1) * ny] for i in range(nx)],
        z_min=header.get("zmin", min(zs)),
        z_max=header.get("zmax", max(zs)),
        view=PlaneView(
            rot_x=header.get("rot_x", 30.0),
            rot_z=header.get("rot_z", 20.0),
            scale=header.get("scale", 1.8),
            scale_z=header.get("scale_z", 1.0),
        ),
    )


def find_planes(work: Path) -> list[Path]:
    """Plane files in ``work``, contour preferred over rubbersheet for the same stem.

    Both carry the same numbers, so reading one of each pair is enough.
    """
    contours = sorted(work.glob("*_c.gnu"))
    stems = {p.name.removesuffix("_c.gnu") for p in contours}
    extra = [p for p in sorted(work.glob("*_r.gnu")) if p.name.removesuffix("_r.gnu") not in stems]
    return contours + extra
