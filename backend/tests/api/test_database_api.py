"""The database and export routes, over HTTP."""

import time
from pathlib import Path

import ase.db
from ase.build import bulk, molecule
from fastapi.testclient import TestClient

from atomscope.api.app import create_app
from atomscope.ase_bridge import from_atoms


def _run(c: TestClient, name: str, structure: object) -> str:
    c.put(
        f"/api/structures/{structure.id}",  # type: ignore[attr-defined]
        json=structure.model_dump(mode="json"),  # type: ignore[attr-defined]
    )
    calc = c.post(
        "/api/calculations",
        json={
            "name": name,
            "backend_id": "ase_builtin",
            "structure_id": structure.id,  # type: ignore[attr-defined]
            "values": {"task": "single_point"},
        },
    ).json()
    c.post(f"/api/calculations/{calc['id']}/run")
    for _ in range(200):
        if c.get(f"/api/calculations/{calc['id']}").json()["status"] in ("completed", "failed"):
            break
        time.sleep(0.1)
    # GET results collects them if they have not been collected, which is what indexes the row
    assert "energy" in c.get(f"/api/calculations/{calc['id']}/results").json()["properties"]
    return str(calc["id"])


def test_selecting_by_element_over_the_api(tmp_path: Path) -> None:
    with TestClient(create_app()) as c:
        c.post("/api/project/create", json={"path": str(tmp_path / "p"), "name": "d"})
        _run(c, "water", from_atoms(molecule("H2O"), name="h2o"))
        _run(c, "copper", from_atoms(bulk("Cu", cubic=True), name="cu"))

        everything = c.get("/api/database").json()
        assert everything["total"] == 2
        assert {r["formula"] for r in everything["rows"]} == {"H2O", "Cu4"}

        # ASE's selection language, passed through untouched
        water = c.get("/api/database", params={"selection": "H"}).json()
        assert [r["name"] for r in water["rows"]] == ["water"]
        assert water["total"] == 2  # the whole database, so a UI can say "1 of 2"
        assert water["rows"][0]["natoms"] == 3
        assert water["rows"][0]["energy"] is not None
        assert water["rows"][0]["backend"] == "ase_builtin"

        assert [
            r["name"] for r in c.get("/api/database", params={"selection": "Cu"}).json()["rows"]
        ] == ["copper"]
        assert (
            c.get("/api/database", params={"selection": "natoms>3"}).json()["rows"][0]["name"]
            == "copper"
        )

        # and the file is where the user can reach it with `ase db` or `ase gui`
        where = c.get("/api/database/path").json()
        assert where["exists"] is True
        assert where["path"].endswith("atomscope.db")


def test_reindex_builds_a_database_a_project_never_had(tmp_path: Path) -> None:
    with TestClient(create_app()) as c:
        c.post("/api/project/create", json={"path": str(tmp_path / "p"), "name": "d"})
        _run(c, "water", from_atoms(molecule("H2O"), name="h2o"))

        (tmp_path / "p" / "atomscope.db").unlink()
        assert c.get("/api/database").json() == {"rows": [], "total": 0, "selection": None}

        result = c.post("/api/database/reindex").json()
        assert result == {"indexed": 1, "problems": []}
        assert c.get("/api/database").json()["total"] == 1


def test_export_leaves_the_restart_file_behind(tmp_path: Path) -> None:
    with TestClient(create_app()) as c:
        c.post("/api/project/create", json={"path": str(tmp_path / "p"), "name": "d"})
        _run(c, "water", from_atoms(molecule("H2O"), name="h2o"))
        # a restart file of the kind that makes a project unshippable
        work = next((tmp_path / "p" / "calculations").iterdir()) / "work"
        work.mkdir(parents=True, exist_ok=True)
        (work / "case.rstrt").write_bytes(b"x" * 4096)

        options = c.get("/api/project/export/options").json()
        assert {o["key"] for o in options} >= {"restart", "setup_reports", "trajectories"}
        assert next(o for o in options if o["key"] == "restart")["default"] is True

        result = c.post("/api/project/export", json={"path": str(tmp_path / "out")}).json()
        assert result["files"] > 0
        assert [s["key"] for s in result["skipped"]] == ["restart"]
        assert result["skipped"][0]["bytes"] == 4096
        assert not list((tmp_path / "out" / "calculations").glob("*/work/case.rstrt"))

        # the copy is a project: open it and the results are there
        assert c.post("/api/project/open", json={"path": str(tmp_path / "out")}).status_code == 200
        assert c.get("/api/calculations").json()[0]["status"] == "completed"
        assert c.get("/api/database", params={"selection": "H"}).json()["total"] == 1


def test_export_reports_a_bad_destination_rather_than_failing_silently(tmp_path: Path) -> None:
    with TestClient(create_app()) as c:
        c.post("/api/project/create", json={"path": str(tmp_path / "p"), "name": "d"})
        r = c.post("/api/project/export", json={"path": str(tmp_path / "p" / "inside")})
        assert r.status_code == 400
        assert "into itself" in r.json()["detail"]

        r = c.post(
            "/api/project/export", json={"path": str(tmp_path / "o"), "exclude": ["nonsense"]}
        )
        assert r.status_code == 400
        assert "unknown exclusion" in r.json()["detail"]


def test_a_database_written_before_identity_existed_still_reads(tmp_path: Path) -> None:
    """A user's project may hold rows from an earlier version; they must not read back blank."""
    with TestClient(create_app()) as c:
        c.post("/api/project/create", json={"path": str(tmp_path / "p"), "name": "d"})
        _run(c, "water", from_atoms(molecule("H2O"), name="h2o"))

        db = ase.db.connect(tmp_path / "p" / "atomscope.db")
        row = next(iter(db.select()))
        data = dict(row.data)
        identity = data.pop("identity")
        del db[row.id]
        # written the old way: identity in the key-value pairs only
        db.write(row.toatoms(), key_value_pairs={**row.key_value_pairs, **identity}, data=data)

        back = c.get("/api/database").json()["rows"][0]
        assert back["name"] == "water"
        assert back["backend"] == "ase_builtin"
        assert back["status"] == "completed"
        assert back["calculation_id"] == identity["calculation_id"]
        # and the identity is not duplicated into the parameter column
        assert "name" not in back["keys"] and "calculation_id" not in back["keys"]
