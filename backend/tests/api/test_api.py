import json
from pathlib import Path

import pytest
from ase.build import molecule
from fastapi.testclient import TestClient

from atomscope.api.app import create_app
from atomscope.ase_bridge import from_atoms
from atomscope.io import fetch as fetch_module
from atomscope.io import recent as recent_module
from atomscope.io.rdkit_io import from_smiles
from atomscope.model import Atom, Structure


def client(data_dir: Path | None = None) -> TestClient:
    return TestClient(create_app(data_dir))


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
    # its own data directory: opening a path records a recent file, and that is not this test's
    c = client(tmp_path / "data")
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
    # writing over an existing file needs saying so, so a Save As cannot silently replace one
    r = c.post("/api/io/export", json={"structure": water, "format": "xyz", "path": str(out)})
    assert r.status_code == 409
    r = c.post(
        "/api/io/export",
        json={"structure": water, "format": "xyz", "path": str(out), "overwrite": True},
    )
    assert r.status_code == 200
    # a directory is not a file to write over, and saying overwrite does not make it one
    r = c.post(
        "/api/io/export",
        json={"structure": water, "format": "xyz", "path": str(tmp_path), "overwrite": True},
    )
    assert r.status_code == 400
    r = c.post("/api/io/import/path", json={"path": str(out)})
    assert r.status_code == 200 and len(r.json()["bonds"]) == 2
    r = c.post("/api/io/import/upload", files={"file": ("w.xyz", out.read_bytes())})
    assert r.status_code == 200 and len(r.json()["atoms"]) == 3
    r = c.post("/api/io/import/text", json={"text": r_text})
    assert r.status_code == 200 and len(r.json()["atoms"]) == 3 and len(r.json()["bonds"]) == 2
    r = c.post("/api/io/import/text", json={"text": "CCO", "format": "smi"})
    assert r.status_code == 200 and len(r.json()["atoms"]) == 9
    assert c.post("/api/io/import/text", json={"text": "not a molecule\nat all"}).status_code == 400
    # a VASP 4 POSCAR: 422 with the counts, so the caller can ask which element each species is
    poscar = "cubic\n1.0\n5.4 0 0\n0 5.4 0\n0 0 5.4\n1 1\nDirect\n0 0 0\n0.25 0.25 0.25\n"
    r = c.post("/api/io/import/text", json={"text": poscar})
    assert r.status_code == 422 and r.json()["detail"]["counts"] == [1, 1]
    r = c.post("/api/io/import/text", json={"text": poscar, "species": ["Ga", "As"]})
    assert r.status_code == 200 and [a["element"] for a in r.json()["atoms"]] == ["Ga", "As"]
    assert c.post("/api/io/smiles", json={"smiles": "C("}).status_code == 400
    assert (
        c.post("/api/io/import/path", json={"path": str(tmp_path / "nope.xyz")}).status_code == 404
    )


def test_the_name_lookup_sends_a_key_and_not_the_structure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    asked: list[str] = []

    def get(url: str) -> str:
        asked.append(url)
        return "ethanol\n"

    monkeypatch.setattr(fetch_module, "_get", get)
    c = client()
    ethanol = json.loads(from_smiles("CCO").model_dump_json())

    r = c.post("/api/io/compound-name", json={"structure": ethanol})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == "ethanol" and body["source"] == "pubchem"
    # the address carries the key the backend computed, and nothing about the geometry
    assert len(asked) == 1
    assert body["inchikey"] in asked[0]
    assert "CCO" not in asked[0]

    empty = c.post("/api/io/compound-name", json={"structure": {"name": "empty"}})
    assert empty.status_code == 400


