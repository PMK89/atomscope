"""Cases for volumetric grids, trajectory decoding and the FastAPI round trip."""

from __future__ import annotations

import shutil
from collections.abc import Callable
from pathlib import Path
from typing import Any

from benchmarks import fixtures
from benchmarks._timing import register

#: (grid edge, repeats, in --quick)
GRIDS: tuple[tuple[int, int, bool], ...] = ((80, 3, True), (160, 2, False), (256, 1, False))
#: (frames, atoms, repeats, in --quick)
TRAJECTORIES: tuple[tuple[int, int, int, bool], ...] = ((200, 100, 3, True), (1000, 100, 1, False))
API_SIZES: tuple[tuple[str, int, bool], ...] = (
    ("1e3", 5, True),
    ("1e4", 3, True),
    ("1e5", 1, False),
)


def _out_dir(name: str) -> Path:
    d = fixtures.root() / "out" / name
    d.mkdir(parents=True, exist_ok=True)
    return d


# ---- volumetric grids ----------------------------------------------------------------------


def _read_cube(n: int) -> tuple[Callable[[], Any], int, str]:
    from atomscope.parsers.cube import read_cube  # noqa: PLC0415

    path = fixtures.cube_file(n)
    mb = path.stat().st_size / 1e6
    return (lambda: read_cube(path), n**3, f"{n}^3 ASCII cube, {mb:.0f} MB")


def _write_cube(n: int) -> tuple[Callable[[], Any], int, str]:
    from atomscope.parsers.cube import read_cube, write_cube  # noqa: PLC0415

    data = read_cube(fixtures.cube_file(n))
    out = _out_dir("cube") / f"write-{n}.cube"
    return (
        lambda: write_cube(out, data.grid, data.values, data.structure),
        n**3,
        f"{n}^3 ASCII cube",
    )


def _write_sidecar(n: int) -> tuple[Callable[[], Any], int, str]:
    from atomscope.calculations.grids import write_sidecar  # noqa: PLC0415

    values = fixtures.grid_values(n)
    out = _out_dir("sidecar") / f"grid-{n}.f32"
    return (
        lambda: write_sidecar(out, values),
        n**3,
        f"{n}^3 float32 sidecar, {4 * n**3 / 1e6:.0f} MB",
    )


def _load_values(n: int) -> tuple[Callable[[], Any], int, str]:
    from atomscope.calculations.grids import load_values, write_sidecar  # noqa: PLC0415
    from atomscope.model import VolumetricGrid  # noqa: PLC0415
    from atomscope.project.store import ProjectStore  # noqa: PLC0415
    from atomscope.units import Unit  # noqa: PLC0415

    root = _out_dir("gridproject") / f"p{n}"
    if root.exists():
        shutil.rmtree(root)
    store = ProjectStore.create(root, "bench")
    grid = VolumetricGrid(
        id="g0",
        name="bench",
        origin=(0.0, 0.0, 0.0),
        axes=((0.25, 0.0, 0.0), (0.0, 0.25, 0.0), (0.0, 0.0, 0.25)),
        shape=(n, n, n),
        unit=Unit.E_PER_BOHR3,
        data_ref="datasets/g0.f32",
    )
    write_sidecar(store.path_in_project("datasets/g0.f32"), fixtures.grid_values(n))
    return (lambda: load_values(store, grid), n**3, f"{n}^3 sidecar read")


def _grid_stats(n: int) -> tuple[Callable[[], Any], int, str]:
    from atomscope.calculations.grids import compute_stats  # noqa: PLC0415

    values = fixtures.grid_values(n).astype("float32")
    return (lambda: compute_stats(values, "electron_density"), n**3, f"{n}^3 isovalue statistics")


# ---- trajectories --------------------------------------------------------------------------


def _tra_read(frames: int, atoms: int) -> tuple[Callable[[], Any], int, str]:
    from atomscope.backends.cppaw.tra import read_position_trajectory  # noqa: PLC0415

    path = fixtures.tra_file(frames, atoms)
    return (
        lambda: read_position_trajectory(path, atoms),
        frames,
        f"CP-PAW _r.tra, {frames} frames x {atoms} atoms",
    )


def _ase_traj_import(frames: int, atoms: int) -> tuple[Callable[[], Any], int, str]:
    from atomscope.io.trajectory_io import read_trajectory  # noqa: PLC0415

    path = fixtures.extxyz_trajectory(frames, atoms)
    mb = path.stat().st_size / 1e6
    return (
        lambda: read_trajectory(path),
        frames,
        f"extxyz via ASE, {frames} frames x {atoms} atoms, {mb:.0f} MB",
    )


