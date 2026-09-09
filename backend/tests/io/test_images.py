"""ASE image export: every format writes, and ASE's parameters mean what they mean.

POV-Ray is not installed on this machine, so the ``.pov`` path is asserted on the *scene* it
writes rather than on a rendered picture -- which is also the only thing that can be asserted
about it anywhere without a renderer.
"""

import inspect
from pathlib import Path

import pytest
from ase.build import bulk, molecule
from ase.io.pov import POVRAY
from ase.io.utils import PlottingVariables

from atomscope.ase_bridge import from_atoms
from atomscope.io.images import FORMATS, ImageFormat, ImageOptions, write_image

WATER = from_atoms(molecule("H2O"), name="water")


@pytest.mark.parametrize("fmt", FORMATS)
def test_every_format_writes_something(fmt: ImageFormat, tmp_path: Path) -> None:
    out = write_image(WATER, tmp_path / f"w.{fmt}", fmt)
    assert out
    for f in out:
        assert f.is_file()
        assert f.stat().st_size > 200


def test_png_is_a_png(tmp_path: Path) -> None:
    """The magic bytes, because a matplotlib backend problem produces a plausible empty file."""
    (png,) = write_image(WATER, tmp_path / "w.png", "png")
    assert png.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_scale_sets_the_pixel_size(tmp_path: Path) -> None:
    """ASE's `scale` is pixels per Å, so doubling it makes a bigger picture."""
    small = write_image(WATER, tmp_path / "s.png", "png", ImageOptions(scale=10))[0]
    large = write_image(WATER, tmp_path / "l.png", "png", ImageOptions(scale=40))[0]
    assert large.stat().st_size > small.stat().st_size


def test_pov_writes_the_scene_and_its_ini(tmp_path: Path) -> None:
    """Both files, because rendering it elsewhere needs the ini as well as the scene."""
    out = write_image(WATER, tmp_path / "w.pov", "pov")
    assert [f.suffix for f in out] == [".pov", ".ini"]
    assert "Input_File_Name=w.pov" in out[1].read_text()


def test_pov_parameters_reach_the_scene(tmp_path: Path) -> None:
    """The point of exposing ASE's names is that they still do what ASE says they do."""
    (pov, _ini) = write_image(
        WATER,
        tmp_path / "w.pov",
        "pov",
        ImageOptions(
            camera_type="perspective",
            background="Black",
            transparent=False,
            bondatoms=[(0, 1), (0, 2)],
        ),
    )
    text = pov.read_text()
    assert "perspective" in text
    assert "Black" in text
    # bondatoms are drawn as cylinders; without them the scene has spheres only
    assert "cylinder" in text
    plain = write_image(WATER, tmp_path / "plain.pov", "pov")[0].read_text()
    assert "cylinder" not in plain


def test_pov_does_not_take_scale(tmp_path: Path) -> None:
    """``write_pov`` passes its own ``scale=1.0`` to ``PlottingVariables`` (ase/io/pov.py:861).

    Forwarding ours as well raises "got multiple values for keyword argument", so it is dropped
    for this format; POV-Ray sizes the picture with ``canvas_width`` and ``camera_dist``.
    """
    opts = ImageOptions(scale=40, canvas_width=640)
    assert "scale" not in opts.projection_kwargs(for_pov=True)
    assert opts.projection_kwargs()["scale"] == 40
    # and it really does write, which is the assertion that would have caught the collision
    out = write_image(WATER, tmp_path / "w.pov", "pov", opts)
    assert out[0].is_file()
    assert "640" in out[1].read_text()


def test_the_cell_can_be_hidden(tmp_path: Path) -> None:
    """`show_unit_cell` and `celllinewidth` are the two ways ASE hides it, one per format."""
    si = from_atoms(bulk("Si"), name="si")
    with_cell = write_image(si, tmp_path / "a.pov", "pov", ImageOptions(show_unit_cell=2))[0]
    without = write_image(
        si, tmp_path / "b.pov", "pov", ImageOptions(show_unit_cell=0, celllinewidth=0.0)
    )[0]
    assert with_cell.read_text() != without.read_text()
    assert with_cell.stat().st_size > without.stat().st_size


def test_defaults_are_ases_own() -> None:
    """Drifting from ASE's defaults would make the same parameter mean two things."""
    pv = inspect.signature(PlottingVariables.__init__).parameters
    pov = inspect.signature(POVRAY.__init__).parameters
    o = ImageOptions()
    assert o.rotation == pv["rotation"].default
    assert o.show_unit_cell == pv["show_unit_cell"].default
    assert o.scale == pv["scale"].default
    assert o.maxwidth == pv["maxwidth"].default
    assert o.camera_dist == pov["camera_dist"].default
    assert o.camera_type == pov["camera_type"].default
    assert o.transparent == pov["transparent"].default
    assert o.background == pov["background"].default
    assert o.celllinewidth == pov["celllinewidth"].default
    assert o.bondlinewidth == pov["bondlinewidth"].default
    assert o.depth_cueing == pov["depth_cueing"].default
    assert o.cue_density == pov["cue_density"].default
