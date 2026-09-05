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
    assert "VolumetricGrid" in spec["components"]["schemas"]  # via ResultBundle


def test_io_routes(tmp_path: Path) -> None:
    c = client()
    assert any(f["name"] == "xyz" for f in c.get("/api/io/formats").json())
    r = c.post("/api/io/smiles", json={"smiles": "O"})
    assert r.status_code == 200 and r.json()["atoms"].__len__() == 3
    water = r.json()
    r = c.post("/api/io/export", json={"structure": water, "format": "xyz"})
    assert r.status_code == 200 and r.json()["text"].startswith("3\n")
    r_text = r.json()["text"]
    out = tmp_path / "w.xyz"
    r = c.post("/api/io/export", json={"structure": water, "format": "xyz", "path": str(out)})
    assert r.status_code == 200 and out.exists()
    r = c.post("/api/io/import/path", json={"path": str(out)})
    assert r.status_code == 200 and len(r.json()["bonds"]) == 2
    r = c.post("/api/io/import/upload", files={"file": ("w.xyz", out.read_bytes())})
    assert r.status_code == 200 and len(r.json()["atoms"]) == 3
    r = c.post("/api/io/import/text", json={"text": r_text})
    assert r.status_code == 200 and len(r.json()["atoms"]) == 3 and len(r.json()["bonds"]) == 2
    r = c.post("/api/io/import/text", json={"text": "CCO", "format": "smi"})
    assert r.status_code == 200 and len(r.json()["atoms"]) == 9
    assert c.post("/api/io/import/text", json={"text": "not a molecule\nat all"}).status_code == 400
    assert c.post("/api/io/smiles", json={"smiles": "C("}).status_code == 400
    assert (
        c.post("/api/io/import/path", json={"path": str(tmp_path / "nope.xyz")}).status_code == 404
    )


def test_view_settings_persist(tmp_path: Path) -> None:
    c = client()
    c.post("/api/project/create", json={"path": str(tmp_path / "p"), "name": "v"})
    assert c.get("/api/project/view-settings").json() == {}
    r = c.put(
        "/api/project/view-settings", json={"settings": {"style": "stick", "background": "black"}}
    )
    assert r.status_code == 200 and r.json()["style"] == "stick"
    c.post("/api/project/close")
    c.post("/api/project/open", json={"path": str(tmp_path / "p")})
    assert c.get("/api/project/view-settings").json()["background"] == "black"
