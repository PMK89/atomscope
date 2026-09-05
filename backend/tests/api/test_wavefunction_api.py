"""API round trip for wavefunction loading and surface generation."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from atomscope.api import routes_wavefunction
from atomscope.api.app import create_app
from atomscope.wavefunction import (
    EvaluationCancelledError,
    EvaluationHooks,
    bounding_box,
    orbital_values,
    read_wavefunction,
)

TIMEOUT_S = 60.0


def surface(c: TestClient, body: dict[str, Any]) -> dict[str, Any]:
    """Start an evaluation and wait for it, as the panel does; returns the finished grid."""
    started = c.post("/api/wavefunction/surface", json=body)
    assert started.status_code == 200, started.text
    task = started.json()
    assert task["status"] == "running" or task["status"] == "done"
    deadline = time.monotonic() + TIMEOUT_S
    while task["status"] == "running":
        assert time.monotonic() < deadline, "the surface never finished"
        time.sleep(0.02)
        task = c.get(f"/api/wavefunction/surface/{task['id']}").json()
    assert task["status"] == "done", task
    assert task["progress"] == pytest.approx(1.0)
    return dict(task["grid"])


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

        grid = surface(c, {"path": str(fixtures / "co.fchk"), "kind": "orbital", "spacing": 0.4})
        assert grid["kind"] == "orbital" and grid["orbital"]["label"] == "HOMO"
        assert grid["data_ref"].startswith("datasets/") and grid["dtype"] == "float32"
        listed = c.get("/api/grids").json()
        assert any(g["grid"]["id"] == grid["id"] for g in listed)
        stats = c.get(f"/api/grids/{grid['id']}/stats").json()
        assert stats["min"] < 0 < stats["max"]  # an orbital has both signs

        density = surface(c, {"path": str(fixtures / "co.fchk"), "kind": "density", "spacing": 0.4})
        assert density["kind"] == "electron_density"
        assert c.get(f"/api/grids/{density['id']}/stats").json()["min"] >= 0

        vdw = surface(c, {"path": str(fixtures / "co.fchk"), "kind": "vdw", "spacing": 0.4})
        assert vdw["unit"] == "angstrom"

        esp = surface(
            c,
            {
                "path": str(fixtures / "co.fchk"),
                "kind": "electrostatic_potential",
                "spacing": 0.6,
                "padding": 2.5,
            },
        )
        assert esp["kind"] == "electrostatic_potential" and esp["unit"] == "hartree/e"

        assert (
            c.post("/api/wavefunction/load", json={"path": str(tmp_path / "nope.fchk")}).status_code
            == 404
        )
        # what can be refused is still refused synchronously: a 400, not a task that fails later
        too_fine = {
            "path": str(fixtures / "co.fchk"),
            "kind": "electrostatic_potential",
            "spacing": 0.05,
        }
        assert c.post("/api/wavefunction/surface", json=too_fine).status_code == 400
        no_orbital = {"path": str(fixtures / "co.fchk"), "kind": "orbital", "orbital_index": 999}
        assert c.post("/api/wavefunction/surface", json=no_orbital).status_code == 400


def test_a_surface_can_be_cancelled_while_it_runs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Cancel stops the evaluation itself, not just the waiting: it never writes a dataset."""
    fixtures = Path(__file__).resolve().parents[1] / "fixtures" / "wavefunction"

    def slow(*args: object, **kwargs: object) -> object:
        """Stand in for the arithmetic: waits to be told to stop, as a long walk would."""
        hooks = args[-1]
        assert isinstance(hooks, EvaluationHooks)
        hooks.step(1, 100)  # one chunk of progress, so the caller sees it moving
        deadline = time.monotonic() + TIMEOUT_S
        while time.monotonic() < deadline:
            hooks.step(50, 100)  # raises EvaluationCancelledError once cancel has been asked for
            time.sleep(0.01)
        raise AssertionError("the cancel never arrived")

    monkeypatch.setattr(routes_wavefunction, "_field_values", slow)
    with TestClient(create_app()) as c:
        c.post("/api/project/create", json={"path": str(tmp_path / "p"), "name": "wf"})
        started = c.post(
            "/api/wavefunction/surface",
            json={"path": str(fixtures / "co.fchk"), "kind": "orbital", "spacing": 0.4},
        ).json()
        assert started["status"] == "running"

        cancelled = c.post(f"/api/wavefunction/surface/{started['id']}/cancel").json()
        deadline = time.monotonic() + TIMEOUT_S
        while cancelled["status"] == "running":
            assert time.monotonic() < deadline, "the evaluation ignored the cancel"
            time.sleep(0.02)
            cancelled = c.get(f"/api/wavefunction/surface/{started['id']}").json()

        assert cancelled["status"] == "cancelled"
        assert cancelled["grid"] is None
        assert c.get("/api/grids").json() == []  # nothing was written for a cancelled evaluation

        assert c.get("/api/wavefunction/surface/not-a-task").status_code == 404
        assert c.post("/api/wavefunction/surface/not-a-task/cancel").status_code == 404


def test_a_failure_inside_the_evaluation_is_reported_on_the_task(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(*args: object, **kwargs: object) -> object:
        raise ValueError("the basis went missing")

    monkeypatch.setattr(routes_wavefunction, "_field_values", boom)
    fixtures = Path(__file__).resolve().parents[1] / "fixtures" / "wavefunction"
    with TestClient(create_app()) as c:
        c.post("/api/project/create", json={"path": str(tmp_path / "p"), "name": "wf"})
        task = c.post(
            "/api/wavefunction/surface",
            json={"path": str(fixtures / "co.fchk"), "kind": "density", "spacing": 0.4},
        ).json()
        deadline = time.monotonic() + TIMEOUT_S
        while task["status"] == "running":
            assert time.monotonic() < deadline
            time.sleep(0.02)
            task = c.get(f"/api/wavefunction/surface/{task['id']}").json()
        assert task["status"] == "failed"
        assert task["error"] == "the basis went missing"


def test_the_hooks_stop_a_real_evaluation_and_report_how_far_it_got() -> None:
    """The mechanism itself, without the API: `should_stop` ends the walk over the grid."""
    fixtures = Path(__file__).resolve().parents[1] / "fixtures" / "wavefunction"
    wf = read_wavefunction(fixtures / "co.fchk")
    box = bounding_box(wf.structure, padding=3.0, spacing=0.1)
    seen: list[float] = []
    orbital_values(wf, wf.homo_index(), box, EvaluationHooks(on_progress=seen.append))
    assert seen and seen[-1] == pytest.approx(1.0)
    assert all(0.0 < p <= 1.0 for p in seen)

    with pytest.raises(EvaluationCancelledError):
        orbital_values(wf, wf.homo_index(), box, EvaluationHooks(should_stop=lambda: True))
