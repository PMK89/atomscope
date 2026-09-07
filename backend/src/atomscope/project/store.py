"""Filesystem-backed project store. The only module that writes project files."""

from __future__ import annotations

import os
import re
import shutil
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from pydantic import ValidationError

from atomscope.model import Structure, VolumetricGrid
from atomscope.project.manifest import FORMAT_VERSION, ProjectManifest, dump_json

_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class ProjectError(Exception):
    """Raised for invalid project directories or ids."""


def _check_id(value: str) -> str:
    if not _ID_RE.match(value):
        msg = f"invalid id {value!r}"
        raise ProjectError(msg)
    return value


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=path.suffix)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


class ProjectStore:
    """Open, create and mutate a project directory."""

    def __init__(self, root: Path, manifest: ProjectManifest) -> None:
        self.root = root.resolve()
        self.manifest = manifest

    # ---- lifecycle ------------------------------------------------------------------------
    @classmethod
    def create(cls, root: Path, name: str) -> ProjectStore:
        root = root.resolve()
        if root.exists() and any(root.iterdir()):
            msg = f"{root} exists and is not empty"
            raise ProjectError(msg)
        root.mkdir(parents=True, exist_ok=True)
        for sub in ("structures", "calculations", "datasets", "presets"):
            (root / sub).mkdir(exist_ok=True)
        store = cls(root, ProjectManifest(name=name))
        store.save_manifest()
        return store

    @classmethod
    def open(cls, root: Path) -> ProjectStore:
        root = root.resolve()
        manifest_path = root / "project.json"
        if not manifest_path.is_file():
            msg = f"{root} is not an Atomscope project (missing project.json)"
            raise ProjectError(msg)
        manifest = ProjectManifest.model_validate_json(manifest_path.read_text(encoding="utf-8"))
        if manifest.format_version > FORMAT_VERSION:
            msg = (
                f"project format {manifest.format_version} is newer than supported {FORMAT_VERSION}"
            )
            raise ProjectError(msg)
        return cls(root, manifest)

    def save_manifest(self) -> None:
        self.manifest.modified_at = datetime.now(tz=UTC)
        _atomic_write(self.root / "project.json", dump_json(self.manifest))

    # ---- path safety ----------------------------------------------------------------------
    def path_in_project(self, *parts: str) -> Path:
        """Resolve a relative path and guarantee it stays inside the project."""
        p = (self.root.joinpath(*parts)).resolve()
        if not p.is_relative_to(self.root):
            msg = f"path {p} escapes project root"
            raise ProjectError(msg)
        return p

    # ---- structures -----------------------------------------------------------------------
    def structure_path(self, structure_id: str) -> Path:
        return self.path_in_project("structures", f"{_check_id(structure_id)}.json")

    def save_structure(self, structure: Structure) -> None:
        _atomic_write(self.structure_path(structure.id), dump_json(structure))
        if structure.id not in self.manifest.structure_ids:
            self.manifest.structure_ids.append(structure.id)
        self.save_manifest()

    def load_structure(self, structure_id: str) -> Structure:
        path = self.structure_path(structure_id)
        if not path.is_file():
            msg = f"structure {structure_id} not found"
            raise ProjectError(msg)
        return Structure.model_validate_json(path.read_text(encoding="utf-8"))

    def delete_structure(self, structure_id: str) -> None:
        path = self.structure_path(structure_id)
        path.unlink(missing_ok=True)
        if structure_id in self.manifest.structure_ids:
            self.manifest.structure_ids.remove(structure_id)
        self.save_manifest()

    def list_structures(self) -> list[Structure]:
        """All structures of the project.

        A manifest entry whose file has disappeared (deleted outside the application, an
        interrupted write) is dropped from the manifest instead of failing the whole listing, so
        one damaged file cannot make a project unopenable.
        """
        out: list[Structure] = []
        missing: list[str] = []
        for structure_id in list(self.manifest.structure_ids):
            try:
                out.append(self.load_structure(structure_id))
            except (ProjectError, ValidationError):
                missing.append(structure_id)
        if missing:
            self.manifest.structure_ids = [
                i for i in self.manifest.structure_ids if i not in missing
            ]
            self.save_manifest()
        return out

    # ---- datasets (standalone imported grids: datasets/<id>.json + binary sidecar) ----------
    def dataset_path(self, dataset_id: str) -> Path:
        return self.path_in_project("datasets", f"{_check_id(dataset_id)}.json")

    def save_dataset(self, grid: VolumetricGrid) -> None:
        _atomic_write(self.dataset_path(grid.id), dump_json(grid))
        if grid.id not in self.manifest.dataset_ids:
            self.manifest.dataset_ids.append(grid.id)
        self.save_manifest()

    def load_dataset(self, dataset_id: str) -> VolumetricGrid:
        path = self.dataset_path(dataset_id)
        if not path.is_file():
            msg = f"dataset {dataset_id} not found"
            raise ProjectError(msg)
        return VolumetricGrid.model_validate_json(path.read_text(encoding="utf-8"))

    def list_datasets(self) -> list[VolumetricGrid]:
        """All standalone datasets; entries with a missing/corrupt file are pruned (see
        :meth:`list_structures`)."""
        out: list[VolumetricGrid] = []
        missing: list[str] = []
        for dataset_id in list(self.manifest.dataset_ids):
            try:
                out.append(self.load_dataset(dataset_id))
            except (ProjectError, ValidationError):
                missing.append(dataset_id)
        if missing:
            self.manifest.dataset_ids = [i for i in self.manifest.dataset_ids if i not in missing]
            self.save_manifest()
        return out

    # ---- calculations (directories are created here; contents are owned by services) -------
    def calculation_dir(self, calculation_id: str) -> Path:
        return self.path_in_project("calculations", _check_id(calculation_id))

    def forget_calculation(self, calculation_id: str) -> None:
        """Undo :meth:`register_calculation`: drop the directory and the manifest entry.

        For a calculation that failed while being set up. Not for deleting finished work -- that
        wants an explicit user action and a different name.
        """
        if calculation_id in self.manifest.calculation_ids:
            self.manifest.calculation_ids.remove(calculation_id)
            self.save_manifest()
        d = self.calculation_dir(calculation_id)
        if d.is_dir():
            shutil.rmtree(d)

    def register_calculation(self, calculation_id: str) -> Path:
        d = self.calculation_dir(calculation_id)
        for sub in ("input", "work", "results"):
            (d / sub).mkdir(parents=True, exist_ok=True)
        if calculation_id not in self.manifest.calculation_ids:
            self.manifest.calculation_ids.append(calculation_id)
        self.save_manifest()
        return d
