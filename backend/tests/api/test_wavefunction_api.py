"""API round trip for wavefunction loading and surface generation."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from atomscope.api.app import create_app


def test_wavefunction_load_and_surfaces(tmp_path: Path) -> None:
    """Load a Gaussian checkpoint and turn orbitals/density into project datasets."""
    fixtures = Path(__file__).resolve().parents[1] / "fixtures" / "wavefunction"
    with TestClient(create_app()) as c:
        assert (
            c.post(
                "/api/project/create", json={"path": str(tmp_path / "p"), "name": "wf"}
            ).status_code
            == 201
        )
        info = c.post("/api/wavefunction/load", json={"path": str(fixtures / "co.fchk")}).json()
        assert info["structure"]["atoms"].__len__() == 2
        assert info["n_electrons"] == 14 and info["homo_index"] == 6
        assert info["orbitals"][6]["label"] == "HOMO" and info["orbitals"][7]["label"] == "LUMO"
        assert info["format"] == "fchk"

        body = {"path": str(fixtures / "co.fchk"), "kind": "orbital", "spacing": 0.4}
        grid = c.post("/api/wavefunction/surface", json=body).json()
        assert grid["kind"] == "orbital" and grid["orbital"]["label"] == "HOMO"
        assert grid["data_ref"].startswith("datasets/") and grid["dtype"] == "float32"
        listed = c.get("/api/grids").json()
        assert any(g["grid"]["id"] == grid["id"] for g in listed)
        stats = c.get(f"/api/grids/{grid['id']}/stats").json()
        assert stats["min"] < 0 < stats["max"]  # an orbital has both signs

        density = c.post(
            "/api/wavefunction/surface",
            json={"path": str(fixtures / "co.fchk"), "kind": "density", "spacing": 0.4},
        ).json()
        assert density["kind"] == "electron_density"
        assert c.get(f"/api/grids/{density['id']}/stats").json()["min"] >= 0

        vdw = c.post(
            "/api/wavefunction/surface",
            json={"path": str(fixtures / "co.fchk"), "kind": "vdw", "spacing": 0.4},
        ).json()
        assert vdw["unit"] == "angstrom"

        esp = c.post(
            "/api/wavefunction/surface",
            json={
                "path": str(fixtures / "co.fchk"),
                "kind": "electrostatic_potential",
                "spacing": 0.6,
                "padding": 2.5,
            },
        ).json()
        assert esp["kind"] == "electrostatic_potential" and esp["unit"] == "hartree/e"

        assert (
            c.post("/api/wavefunction/load", json={"path": str(tmp_path / "nope.fchk")}).status_code
            == 404
        )
        too_fine = {
            "path": str(fixtures / "co.fchk"),
            "kind": "electrostatic_potential",
            "spacing": 0.05,
        }
        assert c.post("/api/wavefunction/surface", json=too_fine).status_code == 400
