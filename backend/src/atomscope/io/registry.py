"""Structure file IO.

Strategy: ASE handles most formats losslessly for positions/cell; RDKit handles chemistry-rich
formats (MOL/SDF, SMILES) where bond orders matter; Open Babel is the fallback for everything
else. Readers return Atomscope Structures with bonds: from the file when the format carries
them, otherwise perceived from distances.
"""

from __future__ import annotations

import io as _io
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import ase.io
from ase.io.formats import filetype

from atomscope.ase_bridge.convert import from_atoms, to_atoms
from atomscope.chem.bonds import perceive_bonds
from atomscope.io import rdkit_io
from atomscope.model import Provenance, Structure

Library = Literal["ase", "rdkit", "openbabel"]


@dataclass(frozen=True)
class FormatInfo:
    name: str
    extensions: tuple[str, ...]
    description: str
    can_read: bool
    can_write: bool
    library: Library
    has_bonds: bool = False
    has_cell: bool = False


# Curated list. Order matters: the first entry matching an extension is used.
_FORMATS: list[FormatInfo] = [
    FormatInfo("xyz", ("xyz",), "XYZ Cartesian coordinates", True, True, "ase"),
    FormatInfo(
        "extxyz", ("extxyz",), "Extended XYZ (cell, properties)", True, True, "ase", has_cell=True
    ),
    FormatInfo(
        "cif", ("cif",), "Crystallographic Information File", True, True, "ase", has_cell=True
    ),
    FormatInfo("pdb", ("pdb", "ent"), "Protein Data Bank", True, True, "ase", has_cell=True),
    FormatInfo(
        "vasp",
        ("poscar", "contcar", "vasp"),
        "VASP POSCAR/CONTCAR",
        True,
        True,
        "ase",
        has_cell=True,
    ),
    FormatInfo("mol", ("mol", "mdl"), "MDL Molfile", True, True, "rdkit", has_bonds=True),
    FormatInfo("sdf", ("sdf", "sd"), "MDL SD file", True, True, "rdkit", has_bonds=True),
    FormatInfo("mol2", ("mol2",), "Tripos MOL2", True, False, "rdkit", has_bonds=True),
    FormatInfo(
        "cube",
        ("cube", "cub"),
        "Gaussian cube (atoms only here)",
        True,
        False,
        "ase",
        has_cell=True,
    ),
    FormatInfo("xsf", ("xsf",), "XCrySDen XSF", True, True, "ase", has_cell=True),
    FormatInfo("json", ("json",), "ASE JSON", True, True, "ase", has_cell=True),
    FormatInfo("gaussian-in", ("gjf", "com"), "Gaussian input", True, True, "ase"),
    FormatInfo("gaussian-out", ("log", "g03", "g09", "g16"), "Gaussian output", True, False, "ase"),
    FormatInfo("orca-out", ("orcaout",), "ORCA output", True, False, "ase"),
    FormatInfo("turbomole", ("coord",), "Turbomole coord", True, True, "ase"),
    FormatInfo("espresso-in", ("pwi",), "Quantum ESPRESSO input", True, True, "ase", has_cell=True),
    FormatInfo(
        "espresso-out", ("pwo",), "Quantum ESPRESSO output", True, False, "ase", has_cell=True
    ),
    FormatInfo(
        "cml", ("cml",), "Chemical Markup Language", True, True, "openbabel", has_bonds=True
    ),
    FormatInfo("smi", ("smi", "smiles"), "SMILES", True, True, "rdkit", has_bonds=True),
]

# Our format names -> ASE ioformat names where they differ.
_ASE_NAME = {"pdb": "proteindatabank", "orca-out": "orca-output"}


def formats() -> list[FormatInfo]:
    return list(_FORMATS)


def _by_extension(path: Path) -> FormatInfo | None:
    ext = path.suffix.lower().lstrip(".")
    stem = path.name.upper()
    for f in _FORMATS:
        if ext in f.extensions or (f.name == "vasp" and stem in ("POSCAR", "CONTCAR")):
            return f
    return None


def _by_name(name: str) -> FormatInfo:
    for f in _FORMATS:
        if f.name == name:
            return f
    msg = f"unknown format {name!r}"
    raise ValueError(msg)


class FormatError(ValueError):
    """Raised when a file cannot be read or written."""


def detect_format(path: Path) -> FormatInfo:
    info = _by_extension(path)
    if info is not None:
        return info
    try:
        guessed = filetype(str(path), read=path.exists())
    except Exception as exc:  # ASE raises a variety of errors
        msg = f"cannot determine format of {path.name}"
        raise FormatError(msg) from exc
    for f in _FORMATS:
        if f.name == guessed or f.name == _ASE_NAME.get(guessed, ""):
            return f
    return FormatInfo(guessed, (), f"ASE format {guessed}", True, False, "ase", has_cell=True)


