from typing import Any

import numpy as np
import pytest
from ase.build import bulk
from ase.spacegroup import crystal as ase_crystal
from fastapi.testclient import TestClient

from atomscope.api.app import create_app
from atomscope.ase_bridge.convert import from_atoms
from atomscope.model import Atom, Structure


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(create_app())


def _json(s: Structure) -> dict[str, Any]:
    return s.model_dump(mode="json")


SI = from_atoms(bulk("Si", "diamond", a=5.43), name="Si")
NACL = from_atoms(
    ase_crystal(
        ["Na", "Cl"], [(0, 0, 0), (0.5, 0.5, 0.5)], spacegroup=225, cellpar=[5.64] * 3 + [90] * 3
    ),
    name="NaCl",
)
PEROVSKITE = from_atoms(
    ase_crystal(
        ["Sr", "Ti", "O"],
        [(0, 0, 0), (0.5, 0.5, 0.5), (0.5, 0.5, 0)],
        spacegroup=221,
        cellpar=[3.905] * 3 + [90] * 3,
    ),
    name="SrTiO3",
)
WATER = Structure(
    name="water",
    atoms=[
        Atom(element="O", position=(0.0, 0.0, 0.0)),
        Atom(element="H", position=(0.76, 0.59, 0.0)),
        Atom(element="H", position=(-0.76, 0.59, 0.0)),
    ],
)


def _post(client: TestClient, path: str, body: dict[str, Any]) -> Structure:
    r = client.post(f"/api/crystal/{path}", json=body)
    assert r.status_code == 200, r.text
    return Structure.model_validate(r.json())


def test_symmetry(client: TestClient) -> None:
    r = client.post("/api/crystal/symmetry", json={"structure": _json(SI)})
    assert r.status_code == 200, r.text
    info = r.json()
    assert (info["number"], info["international"]) == (227, "Fd-3m")
    assert info["lattice_type"] == "cubic" and info["symprec"] == 1e-3
    r = client.post("/api/crystal/symmetry", json={"structure": _json(NACL), "symprec": 0.01})
    assert r.json()["international"] == "Fm-3m" and r.json()["number"] == 225
    assert (
        client.post("/api/crystal/symmetry", json={"structure": _json(PEROVSKITE)}).json()["number"]
        == 221
    )
    r = client.post("/api/crystal/symmetry", json={"structure": _json(WATER)})
    assert r.status_code == 400 and "no unit cell" in r.json()["detail"]
    r = client.post("/api/crystal/symmetry", json={"structure": _json(SI), "symprec": 0})
    assert r.status_code == 422


def test_set_cell_parameters_and_matrix(client: TestClient) -> None:
    out = _post(
        client,
        "cell/set",
        {"structure": _json(NACL), "parameters": [6, 6, 6, 90, 90, 90], "mode": "fractional"},
    )
    assert out.cell is not None and out.cell.volume() == pytest.approx(216.0)
    assert np.allclose(out.positions(), NACL.positions() * 6 / 5.64)
    out = _post(
        client,
        "cell/set",
        {"structure": _json(NACL), "vectors": [[6, 0, 0], [0, 6, 0], [0, 0, 6]]},
    )
    assert np.allclose(out.positions(), NACL.positions())
    r = client.post("/api/crystal/cell/set", json={"structure": _json(NACL)})
    assert r.status_code == 400
    zero = [[0, 0, 0]] * 3
    r = client.post("/api/crystal/cell/set", json={"structure": _json(NACL), "vectors": zero})
    assert r.status_code == 400 and "linearly dependent" in r.json()["detail"]
    r = client.post(
        "/api/crystal/translate",
        json={"structure": _json(NACL), "vector": [1, 0, 0], "indices": [99]},
    )
    assert r.status_code == 400


def test_add_remove_cell(client: TestClient) -> None:
    boxed = _post(client, "cell/add", {"structure": _json(WATER), "padding": 4.0})
    assert boxed.cell is not None and boxed.n_atoms == 3
    bare = _post(client, "cell/remove", {"structure": _json(boxed)})
    assert bare.cell is None


def test_fractional_routes(client: TestClient) -> None:
    r = client.post("/api/crystal/fractional", json={"structure": _json(NACL)})
    assert r.status_code == 200 and len(r.json()["fractional"]) == 8
    frac = r.json()["fractional"]
    frac[0] = [0.1, 0.1, 0.1]
    out = _post(client, "fractional/set", {"structure": _json(NACL), "fractional": frac})
    assert np.allclose(out.atoms[0].position, np.array([0.1, 0.1, 0.1]) * 5.64)


