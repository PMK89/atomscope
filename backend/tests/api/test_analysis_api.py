"""Contract tests for /api/analysis and the spectrum/vibration import routes."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from ase.build import add_adsorbate, fcc100
from ase.calculators.emt import EMT
from ase.constraints import FixAtoms
from ase.optimize import BFGS
from fastapi.testclient import TestClient

from atomscope.api.app import create_app
from atomscope.ase_bridge import from_atoms
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
    big = from_smiles("C" * 45).model_dump(mode="json")
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
    # imported geometries carry perceived bonds, so the viewport draws sticks
    assert len(body["structure"]["bonds"]) > 0


def test_import_vibrations_returns_nmr_shieldings(client: TestClient) -> None:
    r = client.post("/api/io/import/vibrations", json={"path": str(FIXTURES / "ch3oh_nmr.qcout")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["program"] == "qchem"
    assert body["vibrations"] is None
    assert len(body["shieldings"]) == 6


def test_nmr_spectrum_from_imported_shieldings(client: TestClient) -> None:
    """The shieldings a Q-Chem run reports become a chemical-shift spectrum: delta = ref - sigma,
    so a more shielded nucleus appears at a smaller shift."""
    imported = client.post(
        "/api/io/import/vibrations", json={"path": str(FIXTURES / "ch3oh_nmr.qcout")}
    ).json()
    shieldings = imported["shieldings"]
    protons = [s for s in shieldings if s["element"] == "H"]
    assert len(protons) > 1

    r = client.post(
        "/api/analysis/nmr",
        json={"shieldings": shieldings, "element": "H", "reference": 31.7, "width": 0.05},
    )
    assert r.status_code == 200, r.text
    spectrum = r.json()
    assert spectrum["kind"] == "nmr" and len(spectrum["peaks"]) == len(protons)
    most_shielded = max(protons, key=lambda s: s["isotropic"])
    smallest_shift = min(p["x"] for p in spectrum["peaks"])
    assert smallest_shift == pytest.approx(31.7 - most_shielded["isotropic"])
    # only the requested nucleus is plotted
    assert client.post("/api/analysis/nmr", json={"shieldings": shieldings, "element": "C"}).json()[
        "peaks"
    ]


def test_uvvis_and_cd_spectra_from_transitions(client: TestClient) -> None:
    transitions = [
        {"energy": 3.1, "wavelength": 400.0, "oscillator_strength": 0.4, "rotatory_strength": -2.0},
        {"energy": 4.0, "wavelength": 310.0, "oscillator_strength": 0.1, "rotatory_strength": 1.5},
    ]
    absorption = client.post("/api/analysis/electronic", json={"transitions": transitions}).json()
    assert absorption["kind"] == "uvvis"
    assert min(absorption["y_values"]) >= 0  # absorption cannot be negative

    cd = client.post(
        "/api/analysis/electronic", json={"transitions": transitions, "circular_dichroism": True}
    ).json()
    assert cd["kind"] == "cd"
    # a negative rotatory strength must survive as a negative band
    assert min(cd["y_values"]) < 0 < max(cd["y_values"])


def test_import_vibrations_of_an_unparsable_file_is_400(client: TestClient) -> None:
    r = client.post("/api/io/import/vibrations/upload", files={"file": ("x.log", b"hello world\n")})
    assert r.status_code == 400


def test_vibrations_with_an_ase_builtin_calculator(client: TestClient) -> None:
    """Lennard-Jones has no dipole, so the modes come back without IR intensities."""
    argon = {
        "name": "ar2",
        "atoms": [
            {"element": "Ar", "position": [0.0, 0.0, 0.0]},
            {"element": "Ar", "position": [0.0, 0.0, 3.4]},
        ],
    }
    r = client.post(
        "/api/analysis/vibrations", json={"structure": argon, "calculator": "lj", "delta": 0.005}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["vibrations"]["modes"]) == 1  # 3N - 5 for a linear dimer
    assert body["vibrations"]["linear"] is True
    assert body["vibrations"]["modes"][0]["ir_intensity"] is None


def test_emt_without_parameters_for_an_element_is_a_400(client: TestClient) -> None:
    uranium = {
        "name": "u2",
        "atoms": [
            {"element": "U", "position": [0.0, 0.0, 0.0]},
            {"element": "U", "position": [0.0, 0.0, 2.8]},
        ],
    }
    r = client.post("/api/analysis/vibrations", json={"structure": uranium, "calculator": "emt"})
    assert r.status_code == 400


def test_neb_over_the_api() -> None:
    """The Au/Al(100) hop from ASE's own NEB tutorial, whose barrier is documented as ~0.40 eV."""
    slab = fcc100("Al", size=(2, 2, 3))
    add_adsorbate(slab, "Au", 1.7, "hollow")
    slab.center(axis=2, vacuum=4.0)
    slab.set_constraint(FixAtoms(mask=[a.symbol != "Au" for a in slab]))
    slab.calc = EMT()
    BFGS(slab, logfile=None).run(fmax=0.01)
    initial = slab.copy()
    final = slab.copy()
    final[-1].x += final.get_cell()[0, 0] / 2
    final.calc = EMT()
    BFGS(final, logfile=None).run(fmax=0.01)

    with TestClient(create_app()) as c:
        r = c.post(
            "/api/analysis/neb",
            json={
                "initial": from_atoms(initial, name="start").model_dump(mode="json"),
                "final": from_atoms(final, name="end").model_dump(mode="json"),
                "calculator": "emt",
                "images": 5,
                "fmax": 0.05,
                "max_steps": 100,
            },
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["converged"] is True
        assert d["note"] is None
        assert d["barrier"] == pytest.approx(0.40, abs=0.02)
        assert d["transition_index"] == 2
        assert d["trajectory"]["kind"] == "neb"
        assert len(d["trajectory"]["frames"]) == 5
        # the chart's y is relative to the first image, which is what a barrier plot shows
        e = d["energy"]
        assert e["y"][0] == pytest.approx(0.0, abs=1e-9)
        assert e["y"][2] == pytest.approx(d["barrier"], abs=1e-9)
        assert e["x_unit"] == "A" and e["y_unit"] == "eV"

        # mismatched ends are a bad request, not a barrier between unrelated structures
        bad = c.post(
            "/api/analysis/neb",
            json={
                "initial": from_atoms(initial, name="start").model_dump(mode="json"),
                "final": from_atoms(initial[:-1], name="short").model_dump(mode="json"),
                "calculator": "emt",
            },
        )
        assert bad.status_code == 400
        assert "atoms" in bad.json()["detail"]
