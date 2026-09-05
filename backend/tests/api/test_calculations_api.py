import time
from pathlib import Path

from ase.build import bulk
from fastapi.testclient import TestClient

from atomscope.api.app import create_app
from atomscope.ase_bridge import from_atoms


def test_calculation_flow_over_api(tmp_path: Path) -> None:
    with TestClient(create_app()) as c:
        assert (
            c.post(
                "/api/project/create", json={"path": str(tmp_path / "p"), "name": "d"}
            ).status_code
            == 201
        )
        backends = c.get("/api/backends").json()
        assert any(b["id"] == "ase_builtin" for b in backends)
        schema = c.get("/api/backends/ase_builtin/schema").json()
        assert schema["id"] == "ase_builtin" and schema["sections"]
        assert c.get("/api/backends/nope/schema").status_code == 404
        s = from_atoms(bulk("Cu", cubic=True), name="cu")
        c.put(f"/api/structures/{s.id}", json=s.model_dump(mode="json"))
        r = c.post(
            "/api/calculations",
            json={
                "name": "cu",
                "backend_id": "ase_builtin",
                "structure_id": s.id,
                "values": {"task": "relax", "max_steps": 2},
            },
        )
        assert r.status_code == 201, r.text
        cid = r.json()["id"]
        assert c.get(f"/api/calculations/{cid}/validate").json()["issues"] == []
        gen = c.post(f"/api/calculations/{cid}/generate").json()
        assert gen["files"][0]["name"] == "case.json"
        r = c.post(f"/api/calculations/{cid}/run")
        assert r.status_code == 200 and r.json()["status"] in ("queued", "running")
        for _ in range(200):
            calc = c.get(f"/api/calculations/{cid}").json()
            if calc["status"] in ("completed", "failed"):
                break
            time.sleep(0.1)
        assert calc["status"] == "completed", c.get(
            f"/api/calculations/{cid}/log", params={"stream": "stderr"}
        ).json()
        res = c.get(f"/api/calculations/{cid}/results").json()
        assert "energy" in res["properties"]
        log = c.get(f"/api/calculations/{cid}/log", params={"stream": "progress.log"}).json()
        assert log["lines"] and log["lines"][0].startswith("initial energy")
        assert (
            c.get(f"/api/calculations/{cid}/log", params={"stream": "../evil"}).status_code == 400
        )
        assert len(c.get("/api/calculations").json()) == 1


def test_fork_endpoint(tmp_path: Path) -> None:
    with TestClient(create_app()) as c:
        c.post("/api/project/create", json={"path": str(tmp_path / "p"), "name": "d"})
        s = from_atoms(bulk("Cu"), name="cu")
        c.put(f"/api/structures/{s.id}", json=s.model_dump(mode="json"))
        cid = c.post(
            "/api/calculations",
            json={"name": "a", "backend_id": "ase_builtin", "structure_id": s.id, "values": {}},
        ).json()["id"]
        r = c.post(f"/api/calculations/{cid}/fork", json={"values": {"task": "md"}, "name": "b"})
        assert (
            r.status_code == 201
            and r.json()["parent_calculation_id"] == cid
            and r.json()["values"]["task"] == "md"
        )
        assert (
            c.post(f"/api/calculations/{cid}/fork", json={"restart_from_parent": True}).status_code
            == 400
        )
