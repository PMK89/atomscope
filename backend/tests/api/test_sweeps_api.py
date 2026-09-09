"""Sweeps over the API: create, run, read the curve."""

from pathlib import Path

import pytest
from ase.build import bulk, molecule
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


def test_a_volume_sweep_fits_an_equation_of_state(tmp_path: Path) -> None:
    """The whole of Figs 6.6/6.7 over the API: scale a cell, run the points, fit both curves.

    EMT copper stands in for the course's silicon here because it runs in a second and needs no
    external program. The numbers are still checkable: EMT's own equilibrium for copper is a =
    3.59 Å against the measured 3.615, and its bulk modulus 131 GPa against 137.
    """
    with TestClient(create_app()) as c:
        assert (
            c.post(
                "/api/project/create", json={"path": str(tmp_path / "p"), "name": "eos"}
            ).status_code
            == 201
        )
        copper = from_atoms(bulk("Cu", cubic=True), name="cu")
        c.put(f"/api/structures/{copper.id}", json=copper.model_dump(mode="json"))

        # one structure per point, each a scaled copy -- what a volume sweep is
        points = []
        for percent in (94, 96, 98, 100, 102, 104, 106):
            atoms = bulk("Cu", cubic=True)
            atoms.set_cell(atoms.cell * (percent / 100), scale_atoms=True)
            scaled = from_atoms(atoms, name=f"cu {percent}%")
            points.append({"x": percent, "structure": scaled.model_dump(mode="json")})

        made = c.post(
            "/api/sweeps",
            json={
                "structure_id": copper.id,
                "spec": {
                    "name": "copper volume",
                    "backend_id": "ase_builtin",
                    "label": "Lattice constant",
                    "unit": "%",
                    "base_values": {"task": "single_point", "calculator": "emt"},
                    "points": points,
                },
            },
        )
        assert made.status_code == 201, made.text
        sweep_id = made.json()[0]["sweep"]["sweep_id"]

        # nothing has run, so there is nothing to fit
        assert c.get(f"/api/sweeps/{sweep_id}/fit").status_code == 409

        assert c.post(f"/api/sweeps/{sweep_id}/run").status_code == 200
        curve = c.get(f"/api/sweeps/{sweep_id}").json()["result"]
        volumes = [p["volume_a3"] for p in curve["points"]]
        # each point carries the volume of its own cell, which is what an EOS is a function of
        assert all(v is not None for v in volumes)
        assert volumes == sorted(volumes)
        assert volumes[3] == pytest.approx(bulk("Cu", cubic=True).get_volume())

        # ---- Fig. 6.7: the equation of state
        eos = c.get(f"/api/sweeps/{sweep_id}/fit", params={"kind": "murnaghan"})
        assert eos.status_code == 200, eos.text
        fit = eos.json()
        assert fit["kind"] == "murnaghan"
        assert fit["cubic"] is None
        p = fit["murnaghan"]
        assert p["b0_gpa"] == pytest.approx(131.5, rel=0.05)
        assert p["bp"] == pytest.approx(4.0, rel=0.1)
        assert p["extrapolated"] is False
        # no -vbl was given, so no lattice constant is invented from the volume
        assert p["lattice_constant_a"] is None
        assert len(fit["residuals_ev"]) == 7
        assert fit["rms_ev"] < 0.01

        # a conventional cubic cell has volume a^3, so -vbl is 1 and the constant is reported
        named = c.get(
            f"/api/sweeps/{sweep_id}/fit", params={"kind": "murnaghan", "volume_per_a3": 1.0}
        ).json()
        assert named["murnaghan"]["lattice_constant_a"] == pytest.approx(3.59, abs=0.01)

        # ---- Fig. 6.6: the cubic, in the sweep's own x
        cubic = c.get(f"/api/sweeps/{sweep_id}/fit", params={"kind": "cubic"}).json()
        assert cubic["kind"] == "cubic"
        assert cubic["murnaghan"] is None
        assert len(cubic["cubic"]["coefficients"]) == 4
        # the minimum is a percentage of the cell ASE built, whose a is 3.61
        assert cubic["cubic"]["x_min"] == pytest.approx(100.0 * 3.59 / 3.61, abs=0.5)
        assert cubic["cubic"]["extrapolated"] is False
        # the drawn curve reaches a tenth of the range past each end, as MURN.DAT does
        assert cubic["curve"]["x"][0] == pytest.approx(94 - 1.2)
        assert cubic["curve"]["x"][-1] == pytest.approx(106 + 1.2)

        assert c.get("/api/sweeps/nope/fit").status_code == 404


def test_an_equation_of_state_needs_periodic_points(tmp_path: Path) -> None:
    with TestClient(create_app()) as c:
        c.post("/api/project/create", json={"path": str(tmp_path / "p"), "name": "eos"})
        water = from_atoms(molecule("H2O"), name="water")
        c.put(f"/api/structures/{water.id}", json=water.model_dump(mode="json"))
        made = c.post(
            "/api/sweeps",
            json={
                "structure_id": water.id,
                "spec": {
                    "name": "steps",
                    "backend_id": "ase_builtin",
                    "label": "Relaxation steps",
                    "key": "max_steps",
                    "base_values": {"task": "relax", "calculator": "openbabel"},
                    "points": [
                        {"x": 1, "values": {"max_steps": 1}},
                        {"x": 2, "values": {"max_steps": 2}},
                        {"x": 3, "values": {"max_steps": 3}},
                        {"x": 4, "values": {"max_steps": 4}},
                    ],
                },
            },
        )
        assert made.status_code == 201, made.text
        sweep_id = made.json()[0]["sweep"]["sweep_id"]
        assert c.post(f"/api/sweeps/{sweep_id}/run").status_code == 200

        # a molecule has no cell, so it has no volume and no equation of state -- said, not guessed
        refused = c.get(f"/api/sweeps/{sweep_id}/fit", params={"kind": "murnaghan"})
        assert refused.status_code == 409
        assert "not periodic" in refused.json()["detail"]
        # the cubic is still available: it fits the sweep's own x, whatever that is
        assert c.get(f"/api/sweeps/{sweep_id}/fit", params={"kind": "cubic"}).status_code == 200
