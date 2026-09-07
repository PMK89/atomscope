"""Sweeps over the API: create, run, read the curve."""

from pathlib import Path

from ase.build import bulk
from fastapi.testclient import TestClient

from atomscope.api.app import create_app
from atomscope.ase_bridge import from_atoms


def test_sweep_flow_over_api(tmp_path: Path) -> None:
    with TestClient(create_app()) as c:
        assert (
            c.post(
                "/api/project/create", json={"path": str(tmp_path / "p"), "name": "d"}
            ).status_code
            == 201
        )
        copper = from_atoms(bulk("Cu", cubic=True), name="cu")
        c.put(f"/api/structures/{copper.id}", json=copper.model_dump(mode="json"))

        assert c.get("/api/sweeps").json() == []
        made = c.post(
            "/api/sweeps",
            json={
                "structure_id": copper.id,
                "spec": {
                    "name": "steps",
                    "backend_id": "ase_builtin",
                    "label": "Relaxation steps",
                    "key": "max_steps",
                    "base_values": {"task": "relax"},
                    "points": [
                        {"x": 1, "values": {"max_steps": 1}},
                        {"x": 3, "values": {"max_steps": 3}},
                    ],
                },
            },
        )
        assert made.status_code == 201, made.text
        sweep_id = made.json()[0]["sweep"]["sweep_id"]

        listed = c.get("/api/sweeps").json()
        assert listed == [
            {
                "sweep_id": sweep_id,
                "label": "Relaxation steps",
                "unit": None,
                "key": "max_steps",
                "points": 2,
                "completed": 0,
            }
        ]

        before = c.get(f"/api/sweeps/{sweep_id}").json()
        assert [p["energy_ev"] for p in before["result"]["points"]] == [None, None]
        assert before["converged_from"] is None

        after = c.post(f"/api/sweeps/{sweep_id}/run")
        assert after.status_code == 200, after.text
        curve = after.json()["result"]
        assert [p["x"] for p in curve["points"]] == [1.0, 3.0]
        assert all(p["status"] == "completed" for p in curve["points"])
        assert all(p["energy_ev"] is not None for p in curve["points"])
        # every scalar the run reported comes back, so a sweep can be read against any of them
        assert "energy" in curve["points"][0]["properties"]

        assert c.get("/api/sweeps").json()[0]["completed"] == 2
        # a tolerance the points do not meet pushes the answer to the last point, or past it
        tight = c.get(f"/api/sweeps/{sweep_id}", params={"tolerance_ev": 1e-12}).json()
        assert tight["tolerance_ev"] == 1e-12

        assert c.get("/api/sweeps/nope").status_code == 404
        assert c.post("/api/sweeps/nope/run").status_code == 404
        bad = c.post(
            "/api/sweeps",
            json={
                "structure_id": copper.id,
                "spec": {
                    "name": "one point is not a sweep",
                    "backend_id": "ase_builtin",
                    "label": "x",
                    "points": [{"x": 1}],
                },
            },
        )
        assert bad.status_code == 422
