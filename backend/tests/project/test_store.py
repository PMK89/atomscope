from pathlib import Path

import pytest

from atomscope.model import Atom, Structure, VolumetricGrid
from atomscope.project import ProjectStore
from atomscope.project.store import ProjectError
from atomscope.units import Unit


def test_create_open_roundtrip(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "proj", "demo")
    s = Structure(
        name="h2",
        atoms=[Atom(element="H", position=(0, 0, 0)), Atom(element="H", position=(0.74, 0, 0))],
    )
    store.save_structure(s)
    again = ProjectStore.open(tmp_path / "proj")
    assert again.manifest.name == "demo"
    assert again.manifest.structure_ids == [s.id]
    assert again.load_structure(s.id) == s
    text = (tmp_path / "proj" / "structures" / f"{s.id}.json").read_text()
    assert text.startswith('{\n  "atomic_scalars"')


def test_create_refuses_non_empty(tmp_path: Path) -> None:
    (tmp_path / "x").mkdir()
    (tmp_path / "x" / "junk").write_text("!")
    with pytest.raises(ProjectError):
        ProjectStore.create(tmp_path / "x", "demo")


def test_path_escape_blocked(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "p", "demo")
    with pytest.raises(ProjectError):
        store.path_in_project("..", "etc", "passwd")
    with pytest.raises(ProjectError):
        store.structure_path("../evil")


def test_delete_and_calculation_dirs(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "p", "demo")
    s = Structure(atoms=[Atom(element="He", position=(0, 0, 0))])
    store.save_structure(s)
    store.delete_structure(s.id)
    assert store.manifest.structure_ids == []
    d = store.register_calculation("calc1")
    assert (d / "input").is_dir() and (d / "work").is_dir() and (d / "results").is_dir()
    assert ProjectStore.open(tmp_path / "p").manifest.calculation_ids == ["calc1"]


def test_listing_survives_a_missing_or_corrupt_structure_file(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "p", "demo")
    keep = Structure(name="keep", atoms=[Atom(element="He", position=(0, 0, 0))])
    gone = Structure(name="gone", atoms=[Atom(element="Ne", position=(0, 0, 0))])
    broken = Structure(name="broken", atoms=[Atom(element="Ar", position=(0, 0, 0))])
    for s in (keep, gone, broken):
        store.save_structure(s)
    store.structure_path(gone.id).unlink()
    store.structure_path(broken.id).write_text("{not json")

    listed = store.list_structures()
    assert [s.name for s in listed] == ["keep"]
    # the manifest is repaired so the next open is clean
    assert ProjectStore.open(tmp_path / "p").manifest.structure_ids == [keep.id]


def test_dataset_listing_prunes_missing_entries(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "p", "demo")
    grid = VolumetricGrid(
        id="g1",
        name="density",
        origin=(0.0, 0.0, 0.0),
        axes=((0.1, 0, 0), (0, 0.1, 0), (0, 0, 0.1)),
        shape=(2, 2, 2),
        unit=Unit.E_PER_ANGSTROM3,
        data_ref="g1.f32",
    )
    store.save_dataset(grid)
    store.manifest.dataset_ids.append("ghost")
    store.save_manifest()
    assert [g.id for g in store.list_datasets()] == ["g1"]
    assert ProjectStore.open(tmp_path / "p").manifest.dataset_ids == ["g1"]
