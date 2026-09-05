"""Cases for structure file IO, bond perception, the ASE bridge and the pydantic model."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from benchmarks import fixtures
from benchmarks._timing import register

REPEATS: dict[str, int] = {"1e3": 5, "1e4": 3, "1e5": 1}
#: 1e5 runs only in --full
QUICK: dict[str, bool] = {"1e3": True, "1e4": True, "1e5": False}


def _out_dir() -> Path:
    d = fixtures.root() / "out"
    d.mkdir(parents=True, exist_ok=True)
    return d


# ---- file IO ------------------------------------------------------------------------------


def _ase_read(fmt: str, size: str) -> tuple[Callable[[], Any], int, str]:
    import ase.io  # noqa: PLC0415

    path = fixtures.structure_file(fmt, size)
    ase_fmt = {"pdb": "proteindatabank"}.get(fmt, fmt)
    n = len(
        fixtures.bulk_atoms(size)
        if fixtures.IO_FORMATS[fmt][1] == "bulk"
        else fixtures.protein_atoms(size)
    )
    mb = path.stat().st_size / 1e6
    return (
        lambda: ase.io.read(str(path), format=ase_fmt),
        n,
        f"ase.io.read only, {mb:.1f} MB file",
    )


def _read_structure(fmt: str, size: str, *, perceive: bool) -> tuple[Callable[[], Any], int, str]:
    from atomscope.io.registry import read_structure  # noqa: PLC0415

    path = fixtures.structure_file(fmt, size)
    n = read_structure(path, perceive=False).n_atoms
    note = "read_structure with bond perception" if perceive else "read_structure, no perception"
    return (lambda: read_structure(path, perceive=perceive), n, note)


def _write_structure(fmt: str, size: str) -> tuple[Callable[[], Any], int, str]:
    from atomscope.io.registry import write_structure  # noqa: PLC0415

    family = fixtures.IO_FORMATS[fmt][1]
    s = fixtures.structure(family, size)
    ext = fixtures.IO_FORMATS[fmt][0]
    out = _out_dir() / f"write-{family}-{size}.{ext}"
    return (lambda: write_structure(s, out, fmt), s.n_atoms, f"write_structure -> .{ext}")


# ---- bond perception ----------------------------------------------------------------------


def _perceive(family: str, size: str) -> tuple[Callable[[], Any], int, str]:
    from atomscope.chem.bonds import perceive_bonds  # noqa: PLC0415

    s = fixtures.structure(family, size)
    n_bonds = len(perceive_bonds(s))
    kind = "periodic FCC Cu" if family == "bulk" else "molecular crambin copies"
    return (lambda: perceive_bonds(s), s.n_atoms, f"{kind}, {n_bonds} bonds")


# ---- ASE bridge ---------------------------------------------------------------------------


def _to_atoms(size: str) -> tuple[Callable[[], Any], int, str]:
    from atomscope.ase_bridge.convert import to_atoms  # noqa: PLC0415

    s = fixtures.structure("bulk", size)
    return (lambda: to_atoms(s), s.n_atoms, "Structure -> ase.Atoms")


def _from_atoms(size: str) -> tuple[Callable[[], Any], int, str]:
    from atomscope.ase_bridge.convert import from_atoms  # noqa: PLC0415

    atoms = fixtures.bulk_atoms(size)
    return (lambda: from_atoms(atoms), len(atoms), "ase.Atoms -> Structure")


def _roundtrip(size: str) -> tuple[Callable[[], Any], int, str]:
    from atomscope.ase_bridge.convert import from_atoms, to_atoms  # noqa: PLC0415

    s = fixtures.structure("bulk", size)
    return (lambda: from_atoms(to_atoms(s)), s.n_atoms, "Structure -> Atoms -> Structure")


# ---- model construction / serialization ----------------------------------------------------


def _model_validate(size: str) -> tuple[Callable[[], Any], int, str]:
    from atomscope.model import Structure  # noqa: PLC0415

    payload = fixtures.structure("bulk", size).model_dump(mode="json")
    return (lambda: Structure.model_validate(payload), len(payload["atoms"]), "from a plain dict")


def _model_dump(size: str) -> tuple[Callable[[], Any], int, str]:
    s = fixtures.structure("bulk", size)
    return (lambda: s.model_dump(mode="json"), s.n_atoms, "model_dump(mode='json')")


def _model_dump_json(size: str) -> tuple[Callable[[], Any], int, str]:
    s = fixtures.structure("bulk", size)
    mb = len(s.model_dump_json()) / 1e6
    return (s.model_dump_json, s.n_atoms, f"pydantic JSON, {mb:.1f} MB")


def _store_dump_json(size: str) -> tuple[Callable[[], Any], int, str]:
    from atomscope.project.manifest import dump_json  # noqa: PLC0415

    s = fixtures.structure("bulk", size)
    mb = len(dump_json(s)) / 1e6
    return (lambda: dump_json(s), s.n_atoms, f"sorted+indented project JSON, {mb:.1f} MB")


def _validate_json(size: str) -> tuple[Callable[[], Any], int, str]:
    from atomscope.model import Structure  # noqa: PLC0415

    text = fixtures.structure("bulk", size).model_dump_json()
    return (
        lambda: Structure.model_validate_json(text),
        text.count('"element"'),
        f"parse {len(text) / 1e6:.1f} MB of JSON",
    )


def _save_load(size: str) -> tuple[Callable[[], Any], int, str]:
    from atomscope.project.store import ProjectStore  # noqa: PLC0415

    root = _out_dir() / f"project-{size}"
    if root.exists():
        import shutil  # noqa: PLC0415

        shutil.rmtree(root)
    store = ProjectStore.create(root, "bench")
    s = fixtures.structure("bulk", size)
    return (lambda: store.save_structure(s), s.n_atoms, "ProjectStore.save_structure (disk)")


def _load_structure(size: str) -> tuple[Callable[[], Any], int, str]:
    from atomscope.project.store import ProjectStore  # noqa: PLC0415

    root = _out_dir() / f"project-load-{size}"
    if not (root / "project.json").is_file():
        store = ProjectStore.create(root, "bench")
    else:
        store = ProjectStore.open(root)
    s = fixtures.structure("bulk", size)
    store.save_structure(s)
    return (lambda: store.load_structure(s.id), s.n_atoms, "ProjectStore.load_structure (disk)")


def _validate_bonded(size: str) -> tuple[Callable[[], Any], int, str]:
    from atomscope.model import Structure  # noqa: PLC0415

    s = fixtures.bonded_structure(size)
    payload = s.model_dump(mode="json")
    return (
        lambda: Structure.model_validate(payload),
        s.n_atoms,
        f"structure with {len(s.bonds):,} bonds (Structure._consistent runs over all of them)",
    )


def _assign_bonds(size: str) -> tuple[Callable[[], Any], int, str]:
    s = fixtures.bonded_structure(size)
    bonds = list(s.bonds)

    def assign() -> None:
        s.bonds = bonds

    return (assign, s.n_atoms, f"validate_assignment re-check of {len(bonds):,} bonds")


def _to_atoms_bonded(size: str) -> tuple[Callable[[], Any], int, str]:
    from atomscope.ase_bridge.convert import to_atoms  # noqa: PLC0415

    s = fixtures.bonded_structure(size)
    return (lambda: to_atoms(s), s.n_atoms, f"Structure -> ase.Atoms with {len(s.bonds):,} bonds")


def _import_baseline() -> tuple[Callable[[], Any], int, str]:
    """Baseline: the RSS and time cost of importing the backend at all."""
    import atomscope.api.app  # noqa: PLC0415, F401
    import atomscope.io.registry  # noqa: PLC0415, F401

    return (lambda: None, 0, "imports only; subtract this RSS from every other case")


def register_all() -> None:
    """Register every structure-side case."""
    register("baseline.imports", "baseline", _import_baseline, items_label="-", repeats=1)
    for size in fixtures.SIZES:
        rep, quick = REPEATS[size], QUICK[size]
        for fmt in fixtures.IO_FORMATS:
            # ASE expands CIF symmetry with an O(N^2) duplicate check; cut those off early.
            read_timeout = 60.0 if fmt == "cif" and size != "1e3" else 180.0
            register(
                f"io.ase_read.{fmt}.{size}",
                "structure IO",
                lambda f=fmt, s=size: _ase_read(f, s),
                repeats=rep,
                quick=quick,
                timeout_s=read_timeout,
            )
            register(
                f"io.read.{fmt}.{size}",
                "structure IO",
                lambda f=fmt, s=size: _read_structure(f, s, perceive=False),
                repeats=rep,
                quick=quick,
                timeout_s=read_timeout,
            )
            register(
                f"io.write.{fmt}.{size}",
                "structure IO",
                lambda f=fmt, s=size: _write_structure(f, s),
                repeats=rep,
                quick=quick,
            )
        register(
            f"io.read_perceive.xyz.{size}",
            "structure IO",
            lambda s=size: _read_structure("xyz", s, perceive=True),
            repeats=rep,
            quick=quick,
        )
        for family in ("bulk", "protein"):
            label = "periodic" if family == "bulk" else "molecular"
            register(
                f"bonds.{label}.{size}",
                "bond perception",
                lambda f=family, s=size: _perceive(f, s),
                repeats=rep,
                quick=quick,
            )
        register(
            f"bridge.to_atoms.{size}",
            "ASE bridge",
            lambda s=size: _to_atoms(s),
            repeats=rep,
            quick=quick,
        )
        register(
            f"bridge.from_atoms.{size}",
            "ASE bridge",
            lambda s=size: _from_atoms(s),
            repeats=rep,
            quick=quick,
        )
        register(
            f"bridge.roundtrip.{size}",
            "ASE bridge",
            lambda s=size: _roundtrip(s),
            repeats=rep,
            quick=quick,
        )
        for name, fn in (
            ("model.validate_bonded", _validate_bonded),
            ("model.assign_bonds", _assign_bonds),
            ("bridge.to_atoms_bonded", _to_atoms_bonded),
            ("model.validate_dict", _model_validate),
            ("model.model_dump", _model_dump),
            ("model.dump_json", _model_dump_json),
            ("model.store_dump_json", _store_dump_json),
            ("model.validate_json", _validate_json),
            ("project.save_structure", _save_load),
            ("project.load_structure", _load_structure),
        ):
            register(
                f"{name}.{size}",
                "model + project store",
                lambda f=fn, s=size: f(s),
                repeats=rep,
                quick=quick,
            )
