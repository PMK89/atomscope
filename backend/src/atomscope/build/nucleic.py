"""DNA/RNA builder using Open Babel's FASTA reader, exactly as Avogadro 1's Insert DNA does:
the reader generates 3D coordinates for a (double-stranded) helix from the sequence, with the
number of base pairs per turn as the only helical parameter (A 11.0, B 10.5, Z 12.0 in Avogadro;
RNA is single-stranded A-form with 11.0).

Limits: helix forms differ only by twist (rise and groove geometry are Open Babel's idealized
B-like template); no custom base-pair step parameters.
"""

from __future__ import annotations

from typing import Literal

from openbabel import openbabel as ob

from atomscope.chem.obmol import OB_LOCK, from_obmol
from atomscope.model import Provenance, Residue, Structure

NucleicKind = Literal["dna", "rna"]
HelixForm = Literal["A", "B", "Z"]
BASES_PER_TURN: dict[str, float] = {"A": 11.0, "B": 10.5, "Z": 12.0}
_ALPHABET = {"dna": set("ACGT"), "rna": set("ACGU")}


def parse_sequence(text: str, kind: NucleicKind) -> str:
    seq = "".join(text.split()).upper()
    if not seq:
        raise ValueError("empty sequence")
    bad = sorted(set(seq) - _ALPHABET[kind])
    if bad:
        msg = f"invalid {kind.upper()} bases {bad}; allowed {sorted(_ALPHABET[kind])}"
        raise ValueError(msg)
    return seq


def build_nucleic(
    sequence: str,
    *,
    kind: NucleicKind = "dna",
    double_strand: bool = True,
    form: HelixForm = "B",
    bases_per_turn: float | None = None,
) -> Structure:
    seq = parse_sequence(sequence, kind)
    turns = bases_per_turn if bases_per_turn is not None else BASES_PER_TURN[form]
    if turns <= 0:
        raise ValueError("bases_per_turn must be positive")
    single = not double_strand or kind == "rna"
    with OB_LOCK:
        conv = ob.OBConversion()
        if not conv.SetInFormat("fasta"):
            raise ValueError("Open Babel has no FASTA reader")
        if single:
            conv.AddOption("1", ob.OBConversion.INOPTIONS)
        conv.AddOption("t", ob.OBConversion.INOPTIONS, f"{turns:g}")
        mol = ob.OBMol()
        if not conv.ReadString(mol, f">{kind.upper()}\n{seq.lower()}\n"):
            raise ValueError("Open Babel could not build the nucleic acid")
        empty = Structure(name=f"{kind.upper()} {seq}")
        structure = from_obmol(mol, empty)
        residues = [
            Residue(
                name=r.GetName().strip(),
                number=r.GetNum(),
                chain=r.GetChain(),
                atom_indices=sorted(a.GetIdx() - 1 for a in ob.OBResidueAtomIter(r)),
            )
            for r in ob.OBResidueIter(mol)
        ]
    structure.residues = residues
    structure.provenance = Provenance(
        source="build.nucleic",
        software="Open Babel fasta",
        notes=f"{kind} {seq} {'single' if single else 'double'} strand, {turns:g} bases/turn",
    )
    return structure