def _traj_export(frames: int, atoms: int) -> tuple[Callable[[], Any], int, str]:
    from atomscope.io.trajectory_io import read_trajectory, trajectory_to_extxyz  # noqa: PLC0415

    traj, _ = read_trajectory(fixtures.extxyz_trajectory(frames, atoms))
    return (
        lambda: trajectory_to_extxyz(traj),
        frames,
        f"Trajectory -> extxyz text, {frames} frames",
    )


def _traj_positions_stream(frames: int, atoms: int) -> tuple[Callable[[], Any], int, str]:
    import numpy as np  # noqa: PLC0415

    from atomscope.io.trajectory_io import read_trajectory  # noqa: PLC0415

    traj, _ = read_trajectory(fixtures.extxyz_trajectory(frames, atoms))

    def stream() -> int:
        return sum(len(np.asarray(f.positions, dtype="<f4").tobytes()) for f in traj.frames)

    return (stream, frames, "binary positions endpoint payload build")


# ---- API round trip -------------------------------------------------------------------------


def _client(name: str) -> tuple[Any, Any]:
    from fastapi.testclient import TestClient  # noqa: PLC0415

    from atomscope.api.app import create_app  # noqa: PLC0415

    root = _out_dir("api") / name
    if root.exists():
        shutil.rmtree(root)
    client = TestClient(create_app())
    r = client.post("/api/project/create", json={"path": str(root), "name": "bench"})
    if r.status_code != 201:
        msg = f"could not create benchmark project: {r.status_code} {r.text[:200]}"
        raise RuntimeError(msg)
    return client, root


def _api_put(size: str) -> tuple[Callable[[], Any], int, str]:
    client, _ = _client(f"put-{size}")
    s = fixtures.structure("bulk", size)
    payload = s.model_dump(mode="json")
    return (
        lambda: client.put(f"/api/structures/{s.id}", json=payload),
        s.n_atoms,
        "PUT /api/structures (validate + save to disk)",
    )


def _api_get(size: str) -> tuple[Callable[[], Any], int, str]:
    client, _ = _client(f"get-{size}")
    s = fixtures.structure("bulk", size)
    client.put(f"/api/structures/{s.id}", json=s.model_dump(mode="json"))
    mb = len(client.get(f"/api/structures/{s.id}").content) / 1e6
    return (
        lambda: client.get(f"/api/structures/{s.id}"),
        s.n_atoms,
        f"GET /api/structures (load + response_model), {mb:.1f} MB body",
    )


def _api_list(size: str) -> tuple[Callable[[], Any], int, str]:
    client, _ = _client(f"list-{size}")
    s = fixtures.structure("bulk", size)
    client.put(f"/api/structures/{s.id}", json=s.model_dump(mode="json"))
    return (
        lambda: client.get("/api/structures"),
        s.n_atoms,
        "GET /api/structures (summaries; loads every structure)",
    )


def register_all() -> None:
    """Register every grid/trajectory/API case."""
    for n, rep, quick in GRIDS:
        for name, fn in (
            ("grid.read_cube", _read_cube),
            ("grid.write_cube", _write_cube),
            ("grid.write_sidecar", _write_sidecar),
            ("grid.load_values", _load_values),
            ("grid.stats", _grid_stats),
        ):
            register(
                f"{name}.{n}",
                "volumetric grids",
                lambda f=fn, m=n: f(m),
                items_label="voxels",
                repeats=rep,
                quick=quick,
                timeout_s=900.0 if n >= 256 else 300.0,
            )
    for frames, atoms, rep, quick in TRAJECTORIES:
        for name, fn in (
            ("traj.tra_read", _tra_read),
            ("traj.ase_import", _ase_traj_import),
            ("traj.export_extxyz", _traj_export),
            ("traj.positions_stream", _traj_positions_stream),
        ):
            register(
                f"{name}.{frames}",
                "trajectories",
                lambda f=fn, fr=frames, a=atoms: f(fr, a),
                items_label="frames",
                repeats=rep,
                quick=quick,
            )
    for size, rep, quick in API_SIZES:
        for name, fn in (
            ("api.put_structure", _api_put),
            ("api.get_structure", _api_get),
            ("api.list_structures", _api_list),
        ):
            register(
                f"{name}.{size}",
                "API round trip",
                lambda f=fn, s=size: f(s),
                repeats=rep,
                quick=quick,
            )
