"""Contract tests for /api/analysis and the spectrum/vibration import routes."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from atomscope.api.app import create_app
from atomscope.io.rdkit_io import from_smiles

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "spectra"


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(create_app())


@pytest.fixture(scope="module")
def water() -> dict[str, Any]:
    return from_smiles("O").model_dump(mode="json")


def test_vibrations_of_water_with_mmff94(client: TestClient, water: dict[str, Any]) -> None:
    r = client.post("/api/analysis/vibrations", json={"structure": water})
    assert r.status_code == 200, r.text
    body = r.json()
    modes = body["vibrations"]["modes"]
    assert len(modes) == 3
    assert len(body["vibrations"]["trivial_modes"]) == 6
    assert body["vibrations"]["linear"] is False
    assert body["vibrations"]["zero_point_energy"] > 0
    assert "approximate" in body["vibrations"]["method"]
    frequencies = [m["frequency"] for m in modes]
    assert frequencies == sorted(frequencies)
    assert frequencies[0] < frequencies[1] - 1000  # bend well below the stretches
    assert body["ir"]["kind"] == "ir" and body["ir"]["x"]["descending"] is True
    assert len(body["ir"]["peaks"]) == 3
    assert body["structure"]["atoms"][0]["element"] == "O"


def test_vibrations_reject_an_unknown_calculator(client: TestClient, water: dict[str, Any]) -> None:
    r = client.post(
        "/api/analysis/vibrations", json={"structure": water, "calculator": "dft-magic"}
    )
    assert r.status_code == 400
    assert "dft-magic" in r.json()["detail"]


def test_vibrations_enforce_the_synchronous_size_limit(client: TestClient) -> None:
    big = from_smiles("C" * 30).model_dump(mode="json")
    r = client.post("/api/analysis/vibrations", json={"structure": big})
    assert r.status_code == 413
    assert "exceeds the synchronous limit" in r.json()["detail"]


def test_rebroadening_modes_changes_the_curve_but_not_the_sticks(
    client: TestClient, water: dict[str, Any]
) -> None:
    computed = client.post("/api/analysis/vibrations", json={"structure": water}).json()
    payload = {
        "vibrations": computed["vibrations"],
        "width": 5.0,
        "shape": "lorentzian",
        "transmittance": True,
    }
    r = client.post("/api/analysis/vibrations/spectrum", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["line_shape"] == "lorentzian" and body["width"] == 5.0
    assert body["y"]["unit"] == "%"
    assert min(body["y_values"]) >= 0 and max(body["y_values"]) <= 100
    assert [p["x"] for p in body["peaks"]] == [p["x"] for p in computed["ir"]["peaks"]]


def test_spectrum_broadens_arbitrary_peaks(client: TestClient) -> None:
    payload = {
        "peaks": [{"x": 1000.0, "intensity": 10.0}, {"x": 1600.0, "intensity": 4.0}],
        "kind": "ir",
        "name": "custom",
        "x": {"label": "wavenumber", "unit": "cm^-1", "descending": True},
        "y": {"label": "intensity", "unit": "km/mol"},
        "width": 25.0,
        "points": 512,
    }
    r = client.post("/api/analysis/spectrum", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["x_values"]) == len(body["y_values"]) == 512
    peak_x = body["x_values"][body["y_values"].index(max(body["y_values"]))]
    assert peak_x == pytest.approx(1000.0, abs=25.0)


def test_spectrum_rejects_a_non_positive_width(client: TestClient) -> None:
    payload = {
        "peaks": [],
        "x": {"label": "x", "unit": ""},
        "y": {"label": "y", "unit": ""},
        "width": 0.0,
    }
    assert client.post("/api/analysis/spectrum", json=payload).status_code == 422


def test_import_experimental_spectrum_from_a_path(client: TestClient) -> None:
    r = client.post("/api/io/import/spectrum", json={"path": str(FIXTURES / "sampleIRSpectra.tsv")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "experimental"
    assert len(body["x_values"]) == 400


def test_import_jcamp_dx_by_upload(client: TestClient) -> None:
    data = (FIXTURES / "methanol.jdx").read_bytes()
    r = client.post(
        "/api/io/import/spectrum/upload", files={"file": ("methanol.jdx", data, "text/plain")}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == "METHANOL"
    assert body["x"]["unit"] == "cm^-1"
    assert len(body["x_values"]) == 3567


def test_import_of_a_missing_file_is_404(client: TestClient) -> None:
    r = client.post("/api/io/import/spectrum", json={"path": "/nonexistent/spectrum.tsv"})
    assert r.status_code == 404


def test_import_of_a_file_without_data_is_400(client: TestClient, tmp_path: Path) -> None:
    junk = tmp_path / "junk.tsv"
    junk.write_text("nothing numeric here\n")
    r = client.post("/api/io/import/spectrum", json={"path": str(junk)})
    assert r.status_code == 400


@pytest.mark.parametrize(
    ("name", "expected_program", "expected_modes"),
    [
        ("methane.g03", "gaussian", 12),
        ("caffeine_orca.out", "orca", 72),
        ("methane_qchem.out", "qchem", 9),
    ],
)
def test_import_vibrations_detects_the_program(
    client: TestClient, name: str, expected_program: str, expected_modes: int
) -> None:
    data = (FIXTURES / name).read_bytes()
    r = client.post("/api/io/import/vibrations/upload", files={"file": (name, data)})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["program"] == expected_program
    assert len(body["vibrations"]["modes"]) == expected_modes
    assert body["structure"] is not None


def test_import_vibrations_returns_nmr_shieldings(client: TestClient) -> None:
    r = client.post("/api/io/import/vibrations", json={"path": str(FIXTURES / "ch3oh_nmr.qcout")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["program"] == "qchem"
    assert body["vibrations"] is None
    assert len(body["shieldings"]) == 6


def test_import_vibrations_of_an_unparsable_file_is_400(client: TestClient) -> None:
    r = client.post("/api/io/import/vibrations/upload", files={"file": ("x.log", b"hello world\n")})
    assert r.status_code == 400
