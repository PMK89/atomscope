from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient

from atomscope.api.app import create_app
from atomscope.parsers.cube import read_cube

FIX = Path(__file__).resolve().parents[1] / "fixtures" / "cppaw" / "h2o"
CUBE_GZ = FIX / "case_total_density.cub.gz"


def test_grid_routes(tmp_path: Path) -> None:
    with TestClient(create_app()) as c:
        assert c.get("/api/grids").status_code == 409
        c.post("/api/project/create", json={"path": str(tmp_path / "p"), "name": "d"})
        assert c.get("/api/grids").json() == []
        assert c.get("/api/grids/none").status_code == 404
        r = c.post(
            "/api/io/import/cube", json={"path": str(tmp_path / "nope.cub"), "kind": "orbital"}
        )
        assert r.status_code == 404
        r = c.post("/api/io/import/cube", json={"path": str(CUBE_GZ), "kind": "electron_density"})
        assert r.status_code == 200, r.text
        grid = r.json()["grid"]
        gid = grid["id"]
        assert grid["kind"] == "electron_density" and grid["dtype"] == "float32"
        assert r.json()["structure"]["id"] == grid["structure_id"]
        assert c.get(f"/api/structures/{grid['structure_id']}").status_code == 200

        refs = c.get("/api/grids").json()
        assert [(x["grid"]["id"], x["calculation_id"]) for x in refs] == [(gid, None)]
        assert c.get(f"/api/grids/{gid}").json() == grid

        r = c.get(f"/api/grids/{gid}/data")
        assert r.status_code == 200
        assert r.headers["content-type"] == "application/octet-stream"
        assert r.headers["x-grid-shape"] == "80,80,80"
        assert r.headers["x-grid-dtype"] == "float32"
        assert len(r.content) == 80**3 * 4
        values = np.frombuffer(r.content, dtype="<f4").reshape(80, 80, 80)
        np.testing.assert_allclose(values, read_cube(CUBE_GZ).values, rtol=1e-6)

        stats = c.get(f"/api/grids/{gid}/stats").json()
        assert stats["max"] > stats["suggested_isovalue"] > 0
        assert stats["has_negative"] is False
        assert set(stats) >= {"min", "max", "mean", "abs_max", "suggested_isovalue", "rule"}
