"""Peptide builder: RDKit ``MolFromSequence`` + ETKDG embedding, then backbone dihedrals set to
the requested phi/psi (Avogadro 1's presets: straight chain, alpha helix, beta sheet, 3-10 and
pi helix). Avogadro's Z-matrix amino templates (builder/amino/*.zmat) are not used: RDKit knows
the residue topology (PDB atom names) so the dihedrals can be set exactly, and no template data
needs to be shipped.

Limits: L-amino acids only, neutral termini (NH2 / COOH), no side-chain rotamer optimization.
Proline's phi cannot be set (N-CA is a ring bond) and is left as embedded.
"""

from __future__ import annotations

import re

from rdkit import Chem
from rdkit.Chem import AllChem, rdMolTransforms

from atomscope.io.rdkit_io import mol_to_structure
from atomscope.model import Provenance, Residue, Structure

# phi, psi in degrees (libavogadro/src/extensions/insertpeptideextension.cpp)
PRESETS: dict[str, tuple[float, float]] = {
    "straight": (180.0, 180.0),
    "alpha_helix": (-60.0, -40.0),
    "beta_sheet": (-135.0, 135.0),
    "helix_3_10": (-74.0, -4.0),
    "pi_helix": (-57.0, -70.0),
}

THREE_TO_ONE = {
    "ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C", "GLN": "Q", "GLU": "E",
    "GLY": "G", "HIS": "H", "ILE": "I", "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F",
    "PRO": "P", "SER": "S", "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V",
}  # fmt: skip
ONE_LETTER = set(THREE_TO_ONE.values())


def parse_sequence(text: str) -> str:
    """Accept one-letter ("AGV"), three-letter ("Ala-Gly-Val", "ALA GLY VAL") or mixed input."""
    tokens = [t for t in re.split(r"[\s,;\-]+", text.strip()) if t]
    if not tokens:
        raise ValueError("empty sequence")
    out = []
    for tok in tokens:
        up = tok.upper()
        if len(up) == 3 and up in THREE_TO_ONE:
            out.append(THREE_TO_ONE[up])
            continue
        if len(up) % 3 == 0 and all(up[i : i + 3] in THREE_TO_ONE for i in range(0, len(up), 3)):
            out.extend(THREE_TO_ONE[up[i : i + 3]] for i in range(0, len(up), 3))
            continue
        bad = [c for c in up if c not in ONE_LETTER]
        if bad:
            msg = f"unknown amino acid code(s) {bad} in {tok!r}"
            raise ValueError(msg)
        out.extend(up)
    return "".join(out)


def _backbone(mol: Chem.Mol) -> dict[int, dict[str, int]]:
    """residue number -> {'N': idx, 'CA': idx, 'C': idx}."""
    table: dict[int, dict[str, int]] = {}
    for a in mol.GetAtoms():
        info = a.GetPDBResidueInfo()
        if info is None:
            continue
        name = info.GetName().strip()
        if name in ("N", "CA", "C"):
            table.setdefault(info.GetResidueNumber(), {})[name] = a.GetIdx()
    return table


def _set(conf: Chem.Conformer, atoms: tuple[int, int, int, int], value: float) -> None:
    """Set one backbone dihedral; ring bonds (proline) keep their embedded geometry."""
    try:
        rdMolTransforms.SetDihedralDeg(conf, *atoms, value)
    except ValueError:  # bond j-k in a ring (proline): leave as embedded
        pass


def build_peptide(
    sequence: str, *, phi: float = 180.0, psi: float = 180.0, omega: float = 180.0, seed: int = 42
) -> Structure:
    seq = parse_sequence(sequence)
    mol = Chem.MolFromSequence(seq)
    if mol is None:
        msg = f"RDKit could not build sequence {seq!r}"
        raise ValueError(msg)
    mol = Chem.AddHs(mol, addResidueInfo=True)
    params = AllChem.ETKDGv3()  # type: ignore[attr-defined]
    params.randomSeed = seed
    if AllChem.EmbedMolecule(mol, params) != 0:  # type: ignore[attr-defined]
        params.useRandomCoords = True
        if AllChem.EmbedMolecule(mol, params) != 0:  # type: ignore[attr-defined]
            msg = f"could not embed peptide {seq!r} in 3D"
            raise ValueError(msg)
    conf = mol.GetConformer()
    bb = _backbone(mol)
    numbers = sorted(bb)
    for idx, r in enumerate(numbers):
        cur = bb[r]
        if idx > 0:
            prev = bb[numbers[idx - 1]]
            _set(conf, (prev["C"], cur["N"], cur["CA"], cur["C"]), phi)
        if idx + 1 < len(numbers):
            nxt = bb[numbers[idx + 1]]
            _set(conf, (cur["N"], cur["CA"], cur["C"], nxt["N"]), psi)
            _set(conf, (cur["CA"], cur["C"], nxt["N"], nxt["CA"]), omega)
    structure = mol_to_structure(mol, name=f"peptide {seq}")
    residues: dict[tuple[int, str], Residue] = {}
    for a in mol.GetAtoms():
        info = a.GetPDBResidueInfo()
        if info is None:
            continue
        key = (info.GetResidueNumber(), info.GetChainId())
        res = residues.setdefault(
            key,
            Residue(
                name=info.GetResidueName(),
                number=info.GetResidueNumber(),
                chain=info.GetChainId(),
                atom_indices=[],
            ),
        )
        res.atom_indices.append(a.GetIdx())
    structure.residues = list(residues.values())
    structure.provenance = Provenance(
        source="build.peptide",
        software="RDKit",
        notes=f"sequence {seq}, phi {phi}, psi {psi}, omega {omega}",
    )
    return structure
