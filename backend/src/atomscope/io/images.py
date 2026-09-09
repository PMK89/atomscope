"""Render a structure to an image through ASE's own writers.

`asecppaw`'s `simplePOV` does this with `ase.io.write(..., run_povray=True)` and a handful of
parameters. The parameters here are ASE's, mirrored at ASE's own defaults and passed through
unreinterpreted: the point of exposing them is that someone who knows what
``ase.io.write(..., format='pov', camera_dist=...)`` does should find the same knob with the same
name and the same effect.

Two facts about this workstation, checked rather than assumed:

* matplotlib is installed, so ``png`` and ``eps`` work. The backend is forced to ``Agg`` -- a
  server process has no display, and matplotlib picking an interactive backend would hang it.
* **POV-Ray is not installed.** ``.pov`` is therefore written and returned unrendered, with the
  ``.ini`` beside it, and the caller is told so instead of being handed a silent failure. ASE
  would raise from inside the writer if asked to run it.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Literal

import matplotlib
from ase.io import write
from pydantic import Field

from atomscope.ase_bridge import to_atoms
from atomscope.model.common import StrictModel
from atomscope.model.structure import Structure

# A server process has no display, and letting matplotlib pick an interactive backend would hang
# it. Set before anything creates a figure -- ASE's png/eps writers import pyplot when called.
os.environ.setdefault("MPLBACKEND", "Agg")
matplotlib.use("Agg", force=False)

#: Formats ASE can write as a picture. ``x3d``/``html`` are scene descriptions rather than
#: rasters, but they come out of the same call and are useful for embedding.
ImageFormat = Literal["png", "eps", "pov", "x3d", "html"]

FORMATS: tuple[ImageFormat, ...] = ("png", "eps", "pov", "x3d", "html")

#: Formats that need matplotlib's raster path, and therefore a non-interactive backend.
_MATPLOTLIB = ("png", "eps")


class ImageOptions(StrictModel):
    """ASE's own image parameters, at ASE's own defaults.

    The names, defaults and units are `ase.io.utils.PlottingVariables` and `ase.io.pov.POVRAY`;
    where a value is ``None`` here it is ``None`` there too and ASE derives it.
    """

    # --- shared by every format (PlottingVariables)
    rotation: str = Field(
        default="",
        description=(
            "ASE rotation string, e.g. '90x,20y'; empty looks down z as ASE does. "
            "'auto' uses asecppaw's simplePOV rule, which turns a molecule to face the camera"
        ),
    )
    show_unit_cell: int = Field(default=2, ge=0, le=2, description="0 none, 1 behind, 2 in front")
    radii: float | None = Field(default=None, description="Å; one radius for every atom")
    scale: float = Field(default=20.0, description="pixels per Å")
    maxwidth: int = Field(default=500, ge=16, le=8000, description="px")
    colors: list[str] | None = Field(
        default=None, description="one CSS/POV colour per atom; ASE's JMOL colours otherwise"
    )
    bbox: tuple[float, float, float, float] | None = Field(
        default=None, description="x0, y0, x1, y1 in Å; ASE fits the structure otherwise"
    )

    # --- POV-Ray only (POVRAY)
    canvas_width: int | None = Field(default=None, description="px; overrides `scale` for pov")
    camera_dist: float = Field(default=50.0)
    camera_type: str = Field(default="orthographic", description="orthographic | perspective | ...")
    transparent: bool = Field(default=True, description="transparent background")
    background: str = Field(default="White")
    celllinewidth: float = Field(default=0.05, description="Å; 0 hides the cell edges")
    bondlinewidth: float = Field(default=0.1, description="Å")
    bondatoms: list[tuple[int, int]] = Field(
        default_factory=list, description="atom index pairs to draw a bond between"
    )
    textures: list[str] | None = Field(default=None, description="one POV texture name per atom")
    depth_cueing: bool = Field(default=False)
    cue_density: float = Field(default=5e-3)

    def projection_kwargs(self, *, for_pov: bool = False) -> dict[str, Any]:
        """The parameters every writer takes.

        ``scale`` is left out for POV-Ray: ``write_pov`` passes its own ``scale=1.0`` to
        ``PlottingVariables`` (``ase/io/pov.py:861``), so supplying one raises
        "got multiple values for keyword argument". POV-Ray sizes the picture with
        ``canvas_width`` and ``camera_dist`` instead, which is what those are for.
        """
        kwargs: dict[str, Any] = {
            "rotation": self.rotation,
            "show_unit_cell": self.show_unit_cell,
            "maxwidth": self.maxwidth,
        }
        if not for_pov:
            kwargs["scale"] = self.scale
        if self.radii is not None:
            kwargs["radii"] = self.radii
        if self.colors is not None:
            kwargs["colors"] = self.colors
        if self.bbox is not None:
            kwargs["bbox"] = list(self.bbox)
        return kwargs

    def povray_settings(self) -> dict[str, Any]:
        """The POV-Ray-only parameters, as ``write_pov`` wants them."""
        settings: dict[str, Any] = {
            "camera_dist": self.camera_dist,
            "camera_type": self.camera_type,
            "transparent": self.transparent,
            "background": self.background,
            "celllinewidth": self.celllinewidth,
            "bondlinewidth": self.bondlinewidth,
            "bondatoms": [tuple(p) for p in self.bondatoms],
            "depth_cueing": self.depth_cueing,
            "cue_density": self.cue_density,
            # never render: povray is not installed here, and ASE raises from inside the writer
            "display": False,
        }
        if self.canvas_width is not None:
            settings["canvas_width"] = self.canvas_width
        if self.textures is not None:
            settings["textures"] = self.textures
        return settings


def auto_rotation(structure: Structure) -> str:
    """The rotation `asecppaw`'s ``simplePOV`` picks, so the molecule faces the camera.

    Its rule (`visualize.py`): compare the mean |coordinate| along each axis; if the structure
    extends further in z than in y, turn 90 degrees about y, and if further in z than in x, also
    90 about x. A flat molecule lying in a plane containing z is thereby brought into the plane of
    the picture instead of being seen edge-on -- which is the difference between a picture of a
    molecule and a picture of a line.
    """
    pos = structure.positions()
    if len(pos) == 0:
        return ""
    mean = [float(v) for v in abs(pos).mean(axis=0)]
    parts: list[str] = []
    if mean[2] > mean[1]:
        parts.append("90y")
    if mean[2] > mean[0]:
        parts.append("90x")
    return ",".join(parts)


def write_image(
    structure: Structure, path: Path, fmt: ImageFormat, options: ImageOptions | None = None
) -> list[Path]:
    """Write ``structure`` to ``path`` and return every file produced.

    POV-Ray's writer produces an ``.ini`` beside the ``.pov``; both are needed to render, so both
    are returned.
    """
    opts = options or ImageOptions()
    atoms = to_atoms(structure)
    if opts.rotation == "auto":
        opts = opts.model_copy(update={"rotation": auto_rotation(structure)})
    path.parent.mkdir(parents=True, exist_ok=True)
    if fmt == "pov":
        write(
            str(path),
            atoms,
            format="pov",
            povray_settings=opts.povray_settings(),
            **opts.projection_kwargs(for_pov=True),
        )
        ini = path.with_suffix(".ini")
        return [path, ini] if ini.is_file() else [path]
    if fmt in _MATPLOTLIB:
        write(str(path), atoms, format=fmt, **opts.projection_kwargs())
    else:
        # x3d and html are scene descriptions; they take no projection parameters
        write(str(path), atoms, format=fmt)
    return [path]
