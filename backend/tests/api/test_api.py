from pathlib import Path

from fastapi.testclient import TestClient

from atomscope.api.app import create_app
from atomscope.model import Atom, Structure


def client() -> TestClient:
    return TestClient(create_app())


def test_health() -> None:
    r = client().get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_structures_require_project() -> None:
    assert client().get("/api/structures").status_code == 409


def test_project_and_structure_flow(tmp_path: Path) -> None:
    c = client()
    r = c.post("/api/project/create", json={"path": str(tmp_path / "p"), "name": "demo"})
    assert r.status_code == 201, r.text
    s = Structure(
        name="h2",
        atoms=[Atom(element="H", position=(0, 0, 0)), Atom(element="H", position=(0.74, 0, 0))],
    )
    r = c.put(f"/api/structures/{s.id}", json=s.model_dump(mode="json"))
    assert r.status_code == 200, r.text
    assert r.json()["formula"] == "H2"
    assert c.get("/api/structures").json()[0]["id"] == s.id
    assert Structure.model_validate(c.get(f"/api/structures/{s.id}").json()) == s
    assert c.put("/api/structures/other", json=s.model_dump(mode="json")).status_code == 400
    assert c.delete(f"/api/structures/{s.id}").status_code == 204
    assert c.get(f"/api/structures/{s.id}").status_code == 404
    # reopen
    assert c.post("/api/project/close").status_code == 204
    r = c.post("/api/project/open", json={"path": str(tmp_path / "p")})
    assert r.status_code == 200 and r.json()["manifest"]["name"] == "demo"
    assert c.post("/api/project/open", json={"path": str(tmp_path / "nope")}).status_code == 400


def test_openapi_has_structure_schema() -> None:
    spec = create_app().openapi()
    assert "Structure" in spec["components"]["schemas"]
    assert "VolumetricGrid" not in spec["components"]["schemas"]  # not exposed yet
