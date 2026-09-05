"""API contract tests for the chemistry (force field, hydrogens, charges) and builder routes."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from atomscope.api.app import create_app
from atomscope.io.rdkit_io import from_smiles
from atomscope.model import Structure


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(create_app())


@pytest.fixture(scope="module")
def ethanol() -> Structure:
    return from_smiles("CCO")


def js(structure: Structure) -> dict[str, Any]:
    return structure.model_dump(mode="json")


# ---- chemistry -------------------------------------------------------------------------------


def test_force_field_discovery(client: TestClient) -> None:
    info = client.get("/api/chem/force-fields").json()
    assert "MMFF94" in info["force_fields"] and "UFF" in info["force_fields"]
    assert "gasteiger" in info["charge_models"]
    assert "steepest_descent" in info["algorithms"]


def test_energy_and_optimization_lowers_it(client: TestClient, ethanol: Structure) -> None:
    r = client.post("/api/chem/energy", json={"structure": js(ethanol), "force_field": "MMFF94"})
    assert r.status_code == 200, r.text
    e0 = r.json()["energy"]["value"]
    assert r.json()["energy"]["unit"] == "eV"
    r = client.post(
        "/api/chem/optimize",
        json={
            "structure": js(ethanol),
            "force_field": "MMFF94",
            "max_steps": 200,
            "record_every": 20,
        },
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["energy"]["value"] <= e0 + 1e-9
    assert len(out["structure"]["atoms"]) == ethanol.n_atoms
    assert out["structure"]["atomic_vectors"].get("forces") is not None


def test_optimize_step_respects_fixed_atoms(client: TestClient, ethanol: Structure) -> None:
    body = {
        "structure": js(ethanol),
        "force_field": "UFF",
        "steps": 5,
        "fixed_atoms": [0],
    }
    r = client.post("/api/chem/optimize-step", json=body)
    assert r.status_code == 200, r.text
    moved = r.json()["structure"]["atoms"]
    assert moved[0]["position"] == pytest.approx(list(ethanol.atoms[0].position), abs=1e-6)
    assert moved != js(ethanol)["atoms"]


def test_unknown_force_field_is_a_client_error(client: TestClient, ethanol: Structure) -> None:
    r = client.post("/api/chem/energy", json={"structure": js(ethanol), "force_field": "NOPE"})
    assert r.status_code == 400


def test_hydrogen_round_trip(client: TestClient, ethanol: Structure) -> None:
    stripped = client.post("/api/chem/remove-hydrogens", json={"structure": js(ethanol)}).json()
    assert "H" not in [a["element"] for a in stripped["atoms"]]
    added = client.post("/api/chem/add-hydrogens", json={"structure": stripped}).json()
    assert [a["element"] for a in added["atoms"]].count("H") == 6
    assert len(added["bonds"]) == 8


def test_add_hydrogens_for_ph(client: TestClient) -> None:
    acid = from_smiles("CC(=O)O")
    r = client.post("/api/chem/add-hydrogens", json={"structure": js(acid), "ph": 10.0})
    assert r.status_code == 200
    # at pH 10 acetic acid is deprotonated: fewer hydrogens than the neutral molecule
    assert [a["element"] for a in r.json()["atoms"]].count("H") <= acid.symbols().count("H")


def test_partial_charges_sum_to_total_charge(client: TestClient, ethanol: Structure) -> None:
    r = client.post(
        "/api/chem/partial-charges", json={"structure": js(ethanol), "model": "gasteiger"}
    )
    assert r.status_code == 200, r.text
    out = r.json()
    charges = out["structure"]["atomic_scalars"]["partial_charges"]["values"]
    assert len(charges) == ethanol.n_atoms
    assert sum(charges) == pytest.approx(0.0, abs=1e-3)
    assert out["total_charge"] == pytest.approx(0.0, abs=1e-3)
    assert out["dipole"]["magnitude"]["value"] > 0.0
    assert out["dipole"]["magnitude"]["unit"] in ("debye", "e*angstrom")


def test_perceive_bonds_and_aromaticity(client: TestClient) -> None:
    benzene = from_smiles("c1ccccc1")
    bare = benzene.model_copy(update={"bonds": []})
    r = client.post("/api/chem/perceive-bonds", json={"structure": js(bare), "bond_orders": True})
    assert r.status_code == 200 and len(r.json()["bonds"]) == 12
    a = client.post("/api/chem/aromaticity", json={"structure": js(benzene)}).json()
    assert a["ring_count"] == 1 and a["aromatic_ring_count"] == 1
    assert len(a["aromatic_atoms"]) == 6
    assert sum(1 for b in a["structure"]["bonds"] if b["aromatic"]) == 6


def test_identifiers(client: TestClient, ethanol: Structure) -> None:
    ids = client.post("/api/chem/identifiers", json={"structure": js(ethanol)}).json()
    assert ids["smiles"].upper().replace("@", "") in ("CCO", "OCC")
    assert ids["inchi"].startswith("InChI=")
    assert ids["inchikey"]


def test_index_validation(client: TestClient, ethanol: Structure) -> None:
    r = client.post("/api/chem/remove-hydrogens", json={"structure": js(ethanol), "indices": [99]})
    assert r.status_code == 400 and "out of range" in r.json()["detail"]


def test_conformer_search(client: TestClient) -> None:
    butane = from_smiles("CCCC")
    r = client.post(
        "/api/chem/conformers",
        json={
            "structure": js(butane),
            "force_field": "MMFF94",
            "method": "weighted",
            "n_conformers": 4,
            "steps": 20,
        },
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert len(out["trajectory"]["frames"]) >= 1
    energies = [f["energy"] for f in out["trajectory"]["frames"]]
    assert all(e is not None for e in energies)
    # the returned structure is the lowest-energy conformer of the search
    assert min(energies) == pytest.approx(min(energies), abs=1e-9) and out["structure"]["atoms"], (
        "a best conformer is returned"
    )
    best = client.post(
        "/api/chem/energy", json={"structure": out["structure"], "force_field": "MMFF94"}
    )
    assert best.json()["energy"]["value"] == pytest.approx(min(energies), abs=1e-4)


# ---- builders --------------------------------------------------------------------------------


def test_fragment_library_routes(client: TestClient) -> None:
    entries = client.get("/api/build/fragments").json()
    assert len(entries) > 300
    benzene_id = next(e["id"] for e in entries if e["name"].lower() == "benzene")
    fragment = client.get(f"/api/build/fragments/{benzene_id}").json()
    assert len(fragment["atoms"]) == 12
    assert client.get("/api/build/fragments/nope/nothing").status_code == 404


def test_insert_fragment_route(client: TestClient) -> None:
    methane = from_smiles("C")
    r = client.post(
        "/api/build/insert",
        json={"structure": js(methane), "fragment_id": "alkanes/methane", "attach_atom": 1},
    )
    assert r.status_code == 200, r.text
    merged = r.json()
    assert [a["element"] for a in merged["atoms"]].count("C") == 2
    assert [a["element"] for a in merged["atoms"]].count("H") == 6


def test_peptide_route_presets(client: TestClient) -> None:
    presets = client.get("/api/build/peptide/presets").json()["presets"]
    assert "alpha_helix" in presets and len(presets["alpha_helix"]) == 2
    r = client.post("/api/build/peptide", json={"sequence": "AAA", "preset": "alpha_helix"})
    assert r.status_code == 200, r.text
    assert len(r.json()["atoms"]) == 33
    assert client.post("/api/build/peptide", json={"sequence": "AXZ"}).status_code == 400


def test_nucleic_route(client: TestClient) -> None:
    r = client.post("/api/build/nucleic", json={"sequence": "ATGC", "double_strand": True})
    assert r.status_code == 200, r.text
    out = r.json()
    assert len(out["residues"]) == 8
    assert client.post("/api/build/nucleic", json={"sequence": "ATQX"}).status_code == 400


def test_nanotube_and_graphene_routes(client: TestClient) -> None:
    r = client.post("/api/build/nanotube", json={"n": 5, "m": 5, "length": 2})
    assert r.status_code == 200 and len(r.json()["atoms"]) == 40
    g = client.post("/api/build/graphene", json={"n": 3, "m": 4})
    assert g.status_code == 200 and any(a["element"] == "H" for a in g.json()["atoms"])
