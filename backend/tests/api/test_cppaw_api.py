"""End-to-end CP-PAW through the HTTP API (real executable; skipped when unavailable)."""

import time
from pathlib import Path

import pytest
from ase.build import bulk
from fastapi.testclient import TestClient

from atomscope.api.app import create_app
from atomscope.ase_bridge import from_atoms
from atomscope.backends.cppaw import plugin


@pytest.mark.cppaw
def test_cppaw_calculation_over_api(tmp_path: Path) -> None:
    if not plugin.discover_executables().available or not plugin.health_check().ok:
        pytest.skip("CP-PAW unavailable or unhealthy")
    with TestClient(create_app()) as c:
        c.post("/api/project/create", json={"path": str(tmp_path / "p"), "name": "cppaw"})
        s = from_atoms(bulk("Si"), name="si2")
        c.put(f"/api/structures/{s.id}", json=s.model_dump(mode="json"))
        r = c.post(
            "/api/calculations",
            json={
                "name": "si2 single point",
                "backend_id": "cppaw",
                "structure_id": s.id,
                "values": {
                    "task": "single_point",
                    "kpoint_r": 10.0,
                    "empty_bands": 2,
                    "nstep": 60,
                    "nwrite": 10,
                },
            },
        )
        assert r.status_code == 201, r.text
        cid = r.json()["id"]
        gen = c.post(f"/api/calculations/{cid}/generate").json()
        assert {f["name"] for f in gen["files"]} == {"case.cntl", "case.strc"}
        assert c.post(f"/api/calculations/{cid}/run").status_code == 200
        for _ in range(600):
            calc = c.get(f"/api/calculations/{cid}").json()
            if calc["status"] in ("completed", "failed", "cancelled"):
                break
            time.sleep(0.2)
        assert calc["status"] == "completed", c.get(
            f"/api/calculations/{cid}/log", params={"stream": "stdout"}
        ).json()
        res = c.get(f"/api/calculations/{cid}/results").json()
        assert -8.0 * 27.2 < res["properties"]["energy"]["value"] < -7.0 * 27.2
        prot = c.get(
            f"/api/calculations/{cid}/log", params={"stream": "case.prot", "tail": 20}
        ).json()
        assert any("PROGRAM FINISHED" in line for line in prot["lines"])
        assert calc["result_structure_id"] in [x["id"] for x in c.get("/api/structures").json()]