def test_wrap_translate_orient_scale(client: TestClient) -> None:
    moved = _post(
        client,
        "translate",
        {"structure": _json(NACL), "vector": [1.5, 0, 0], "mode": "fractional"},
    )
    assert np.allclose(moved.positions()[:, 0] - NACL.positions()[:, 0], 1.5 * 5.64)
    wrapped = _post(client, "wrap", {"structure": _json(moved)})
    frac = client.post("/api/crystal/fractional", json={"structure": _json(wrapped)}).json()
    assert all(-1e-9 <= x < 1 for row in frac["fractional"] for x in row)
    oriented = _post(client, "standard-orientation", {"structure": _json(SI)})
    assert oriented.cell is not None and abs(oriented.cell.vectors[0][1]) < 1e-9
    scaled = _post(client, "scale-volume", {"structure": _json(SI), "volume": 50.0})
    assert scaled.cell is not None and scaled.cell.volume() == pytest.approx(50.0)
    assert client.post("/api/crystal/wrap", json={"structure": _json(WATER)}).status_code == 400


def test_symmetry_transforms(client: TestClient) -> None:
    conv = _post(client, "symmetrize", {"structure": _json(SI)})
    assert conv.n_atoms == 8
    prim = _post(client, "primitive", {"structure": _json(conv)})
    assert prim.n_atoms == 2
    assert _post(client, "primitive-standardized", {"structure": _json(NACL)}).n_atoms == 2
    assert _post(client, "niggli", {"structure": _json(SI)}).n_atoms == 2
    asym = _post(client, "asymmetric-unit", {"structure": _json(NACL)})
    assert asym.n_atoms == 2
    filled = _post(client, "fill", {"structure": _json(asym), "spacegroup": 225})
    assert filled.n_atoms == 8
    assert _post(client, "fill", {"structure": _json(NACL)}).n_atoms == 8
    for path in ("symmetrize", "primitive", "niggli", "fill", "asymmetric-unit"):
        assert (
            client.post(f"/api/crystal/{path}", json={"structure": _json(WATER)}).status_code == 400
        )


def test_builders(client: TestClient) -> None:
    sc = _post(client, "supercell", {"structure": _json(SI), "repeat": [2, 2, 2]})
    assert sc.n_atoms == 16
    slab = _post(
        client, "slab", {"structure": _json(SI), "miller": [1, 1, 1], "layers": 3, "vacuum": 10.0}
    )
    assert slab.n_atoms == 6 and slab.cell is not None
    assert slab.cell.pbc == (True, True, False) and slab.cell.lengths_angles()[0][2] > 20
    assert (
        client.post(
            "/api/crystal/slab", json={"structure": _json(WATER), "miller": [1, 0, 0], "layers": 1}
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/crystal/supercell", json={"structure": _json(WATER), "repeat": [2, 2, 2]}
        ).status_code
        == 400
    )
    cu = _post(client, "bulk", {"symbol": "Cu", "crystalstructure": "fcc", "a": 3.6, "cubic": True})
    assert cu.n_atoms == 4
    assert (
        client.post(
            "/api/crystal/bulk", json={"symbol": "Cu", "crystalstructure": "bogus"}
        ).status_code
        == 400
    )
    nacl = _post(
        client,
        "spacegroup",
        {
            "symbols": ["Na", "Cl"],
            "basis": [[0, 0, 0], [0.5, 0.5, 0.5]],
            "spacegroup": 225,
            "cellpar": [5.64, 5.64, 5.64, 90, 90, 90],
        },
    )
    assert nacl.n_atoms == 8


def test_spacegroup_table_and_fill_by_setting(client: TestClient) -> None:
    r = client.get("/api/crystal/spacegroups")
    assert r.status_code == 200
    table = r.json()
    assert len(table) == 530
    assert table[0]["hall_number"] == 1 and table[0]["number"] == 1
    assert table[-1]["number"] == 230
    assert {"hall_number", "number", "international", "international_full", "hall", "choice"} == set(
        table[0]
    )

    asym = _post(client, "asymmetric-unit", {"structure": _json(NACL)})
    filled = _post(client, "fill", {"structure": _json(asym), "hall_number": 523})
    assert filled.n_atoms == 8
    bad = client.post("/api/crystal/fill", json={"structure": _json(asym), "hall_number": 999})
    assert bad.status_code == 422  # the request model knows the range


def test_library(client: TestClient) -> None:
    r = client.get("/api/crystal/library")
    assert r.status_code == 200
    entries = r.json()
    assert len(entries) == 507
    assert {"category", "name", "formula", "readable"} == set(entries[0])
    r = client.get("/api/crystal/library/halides/NaCl-Halite")
    assert r.status_code == 200 and len(r.json()["atoms"]) == 8
    assert r.json()["name"] == "NaCl-Halite" and r.json()["cell"] is not None
    assert client.get("/api/crystal/library/halides/Nope").status_code == 404
    bad = next(e for e in entries if not e["readable"])
    assert client.get(f"/api/crystal/library/{bad['category']}/{bad['name']}").status_code == 400
