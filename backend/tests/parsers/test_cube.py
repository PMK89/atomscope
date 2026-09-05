from pathlib import Path

import numpy as np
from ase.units import Bohr

from atomscope.model import Atom, Structure, VolumetricGrid, new_uid
from atomscope.parsers.cube import read_cube, write_cube
from atomscope.units import Unit

FIX = Path(__file__).resolve().parents[1] / "fixtures" / "cppaw" / "h2o"


def test_read_cppaw_total_density() -> None:
    cube = read_cube(FIX / "case_total_density.cub.gz", kind="electron_density")
    assert cube.grid.shape == (80, 80, 80)
    assert cube.values.shape == (80, 80, 80)
    # origin -9.448631 Bohr = -5.0 Å
    assert abs(cube.grid.origin[0] - (-9.448631 * Bohr)) < 1e-6
    assert abs(cube.grid.axes[0][0] - 0.239206 * Bohr) < 1e-6
    # paw_wave writes periodic images: 27 atoms for water (3 x 9 images)
    assert cube.structure.n_atoms == 27
    assert sorted(set(cube.structure.symbols())) == ["H", "O"]
    # paw_wave writes raw atomic-unit values (no rescaling, see paw_wave.f90 WRITECUBEFILE).
    # The box integral of this "total" density is ~42.6 e; its normalization is documented as
    # an open question in docs/cppaw-analysis.md, so only positivity is asserted here.
    dv = abs(np.linalg.det(np.array(cube.grid.axes) / Bohr))
    assert cube.values.sum() * dv > 0
    assert cube.values.min() >= -1e-6


def test_roundtrip(tmp_path: Path) -> None:
    s = Structure(atoms=[Atom(element="He", position=(0.5, 0.5, 0.5))])
    vals = np.arange(2 * 3 * 4, dtype=float).reshape(2, 3, 4)
    g = VolumetricGrid(
        id=new_uid(),
        name="t",
        origin=(0, 0, 0),
        axes=((0.5, 0, 0), (0, 0.5, 0), (0, 0, 0.5)),
        shape=(2, 3, 4),
        unit=Unit.E_PER_BOHR3,
        data_ref="x",
    )
    p = tmp_path / "t.cube"
    write_cube(p, g, vals, s)
    back = read_cube(p)
    np.testing.assert_allclose(back.values, vals, rtol=1e-5)
    np.testing.assert_allclose(back.grid.axes, g.axes, atol=1e-6)
    assert back.structure.symbols() == ["He"]


def test_write_cube_bytes_match_the_elementwise_writer(tmp_path: Path) -> None:
    """The block writer must produce exactly the bytes the per-value f-string loop produced."""
    rng = np.random.default_rng(3)
    shape = (5, 4, 7)  # 140 values: not a multiple of 6, so the tail line is exercised
    values = rng.normal(size=shape)
    structure = Structure(
        name="ref", atoms=[Atom(element="O", position=(0.1, 0.2, 0.3))]
    )
    grid = VolumetricGrid(
        id="g",
        name="ref",
        origin=(0.0, 0.0, 0.0),
        axes=((0.2, 0.0, 0.0), (0.0, 0.3, 0.0), (0.0, 0.0, 0.4)),
        shape=shape,
        unit=Unit.E_PER_BOHR3,
        inline_values=values.reshape(-1).tolist(),
    )
    out = tmp_path / "block.cube"
    write_cube(out, grid, values, structure)
    flat = values.reshape(-1)
    expected = "".join(
        " ".join(f"{x:13.5E}" for x in flat[i : i + 6]) + "\n" for i in range(0, flat.size, 6)
    )
    assert out.read_text().endswith(expected)
    assert read_cube(out).values.shape == shape