def test_fetch_validates_before_it_asks_and_reports_what_went_wrong(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    asked: list[str] = []

    def get(url: str) -> str:
        asked.append(url)
        raise fetch_module.NotFoundError("not in the database")

    monkeypatch.setattr(fetch_module, "_get", get)
    c = client()

    # a query that is not an identifier never becomes a request
    r = c.post("/api/io/fetch", json={"source": "pdb", "query": "../etc/passwd"})
    assert r.status_code == 400 and "not a PDB id" in r.json()["detail"]
    assert asked == []
    # nor does a source that is not one of the two databases
    assert c.post("/api/io/fetch", json={"source": "url", "query": "x"}).status_code == 422

    r = c.post("/api/io/fetch", json={"source": "pdb", "query": "9ZZZ"})
    assert r.status_code == 404
    assert asked == ["https://files.rcsb.org/download/9ZZZ.pdb"]

    def offline(url: str) -> str:
        raise fetch_module.UpstreamError("could not reach the database (offline)")

    monkeypatch.setattr(fetch_module, "_get", offline)
    r = c.post("/api/io/fetch", json={"source": "pubchem", "query": "caffeine"})
    assert r.status_code == 502 and "could not reach" in r.json()["detail"]


def test_recent_files_remember_what_was_opened_by_path(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    c = client(data_dir)
    assert c.get("/api/io/recent").json() == []

    first = tmp_path / "water.xyz"
    first.write_text("3\nwater\nO 0 0 0\nH 0 0.76 0.59\nH 0 -0.76 0.59\n")
    second = tmp_path / "methane.xyz"
    second.write_text("1\nc\nC 0 0 0\n")
    for p in (first, second, first):
        assert c.post("/api/io/import/path", json={"path": str(p)}).status_code == 200

    # most recent first, and a file opened twice appears once
    listed = c.get("/api/io/recent").json()
    assert [r["name"] for r in listed] == ["water.xyz", "methane.xyz"]
    assert all(r["exists"] for r in listed)

    # a path that is not a structure is not worth going back to
    bad = tmp_path / "notes.xyz"
    bad.write_text("this is not a structure\n")
    assert c.post("/api/io/import/path", json={"path": str(bad)}).status_code == 400
    assert [r["name"] for r in c.get("/api/io/recent").json()] == ["water.xyz", "methane.xyz"]

    # a file that has since moved is still listed, and says it is gone
    second.unlink()
    assert [r["exists"] for r in c.get("/api/io/recent").json()] == [True, False]

    # the list outlives the process, which is the point of it
    assert [r["name"] for r in client(data_dir).get("/api/io/recent").json()] == [
        "water.xyz",
        "methane.xyz",
    ]
    assert c.delete("/api/io/recent").json() == []
    assert c.get("/api/io/recent").json() == []


def test_a_data_directory_that_cannot_be_written_does_not_fail_the_open(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse(*_a: object, **_k: object) -> None:
        raise OSError("read-only file system")

    monkeypatch.setattr(recent_module, "_write", refuse)
    path = tmp_path / "water.xyz"
    path.write_text("3\nwater\nO 0 0 0\nH 0 0.76 0.59\nH 0 -0.76 0.59\n")
    c = client(tmp_path / "data")
    # the file read perfectly well; only the bookkeeping failed
    assert c.post("/api/io/import/path", json={"path": str(path)}).status_code == 200
    assert c.get("/api/io/recent").json() == []


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


def test_image_export_over_the_api(tmp_path: Path) -> None:
    """ASE's writers through the route, including the pov pair and the "not rendered" answer."""
    with TestClient(create_app(data_dir=tmp_path / "data")) as c:
        assert c.get("/api/io/image-formats").json() == ["png", "eps", "pov", "x3d", "html"]
        s = from_atoms(molecule("H2O"), name="water")
        body = {"structure": s.model_dump(mode="json"), "format": "png"}

        r = c.post("/api/io/export/image", json=body)
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["rendered"] is True
        assert out["note"] is None
        # no path given, so it lands in the app's own scratch directory, not the project
        (png,) = [Path(f) for f in out["files"]]
        assert png.is_file() and png.read_bytes()[:4] == b"\x89PNG"
        assert "data" in png.parts

        # pov writes the scene and its ini, and says why it did not render
        r = c.post(
            "/api/io/export/image",
            json={**body, "format": "pov", "options": {"rotation": "auto"}},
        )
        assert r.status_code == 200, r.text
        pov = r.json()
        assert pov["rendered"] is False
        assert "POV-Ray is not installed" in pov["note"]
        assert [Path(f).suffix for f in pov["files"]] == [".pov", ".ini"]

        # an explicit path is honoured, and is not overwritten without being asked
        target = tmp_path / "out" / "w.png"
        r = c.post("/api/io/export/image", json={**body, "path": str(target)})
        assert r.status_code == 200, r.text
        assert target.is_file()
        assert c.post("/api/io/export/image", json={**body, "path": str(target)}).status_code == 409
        r = c.post("/api/io/export/image", json={**body, "path": str(target), "overwrite": True})
        assert r.status_code == 200

        # a directory is a bad request rather than a confusing write failure
        r = c.post("/api/io/export/image", json={**body, "path": str(tmp_path)})
        assert r.status_code == 400
