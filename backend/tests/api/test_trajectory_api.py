from pathlib import Path

import ase.io
import numpy as np
from ase.build import molecule
from fastapi.testclient import TestClient

from atomscope.api.app import create_app
from atomscope.backends.base import ResultBundle
from atomscope.model import Atom, Frame, Structure, Trajectory


def _traj(n_frames: int = 3) -> Trajectory:
    return Trajectory(
        id="t1",
        name="synthetic",
        symbols=["H", "H"],
        kind="md",
        frames=[
            Frame(
                positions=[(0, 0, 0), (0.7 + 0.1 * i, 0, 0)],
                cell=((10, 0, 0), (0, 10, 0), (0, 0, 10)),
                energy=-1.0 * i,
                time=0.5 * i,
                temperature=300.0,
                step=i,
            )
            for i in range(n_frames)
        ],
    )


def test_trajectory_routes(tmp_path: Path) -> None:
    c = TestClient(create_app())
    assert (
        c.post("/api/project/create", json={"path": str(tmp_path / "p"), "name": "d"}).status_code
        == 201
    )
    s = Structure(
        name="h2",
        atoms=[Atom(element="H", position=(0, 0, 0)), Atom(element="H", position=(0.7, 0, 0))],
    )
    c.put(f"/api/structures/{s.id}", json=s.model_dump(mode="json"))
    r = c.post(
        "/api/calculations",
        json={"name": "h2", "backend_id": "ase_builtin", "structure_id": s.id, "values": {}},
    )
    cid = r.json()["id"]
    # never run -> 409
    assert c.get(f"/api/calculations/{cid}/trajectory").status_code == 409
    svc = c.app.state.atomscope.calculations
    calc = svc.get(cid)
    calc.results = ResultBundle()
    svc.save(calc)
    assert c.get(f"/api/calculations/{cid}/trajectory/positions").status_code == 404
    calc.results = ResultBundle(trajectory=_traj())
    svc.save(calc)

    r = c.get(f"/api/calculations/{cid}/trajectory")
    assert r.status_code == 200 and len(r.json()["frames"]) == 3

    r = c.get(f"/api/calculations/{cid}/trajectory/scalars")
    assert r.status_code == 200
    sc = r.json()
    assert sc["n_frames"] == 3 and sc["n_atoms"] == 2 and sc["symbols"] == ["H", "H"]
    assert sc["energy"] == [0.0, -1.0, -2.0] and sc["time"] == [0.0, 0.5, 1.0]
    assert sc["step"] == [0, 1, 2] and sc["cells"][0][0] == [10, 0, 0]

    r = c.get(f"/api/calculations/{cid}/trajectory/positions")
    assert r.status_code == 200
    assert r.headers["x-frames"] == "3" and r.headers["x-atoms"] == "2"
    assert r.headers["content-type"] == "application/octet-stream"
    data = np.frombuffer(r.content, dtype="<f4").reshape(3, 2, 3)
    assert data.shape == (3, 2, 3)
    assert data[2, 1, 0] == np.float32(0.9) and data[0, 0, 0] == 0.0

    assert c.get("/api/calculations/nope/trajectory").status_code == 404


def test_trajectory_io_routes(tmp_path: Path) -> None:
    c = TestClient(create_app())
    path = tmp_path / "w.xyz"
    ase.io.write(str(path), [molecule("H2O"), molecule("H2O")], format="extxyz")
    r = c.post("/api/io/import/trajectory", json={"path": str(path)})
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["trajectory"]["frames"]) == 2 and body["trajectory"]["symbols"] == [
        "O",
        "H",
        "H",
    ]
    assert len(body["structure"]["atoms"]) == 3 and len(body["structure"]["bonds"]) == 2
    assert (
        c.post("/api/io/import/trajectory", json={"path": str(tmp_path / "x.xyz")}).status_code
        == 404
    )

    r = c.post("/api/io/import/trajectory/upload", files={"file": ("w.xyz", path.read_bytes())})
    assert r.status_code == 200 and len(r.json()["trajectory"]["frames"]) == 2
    r = c.post("/api/io/import/trajectory/upload", files={"file": ("bad.xyz", b"not xyz")})
    assert r.status_code == 400

    traj = _traj()
    r = c.post("/api/io/export/trajectory", json={"trajectory": traj.model_dump(mode="json")})
    assert r.status_code == 200 and r.json()["text"].startswith("2\n")
    out = tmp_path / "out.xyz"
    r = c.post(
        "/api/io/export/trajectory",
        json={"trajectory": traj.model_dump(mode="json"), "path": str(out)},
    )
    assert r.status_code == 200 and out.exists()
    assert len(ase.io.read(str(out), index=":")) == 3


def test_openapi_has_trajectory_routes() -> None:
    spec = create_app().openapi()
    assert "/api/calculations/{calc_id}/trajectory/positions" in spec["paths"]
    assert "/api/io/import/trajectory" in spec["paths"]
    assert "TrajectoryScalars" in spec["components"]["schemas"]
