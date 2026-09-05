"""End-to-end CP-PAW post-processing through the HTTP API: si2 single point, then DOS,
band structure and orbital export (real executables; skipped when unavailable)."""

import time
from pathlib import Path

import numpy as np
import pytest
from ase.build import bulk
from fastapi.testclient import TestClient

from atomscope.api.app import create_app
from atomscope.ase_bridge import from_atoms
from atomscope.backends.cppaw import plugin
from atomscope.backends.cppaw.dos import integrate


def _wait(c: TestClient, cid: str, *, analysis: bool, timeout: float = 300.0) -> dict:  # type: ignore[type-arg]
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        calc = c.get(f"/api/calculations/{cid}").json()
        status = calc["analysis_jobs"][-1]["job"]["status"] if analysis else calc["status"]
        if status in ("completed", "failed", "cancelled"):
            return calc  # type: ignore[no-any-return]
        time.sleep(0.2)
    msg = "timeout"
    raise AssertionError(msg)


@pytest.mark.cppaw
def test_cppaw_analysis_tools_over_api(tmp_path: Path) -> None:  # noqa: PLR0915
    if not plugin.discover_executables().available or not plugin.health_check().ok:
        pytest.skip("CP-PAW unavailable or unhealthy")
    with TestClient(create_app()) as c:
        c.post("/api/project/create", json={"path": str(tmp_path / "p"), "name": "cppaw"})
        s = from_atoms(bulk("Si"), name="si2")
        c.put(f"/api/structures/{s.id}", json=s.model_dump(mode="json"))
        r = c.post(
            "/api/calculations",
            json={
                "name": "si2",
                "backend_id": "cppaw",
                "structure_id": s.id,
                "values": {
                    "task": "single_point",
                    "kpoint_mode": "density",
                    "kpoint_r": 10.0,
                    "empty_bands": 2,
                    "nstep": 200,
                    "nwrite": 10,
                    "epwpsi": 30.0,
                },
            },
        )
        assert r.status_code == 201, r.text
        cid = r.json()["id"]
        # analysis before the run is refused
        assert c.post(f"/api/cppaw/calculations/{cid}/dos", json={}).status_code == 409
        assert c.post(f"/api/calculations/{cid}/run").status_code == 200
        calc = _wait(c, cid, analysis=False)
        assert calc["status"] == "completed", c.get(f"/api/calculations/{cid}/log").json()
        base_dir = Path(c.get("/api/project").json()["path"]) / "calculations" / cid / "work"

        # ---- orbital browser
        orbs = c.get(f"/api/cppaw/calculations/{cid}/orbitals").json()
        assert orbs["n_spins"] == 1 and orbs["n_kpoints"] == 8
        k1 = [o for o in orbs["orbitals"] if o["kpoint"] == 1]
        assert [o["label"] for o in k1] == ["HOMO-3", "HOMO-2", "HOMO-1", "HOMO", "LUMO", "LUMO+1"]
        assert [o["occupation"] for o in k1] == [2.0, 2.0, 2.0, 2.0, 0.0, 0.0]
        assert all(o["grid_id"] is None for o in k1)

        # ---- DOS
        assert c.get(f"/api/cppaw/calculations/{cid}/dos").status_code == 404
        r = c.post(
            f"/api/cppaw/calculations/{cid}/dos",
            json={"broadening_ev": 0.1, "de_ev": 0.02, "projection": "atom"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["analysis_jobs"][-1]["kind"] == "dos"
        calc = _wait(c, cid, analysis=True)
        assert calc["analysis_jobs"][-1]["job"]["status"] == "completed", (
            base_dir / "dos.log"
        ).read_text()
        dos = c.get(f"/api/cppaw/calculations/{cid}/dos").json()
        ids = [x["id"] for x in dos["series"]]
        assert ids == ["total", "SI1", "SI1_s", "SI1_p", "SI2", "SI2_s", "SI2_p"]
        total = dos["series"][0]
        assert total["spin"] == "none"
        # 8 valence electrons in the occupied DOS (single spin channel, 2 per state)
        assert abs(integrate(dos["energies"], total["occupied_dos"]) - 8.0) < 0.2
        assert abs(integrate(dos["energies"], total["dos"]) - 12.0) < 0.5  # 6 bands x 2
        assert dos["fermi_level"] is not None and dos["homo_energy"] is not None
        assert abs(dos["fermi_level"] - dos["homo_energy"]) < 0.5

        # ---- band structure (default path, linear interpolation from the k-mesh)
        path = c.get(f"/api/cppaw/calculations/{cid}/bands/path").json()["points"]
        assert [p["label"] for p in path][:2] == ["G", "X"]
        assert c.get(f"/api/cppaw/calculations/{cid}/bands").status_code == 404
        r = c.post(f"/api/cppaw/calculations/{cid}/bands", json={"nk": 8})
        assert r.status_code == 200, r.text
        calc = _wait(c, cid, analysis=True)
        assert calc["analysis_jobs"][-1]["job"]["status"] == "completed", (
            base_dir / "bands.log"
        ).read_text()
        bands = c.get(f"/api/cppaw/calculations/{cid}/bands").json()
        n_segments = len([p for p in path if p["label"] != ","]) - 2
        assert len(bands["k_distance"]) == 8 * n_segments
        e = np.array(bands["energies"][0])
        assert e.shape == (8 * n_segments, 6)
        assert -6.0 < e[0, 0] < -3.0 and 6.0 < e[0, 3] < 9.0  # Si valence band at Gamma
        assert bands["labels"][0]["label"] == "G" and bands["labels"][-1]["label"] == "X"
        assert np.all(np.diff(bands["k_distance"]) >= 0)

        # ---- orbital export: bands 3 and 4 at k=1 via a one-step restart under case_orb
        r = c.post(
            f"/api/cppaw/calculations/{cid}/orbitals/export",
            json={"orbitals": [{"band": 3}, {"band": 4, "kpoint": 1, "spin": 1}]},
        )
        assert r.status_code == 200, r.text
        calc = _wait(c, cid, analysis=True)
        assert calc["analysis_jobs"][-1]["job"]["status"] == "completed", (
            base_dir / "orbitals.log"
        ).read_text()
        grids = calc["results"]["grids"]
        orbital_grids = [g for g in grids if g["kind"] == "orbital"]
        assert [g["orbital"]["index"] for g in orbital_grids] == [2, 3]
        assert all(g["shape"] == [80, 80, 80] for g in orbital_grids)
        assert orbital_grids[1]["orbital"]["label"] == "HOMO"
        assert (base_dir / "case_orb_b3k1s1.cub").exists()
        data = c.get(f"/api/grids/{orbital_grids[0]['id']}/data")
        assert data.status_code == 200 and len(data.content) == 4 * 80**3
        orbs = c.get(f"/api/cppaw/calculations/{cid}/orbitals").json()["orbitals"]
        exported = {o["band"] for o in orbs if o["kpoint"] == 1 and o["grid_id"]}
        assert exported == {3, 4}
        # the main run's files were not touched by the restart
        assert (base_dir / "case.prot").read_text().count("PROGRAM STARTED") == 1
        # invalid requests are rejected without starting a job
        r = c.post(
            f"/api/cppaw/calculations/{cid}/orbitals/export", json={"orbitals": [{"band": 99}]}
        )
        assert r.status_code == 409