def read_structure(path: Path, fmt: str | None = None, *, perceive: bool = True) -> Structure:
    """Read the (last) structure from ``path``."""
    info = _by_name(fmt) if fmt else detect_format(path)
    if not info.can_read:
        msg = f"format {info.name} is write-only"
        raise FormatError(msg)
    if info.library == "rdkit":
        structure = rdkit_io.read(path, info.name)
    elif info.library == "openbabel":
        from atomscope.io import openbabel_io  # noqa: PLC0415 (optional dependency)

        structure = openbabel_io.read(path, info.name)
    else:
        try:
            atoms = ase.io.read(str(path), format=_ASE_NAME.get(info.name, info.name))
        except Exception as exc:
            msg = f"ASE could not read {path.name} as {info.name}: {exc}"
            raise FormatError(msg) from exc
        if isinstance(atoms, list):
            atoms = atoms[-1]
        structure = from_atoms(atoms, name=path.stem)
    if perceive and not structure.bonds and structure.n_atoms > 1:
        structure.bonds = perceive_bonds(structure)
    structure.provenance = Provenance(source=str(path), notes=f"read as {info.name}")
    return structure


def write_structure(structure: Structure, path: Path, fmt: str | None = None) -> None:
    info = _by_name(fmt) if fmt else detect_format(path)
    if not info.can_write:
        msg = f"format {info.name} is read-only"
        raise FormatError(msg)
    if info.library == "rdkit":
        rdkit_io.write(structure, path, info.name)
        return
    if info.library == "openbabel":
        from atomscope.io import openbabel_io  # noqa: PLC0415

        openbabel_io.write(structure, path, info.name)
        return
    atoms = to_atoms(structure)
    # ASE's plain xyz writer cannot serialize our nested info dict; drop it for that format.
    if info.name == "xyz":
        atoms.info = {}
    try:
        ase.io.write(str(path), atoms, format=_ASE_NAME.get(info.name, info.name))
    except Exception as exc:
        msg = f"ASE could not write {path.name} as {info.name}: {exc}"
        raise FormatError(msg) from exc


def sniff_text(text: str) -> str:
    """Guess the format of pasted text, which arrives without a filename.

    Only the formats a user is likely to paste are considered; anything else has to name its
    format explicitly.
    """
    stripped = text.strip()
    if not stripped:
        msg = "nothing to read"
        raise FormatError(msg)
    lines = stripped.splitlines()
    if "M  END" in text:
        return "mol"
    if lines[0].startswith("data_"):
        return "cif"
    if any(line.startswith(("ATOM  ", "HETATM")) for line in lines):
        return "pdb"
    if "<molecule" in text or "<cml" in text:
        return "cml"
    first = lines[0].split()
    if len(first) == 1 and first[0].isdigit():
        return "xyz"
    if len(lines) == 1 and len(first) == 1:
        return "smi"
    msg = "cannot tell what format this text is"
    raise FormatError(msg)


def structure_from_string(text: str, fmt: str | None = None, *, perceive: bool = True) -> Structure:
    """Read a structure from text (a paste or an editor buffer) instead of a file."""
    info = _by_name(fmt or sniff_text(text))
    if not info.can_read:
        msg = f"format {info.name} is write-only"
        raise FormatError(msg)
    if info.library == "rdkit":
        structure = rdkit_io.read_text(text, info.name)
    elif info.library == "openbabel":
        from atomscope.io import openbabel_io  # noqa: PLC0415 (optional dependency)

        structure = openbabel_io.read_text(text, info.name)
    else:
        try:
            atoms = ase.io.read(
                _io.StringIO(text), format=_ASE_NAME.get(info.name, info.name), index=-1
            )
        except Exception as exc:
            msg = f"ASE could not read the text as {info.name}: {exc}"
            raise FormatError(msg) from exc
        if isinstance(atoms, list):
            atoms = atoms[-1]
        structure = from_atoms(atoms, name="pasted")
    if perceive and not structure.bonds and structure.n_atoms > 1:
        structure.bonds = perceive_bonds(structure)
    structure.provenance = Provenance(source="text", notes=f"read as {info.name}")
    return structure


def structure_to_string(structure: Structure, fmt: str) -> str:
    """Serialize to a text format (used for previews and clipboard)."""
    info = _by_name(fmt)
    if not info.can_write:
        msg = f"format {info.name} is read-only"
        raise FormatError(msg)
    if info.library == "rdkit":
        return rdkit_io.write_text(structure, info.name)
    if info.library == "openbabel":
        from atomscope.io import openbabel_io  # noqa: PLC0415 (optional dependency)

        return openbabel_io.write_text(structure, info.name)
    atoms = to_atoms(structure)
    if info.name == "xyz":
        atoms.info = {}
    name = _ASE_NAME.get(info.name, info.name)
    buf = _io.StringIO()
    try:
        ase.io.write(buf, atoms, format=name)
    except TypeError:
        # some ASE writers (cif) only write bytes; they are still text formats
        raw = _io.BytesIO()
        ase.io.write(raw, atoms, format=name)
        return raw.getvalue().decode()
    return buf.getvalue()
