"""Builders: fragment library, peptides, nucleic acids and carbon nanostructures.

The expected formulas are derived from chemistry, not from the implementation: a peptide of n
residues is the sum of the residues minus (n-1) water molecules; an armchair (n,n) nanotube unit
cell holds 4n carbon atoms.
"""

from __future__ import annotations

import numpy as np
import pytest

from atomscope.build import carbon, fragments, nucleic, peptide
from atomscope.model import Structure


def test_fragment_library_listing() -> None:
    entries = fragments.list_fragments()
    assert len(entries) > 300
    categories = {e.category for e in entries}
    assert {"alcohols", "amino_acids", "aromatics"} <= categories
    benzene = next(e for e in entries if e.name.lower() == "benzene")
    assert benzene.formula == "C6H6" and benzene.n_atoms == 12
    assert benzene.id.startswith(f"{benzene.category}/")


def test_load_fragment_has_3d_coordinates_and_bonds() -> None:
    fragment = fragments.load_fragment("aromatics/benzene")
    assert fragment.formula() == "C6H6"
    assert len(fragment.bonds) == 12
    assert any(b.aromatic or b.order > 1 for b in fragment.bonds)
    span = fragment.positions().max(axis=0) - fragment.positions().min(axis=0)
    assert np.count_nonzero(span > 1.0) >= 2  # a real 3D/2D geometry, not all-zero


def test_unknown_fragment_raises() -> None:
    with pytest.raises(KeyError, match="unknown fragment"):
        fragments.load_fragment("nope/nothing")


def test_insert_fragment_replaces_a_hydrogen(methane: Structure) -> None:
    methyl = fragments.load_fragment("alkanes/methane")
    merged = fragments.insert_fragment(methane, methyl, attach_atom=1)
    # CH4 + CH4 joined at one H of each -> ethane C2H6
    assert merged.formula() == "C2H6"
    assert len(merged.bonds) == 7
    distances = [
        float(
            np.linalg.norm(
                np.array(merged.atoms[b.a].position) - np.array(merged.atoms[b.b].position)
            )
        )
        for b in merged.bonds
    ]
    assert max(distances) < 1.8  # nothing left dangling far away


def test_insert_fragment_at_position(methane: Structure) -> None:
    water = fragments.load_fragment("alcohols/methanol")
    merged = fragments.insert_fragment(methane, water, position=(10.0, 0.0, 0.0))
    assert merged.n_atoms == methane.n_atoms + water.n_atoms
    assert merged.positions().max(axis=0)[0] > 8.0


@pytest.mark.parametrize(
    "sequence,formula",
    [("A", "C3H7NO2"), ("AAA", "C9H17N3O4"), ("GG", "C4H8N2O3")],
)
def test_peptide_formulas(sequence: str, formula: str) -> None:
    s = peptide.build_peptide(sequence)
    assert s.formula() == formula
    assert len(s.bonds) >= s.n_atoms - 1


def test_peptide_three_letter_and_conformation() -> None:
    a = peptide.build_peptide("Ala-Gly")
    b = peptide.build_peptide("AG")
    assert a.formula() == b.formula()
    helix = peptide.build_peptide("AAAAA", phi=-57.0, psi=-47.0)
    sheet = peptide.build_peptide("AAAAA", phi=-139.0, psi=135.0)

    # the extended sheet spans a longer end-to-end distance than the alpha helix
    def span(s: Structure) -> float:
        p = s.positions()
        return float(np.linalg.norm(p.max(axis=0) - p.min(axis=0)))

    assert span(sheet) > span(helix)


def test_peptide_rejects_unknown_residue() -> None:
    with pytest.raises(ValueError, match="(?i)residue|unknown"):
        peptide.build_peptide("AXZ")


def test_nucleic_residues_and_chains() -> None:
    double = nucleic.build_nucleic("ATGC")
    assert len(double.residues) == 8
    assert sorted({r.chain for r in double.residues}) == ["A", "B"]
    assert all(r.atom_indices for r in double.residues)


def test_nucleic_strands() -> None:
    single = nucleic.build_nucleic("ATGC", double_strand=False)
    double = nucleic.build_nucleic("ATGC", double_strand=True)
    assert double.n_atoms == 2 * single.n_atoms
    assert single.n_atoms > 100 and "P" in single.symbols()
    rna = nucleic.build_nucleic("AUGC", kind="rna", double_strand=False)
    # RNA carries one extra oxygen per residue (2'-OH)
    assert rna.symbols().count("O") > single.symbols().count("O")


def test_nucleic_helix_rise() -> None:
    """Rise per base along the helix axis must match B-DNA (~3.38 A)."""
    strand = nucleic.build_nucleic("AAAAAAAAAA", double_strand=False)
    positions = strand.positions()
    phosphorus = np.array([p for p, s in zip(positions, strand.symbols(), strict=True) if s == "P"])
    assert len(phosphorus) == 10
    center = positions.mean(axis=0)
    axis = np.linalg.svd(positions - center)[2][0]  # principal axis of the strand
    projection = np.sort((phosphorus - center) @ axis)
    rise = float(np.diff(projection).mean())
    assert 3.0 < abs(rise) < 3.8, rise


def test_nucleic_rejects_bad_sequence() -> None:
    with pytest.raises(ValueError, match="(?i)base|sequence|unknown"):
        nucleic.build_nucleic("ATQX")


@pytest.mark.parametrize("n,m,length,expected", [(5, 5, 1, 20), (5, 5, 2, 40), (6, 0, 1, 24)])
def test_nanotube_atom_counts(n: int, m: int, length: int, expected: int) -> None:
    tube = carbon.build_nanotube(n, m, length=length)
    assert tube.n_atoms == expected
    assert set(tube.symbols()) == {"C"}
    assert tube.is_periodic()
    radial = np.linalg.norm(tube.positions()[:, :2] - tube.positions()[:, :2].mean(axis=0), axis=1)
    assert radial.std() < 0.1  # atoms sit on a cylinder


def test_nanotube_non_periodic_option() -> None:
    tube = carbon.build_nanotube(5, 5, length=1, periodic=False)
    assert not tube.is_periodic()
    assert tube.bonds


def test_graphene_ribbon() -> None:
    ribbon = carbon.build_graphene_ribbon(3, 4)
    assert set(ribbon.symbols()) == {"C", "H"}
    assert ribbon.symbols().count("H") > 0  # saturated edges
    bare = carbon.build_graphene_ribbon(3, 4, saturated=False)
    assert "H" not in bare.symbols()
    # a graphene ribbon is flat: one Cartesian direction has (almost) no extent
    extent = ribbon.positions().max(axis=0) - ribbon.positions().min(axis=0)
    assert float(extent.min()) < 1e-6
