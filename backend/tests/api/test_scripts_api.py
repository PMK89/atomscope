"""The Python scripting subsystem, over the API a script panel would use.

Each test writes a script, runs it and waits: the run really starts a child interpreter through
the job manager, so what is checked here is the whole path -- source stored in the project, input
structure handed over, output structures imported back, stdout and tracebacks readable,
cancellation reaching a runaway script.
"""

from __future__ import annotations

import time
from pathlib import Path

from ase.build import bulk, molecule
from fastapi.testclient import TestClient

from atomscope.api.app import create_app
from atomscope.ase_bridge import from_atoms
from atomscope.model.structure import Bond

DONE = ("completed", "failed", "cancelled")


def _project(c: TestClient, tmp_path: Path) -> None:
    r = c.post("/api/project/create", json={"path": str(tmp_path / "p"), "name": "scripts"})
    assert r.status_code == 201, r.text


def _wait(c: TestClient, run_id: str, timeout: float = 60.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = c.get(f"/api/scripts/runs/{run_id}").json()
        if run["status"] in DONE:
            return run
        time.sleep(0.1)
    raise AssertionError(f"run {run_id} did not finish: {run}")


def _run(c: TestClient, source: str, structure_id: str | None = None, name: str = "s") -> dict:
    assert c.put(f"/api/scripts/{name}", json={"source": source}).status_code == 200
    r = c.post(f"/api/scripts/{name}/run", json={"structure_id": structure_id})
    assert r.status_code == 201, r.text
    return _wait(c, r.json()["id"])


def _log(c: TestClient, run_id: str, stream: str) -> str:
    r = c.get(f"/api/scripts/runs/{run_id}/log", params={"stream": stream})
    return "\n".join(r.json()["lines"])


def test_a_script_saves_a_new_structure_and_leaves_the_input_alone(tmp_path: Path) -> None:
    with TestClient(create_app()) as c:
        _project(c, tmp_path)
        # bonds given explicitly: ASE has no bonds of its own, so `molecule()` brings none, and
        # a round trip through ase.Atoms is only lossless for what the structure actually holds
        s = from_atoms(molecule("H2O"), name="water")
        s.bonds = [Bond(a=0, b=1), Bond(a=0, b=2)]
        c.put(f"/api/structures/{s.id}", json=s.model_dump(mode="json"))
        before = c.get(f"/api/structures/{s.id}").json()

        run = _run(
            c,
            "from atomscope.scripting import save\n"
            "atoms.rattle(0.1, seed=7)\n"
            "print('saved', save(atoms, name='rattled'))\n",
            s.id,
        )
        assert run["status"] == "completed", _log(c, run["id"], "stderr")
        assert len(run["structure_ids"]) == 1
        new_id = run["structure_ids"][0]
        # a new structure, not the one the script was run on: `from_atoms` restores the source id
        # from atoms.info, so save() has to drop it or this would have overwritten the input
        assert new_id != s.id
        assert f"saved {new_id}" in _log(c, run["id"], "stdout")

        after = c.get(f"/api/structures/{s.id}").json()
        assert after["atoms"] == before["atoms"]
        moved = c.get(f"/api/structures/{new_id}").json()
        assert moved["name"] == "rattled"
        assert moved["atoms"][0]["position"] != before["atoms"][0]["position"]
        # the bonds survived the round trip through ase.Atoms
        assert len(moved["bonds"]) == len(before["bonds"]) == 2
        # and the atom uids did, so an output can be matched to its input atom for atom
        assert [a["uid"] for a in moved["atoms"]] == [a["uid"] for a in before["atoms"]]


def test_numpy_values_reach_the_run_record(tmp_path: Path) -> None:
    with TestClient(create_app()) as c:
        _project(c, tmp_path)
        s = from_atoms(molecule("H2O"), name="water")
        c.put(f"/api/structures/{s.id}", json=s.model_dump(mode="json"))
        run = _run(
            c,
            "import numpy as np\n"
            "from atomscope.scripting import value\n"
            # a numpy scalar and a numpy array: json.dumps refuses both, so value() coerces
            "value('mass', np.float64(atoms.get_masses().sum()))\n"
            "value('com', atoms.get_center_of_mass())\n"
            "value('formula', atoms.get_chemical_formula())\n",
            s.id,
        )
        assert run["status"] == "completed", _log(c, run["id"], "stderr")
        assert run["values"]["formula"] == "H2O"
        assert abs(run["values"]["mass"] - 18.015) < 0.01
        assert isinstance(run["values"]["com"], list) and len(run["values"]["com"]) == 3


def test_a_failing_script_reports_its_traceback(tmp_path: Path) -> None:
    with TestClient(create_app()) as c:
        _project(c, tmp_path)
        run = _run(
            c,
            "from atomscope.scripting import save\n"
            "save(__import__('ase').Atoms('He'), name='kept')\n"
            "raise ValueError('deliberate')\n",
        )
        assert run["status"] == "failed"
        assert run["error"]["type"] == "ValueError"
        assert run["error"]["message"] == "deliberate"
        assert "ValueError: deliberate" in run["error"]["traceback"]
        assert "ValueError: deliberate" in _log(c, run["id"], "stderr")
        # what it managed to save before raising is kept: the result is written in a finally
        assert len(run["structure_ids"]) == 1


def test_a_script_can_import_the_whole_environment(tmp_path: Path) -> None:
    """The child is the project's own interpreter, so ASE's own modules are importable."""
    with TestClient(create_app()) as c:
        _project(c, tmp_path)
        run = _run(
            c,
            "from ase.thermochemistry import IdealGasThermo, HarmonicThermo\n"
            "import scipy, numpy\n"
            "from atomscope.scripting import value\n"
            "value('ok', HarmonicThermo([0.1, 0.2]).get_ZPE_correction())\n",
        )
        assert run["status"] == "completed", _log(c, run["id"], "stderr")
        assert abs(run["values"]["ok"] - 0.15) < 1e-9


def test_a_script_can_load_another_structure_and_list_them(tmp_path: Path) -> None:
    with TestClient(create_app()) as c:
        _project(c, tmp_path)
        water = from_atoms(molecule("H2O"), name="water")
        copper = from_atoms(bulk("Cu"), name="copper")
        for s in (water, copper):
            c.put(f"/api/structures/{s.id}", json=s.model_dump(mode="json"))
        run = _run(
            c,
            "from atomscope.scripting import list_structures, load, value\n"
            "value('names', sorted(s['name'] for s in list_structures()))\n"
            f"value('cu', load({copper.id!r}).get_chemical_formula())\n",
            water.id,
        )
        assert run["status"] == "completed", _log(c, run["id"], "stderr")
        assert run["values"]["names"] == ["copper", "water"]
        assert run["values"]["cu"] == "Cu"


def test_a_script_cannot_reach_outside_the_structures_directory(tmp_path: Path) -> None:
    with TestClient(create_app()) as c:
        _project(c, tmp_path)
        run = _run(
            c,
            "from atomscope.scripting import load\nload('../../project')\n",
        )
        assert run["status"] == "failed"
        assert run["error"]["type"] == "ScriptApiError"


def test_a_runaway_script_can_be_cancelled(tmp_path: Path) -> None:
    with TestClient(create_app()) as c:
        _project(c, tmp_path)
        assert (
            c.put("/api/scripts/spin", json={"source": "while True:\n    pass\n"}).status_code
            == 200
        )
        run_id = c.post("/api/scripts/spin/run", json={}).json()["id"]
        for _ in range(100):
            if c.get(f"/api/scripts/runs/{run_id}").json()["status"] == "running":
                break
            time.sleep(0.05)
        run = c.post(f"/api/scripts/runs/{run_id}/cancel").json()
        assert run["status"] == "cancelled"


def test_scripts_are_stored_listed_and_deleted(tmp_path: Path) -> None:
    with TestClient(create_app()) as c:
        _project(c, tmp_path)
        c.put("/api/scripts/one", json={"source": "print(1)\n"})
        c.put("/api/scripts/two", json={"source": "print(2)\n"})
        assert [s["id"] for s in c.get("/api/scripts").json()] == ["one", "two"]
        assert c.get("/api/scripts/one").json()["source"] == "print(1)\n"
        # the file is where a project directory says it is, editable outside Atomscope
        assert (tmp_path / "p" / "scripts" / "one.py").read_text() == "print(1)\n"
        assert c.delete("/api/scripts/one").status_code == 204
        assert c.get("/api/scripts/one").status_code == 404
        assert c.get("/api/scripts/nope").status_code == 404


def test_a_script_id_cannot_escape_the_scripts_directory(tmp_path: Path) -> None:
    with TestClient(create_app()) as c:
        _project(c, tmp_path)
        for bad in ("../evil", "a/b", "with space", ""):
            r = c.put(f"/api/scripts/{bad}", json={"source": "print(1)\n"})
            assert r.status_code in (400, 404, 405), f"{bad!r} was accepted: {r.status_code}"


def test_the_shipped_examples_are_offered(tmp_path: Path) -> None:
    with TestClient(create_app()) as c:
        _project(c, tmp_path)
        examples = c.get("/api/scripts/examples").json()
        ids = [e["id"] for e in examples]
        assert "example" in ids
        assert (
            "from atomscope.scripting import"
            in dict((e["id"], e["source"]) for e in examples)["example"]
        )


def test_scripts_need_an_open_project(tmp_path: Path) -> None:
    with TestClient(create_app()) as c:
        assert c.get("/api/scripts").status_code == 409
