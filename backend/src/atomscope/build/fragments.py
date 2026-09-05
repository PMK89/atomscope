"""Avogadro 1 fragment library (CML files under ``atomscope/data/fragments``) and insertion.

Insertion follows Avogadro's InsertFragmentCommand: with no attachment atom the fragment is
placed at a position (centroid); with one, the fragment is bonded to it. A selected hydrogen is
replaced (its heavy neighbour becomes the attachment point); a selected heavy atom loses its
hydrogens first. The fragment side attaches through the heavy atom carrying its first hydrogen.
Geometry comes from Open Babel's ``OBBuilder::Connect``.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET  # noqa: S405 - shipped, trusted data files
from functools import lru_cache
from pathlib import Path
from string import ascii_uppercase

import numpy as np
from openbabel import openbabel as ob
from pydantic import Field

from atomscope.chem.hydrogens import hydrogens_of, neighbors, remove_atoms
from atomscope.chem.obmol import OB_LOCK, from_obmol, to_obmol
from atomscope.io import openbabel_io
from atomscope.model import Atom, Bond, Provenance, Residue, Structure
from atomscope.model.common import StrictModel, Vec3

FRAGMENT_ROOT = Path(__file__).resolve().parent.parent / "data" / "fragments"
_CML = "{http://www.xml-cml.org/schema}"


class FragmentInfo(StrictModel):
    id: str = Field(description="'category/name' relative CML path without extension")
    category: str
    name: str
    formula: str
    n_atoms: int


def _hill_formula(concise: str) -> str:
    """CML ``concise`` formulas are element/count pairs ('C 2 H 7 N 1') -> Hill order."""
    tokens = concise.split()
    counts: dict[str, int] = {}
    for i in range(0, len(tokens) - 1, 2):
        symbol, number = tokens[i], tokens[i + 1]
        if not number.isdigit():
            return " ".join(tokens)
        counts[symbol] = counts.get(symbol, 0) + int(number)
    order = sorted(counts)
    if "C" in counts:
        rest = [s for s in sorted(counts) if s not in ("C", "H")]
        order = ["C", *(["H"] if "H" in counts else []), *rest]
    return "".join(f"{s}{counts[s] if counts[s] > 1 else ''}" for s in order)


def _read_meta(path: Path) -> tuple[str, str, int]:
    root = ET.parse(path).getroot()  # noqa: S314
    name_el = root.find(f"{_CML}name")
    name = (name_el.text or "").strip() if name_el is not None else ""
    formula_el = root.find(f"{_CML}formula")
    formula = (formula_el.get("concise") or "").strip() if formula_el is not None else ""
    n_atoms = len(root.findall(f"{_CML}atomArray/{_CML}atom"))
    return name or path.stem.replace("_", " "), _hill_formula(formula), n_atoms


@lru_cache(maxsize=1)
def list_fragments() -> list[FragmentInfo]:
    out: list[FragmentInfo] = []
    for path in sorted(FRAGMENT_ROOT.rglob("*.cml")):
        rel = path.relative_to(FRAGMENT_ROOT)
        category = rel.parent.as_posix() if rel.parent != Path() else "other"
        name, formula, n_atoms = _read_meta(path)
        out.append(
            FragmentInfo(
                id=rel.with_suffix("").as_posix(),
                category=category,
                name=name,
                formula=formula,
                n_atoms=n_atoms,
            )
        )
    return out


def fragment_path(fragment_id: str) -> Path:
    path = (FRAGMENT_ROOT / f"{fragment_id}.cml").resolve()
    if FRAGMENT_ROOT not in path.parents or not path.is_file():
        msg = f"unknown fragment {fragment_id!r}"
        raise KeyError(msg)
    return path


def load_fragment(fragment_id: str) -> Structure:
    path = fragment_path(fragment_id)
    s = openbabel_io.read(path, "cml")
    name, _formula, _n = _read_meta(path)
    s.name = name
    s.provenance = Provenance(source=f"fragments/{fragment_id}.cml", software="Avogadro 1 library")
    return s


def _fragment_chain(structure: Structure, fragment: Structure) -> str | None:
    """A free chain id for the fragment's residues when its own would collide, else None.

    Inserting a second peptide numbered from 1 into a document that already has residues 1..n
    would otherwise produce two residues claiming the same chain and number.
    """
    taken = {(r.chain, r.number) for r in structure.residues}
    if not any((r.chain, r.number) in taken for r in fragment.residues):
        return None
    used = {r.chain for r in structure.residues} | {r.chain for r in fragment.residues}
    return next((c for c in ascii_uppercase if c not in used), "Z")


def _append(structure: Structure, fragment: Structure, shift: np.ndarray) -> Structure:
    """Union of the two structures; fragment atoms get fresh uids and shifted positions."""
    n = structure.n_atoms
    fpos = fragment.positions() + shift
    atoms = list(structure.atoms) + [
        Atom(
            element=a.element,
            position=(float(p[0]), float(p[1]), float(p[2])),
            formal_charge=a.formal_charge,
            label=a.label,
        )
        for a, p in zip(fragment.atoms, fpos, strict=True)
    ]
    bonds = list(structure.bonds) + [
        Bond(a=b.a + n, b=b.b + n, order=b.order, aromatic=b.aromatic) for b in fragment.bonds
    ]
    chain = _fragment_chain(structure, fragment)
    return structure.model_copy(
        update={
            "atoms": atoms,
            "bonds": bonds,
            "charge": structure.charge + fragment.charge,
            "atomic_scalars": {},
            "atomic_vectors": {},
            # residues are what makes a peptide a peptide: keep both sides, re-indexed
            "residues": list(structure.residues)
            + [
                Residue(
                    name=r.name,
                    number=r.number,
                    chain=chain if chain is not None else r.chain,
                    atom_indices=[i + n for i in r.atom_indices],
                )
                for r in fragment.residues
            ],
        }
    )


def insert_fragment(
    structure: Structure,
    fragment: Structure,
    *,
    position: Vec3 | None = None,
    attach_atom: int | None = None,
) -> Structure:
    """Return ``structure`` with ``fragment`` added (see module docstring)."""
    if fragment.n_atoms == 0:
        raise ValueError("fragment has no atoms")
    if attach_atom is None:
        target = np.array(position if position is not None else (0.0, 0.0, 0.0), dtype=float)
        if position is None and structure.n_atoms:
            pos = structure.positions()
            target = pos.mean(axis=0)
            target[0] = pos[:, 0].max() + 3.0  # beside the existing molecule, not inside it
        centroid = fragment.positions().mean(axis=0)
        return _append(structure, fragment, target - centroid)

    if attach_atom < 0 or attach_atom >= structure.n_atoms:
        msg = f"attach_atom {attach_atom} outside 0..{structure.n_atoms - 1}"
        raise ValueError(msg)
    nb = neighbors(structure)
    if structure.atoms[attach_atom].element == "H":
        if not nb[attach_atom]:
            raise ValueError("selected hydrogen has no neighbour to attach to")
        start = nb[attach_atom][0]
        base = remove_atoms(structure, {attach_atom})
        start = start - (1 if attach_atom < start else 0)
    else:
        start = attach_atom
        removed = hydrogens_of(structure, {attach_atom})
        base = remove_atoms(structure, removed)
        start -= sum(1 for i in removed if i < attach_atom)

    fnb = neighbors(fragment)
    frag_h = next((i for i, a in enumerate(fragment.atoms) if a.element == "H" and fnb[i]), None)
    if frag_h is None:
        end_in_frag = 0
        frag = fragment
    else:
        end_in_frag = fnb[frag_h][0] - (1 if frag_h < fnb[frag_h][0] else 0)
        frag = remove_atoms(fragment, {frag_h})
    merged = _append(base, frag, np.zeros(3))
    end = base.n_atoms + end_in_frag
    with OB_LOCK:
        mol = to_obmol(merged)
        if not ob.OBBuilder.Connect(mol, start + 1, end + 1):
            raise ValueError("Open Babel could not connect the fragment")
        out = from_obmol(mol, merged)
    out.name = structure.name
    return out
