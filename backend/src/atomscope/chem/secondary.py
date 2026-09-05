"""Protein secondary structure: backbone perception, DSSP hydrogen bonds, helix/sheet assignment.

The method is Kabsch and Sander's (DSSP, Biopolymers 22:2577, 1983): an electrostatic energy for
every backbone N-H...O=C pair, then the turn and bridge patterns that follow from it. Only the
part Atomscope needs is implemented -- helix, sheet, turn -- and the bend/chirality codes are not.

The backbone is found from connectivity rather than from PDB atom names, so a peptide built here
(which has no atom names) is treated exactly like an imported PDB file.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal

import numpy as np

from atomscope.model import Structure

SecondaryKind = Literal["helix", "sheet", "turn", "coil"]

# Kabsch-Sander: E = q1 q2 (1/r_ON + 1/r_CH - 1/r_OH - 1/r_CN) * f, in kcal/mol with r in Angstrom
DSSP_FACTOR = 0.084 * 332.0
HBOND_ENERGY = -0.5
#: N-H bond length used to place the amide hydrogen, which most structures do not carry.
NH_LENGTH = 1.0
#: Pairs further apart than this cannot form a backbone hydrogen bond; keeps the loop cheap.
MAX_CA_DISTANCE = 9.0
#: Residues closer than this along the chain are not considered partners.
MIN_SEPARATION = 2

_KIND_OF_CODE: dict[str, SecondaryKind] = {
    "H": "helix",
    "G": "helix",
    "I": "helix",
    "E": "sheet",
    "B": "sheet",
    "T": "turn",
    "-": "coil",
}
#: Which code wins when a residue satisfies several patterns (DSSP's own order).
_PRIORITY = ["H", "B", "E", "G", "I", "T"]


@dataclass
class BackboneResidue:
    """The four backbone atoms of one residue, as indices into the structure."""

    residue: int
    n: int
    ca: int
    c: int
    o: int
    #: position in its chain, and the chain it belongs to (both filled in by ``chains``)
    chain: int = -1
    order: int = -1


@dataclass
class Assignment:
    """What was found for one residue."""

    residue: int
    code: str
    kind: SecondaryKind
    backbone: BackboneResidue


@dataclass
class SecondaryStructure:
    residues: list[Assignment] = field(default_factory=list)
    #: chains as lists of residue indices, in backbone order
    chains: list[list[int]] = field(default_factory=list)
    #: (donor residue, acceptor residue, energy) for every backbone hydrogen bond found
    hbonds: list[tuple[int, int, float]] = field(default_factory=list)


def _adjacency(structure: Structure) -> list[list[int]]:
    out: list[list[int]] = [[] for _ in structure.atoms]
    for b in structure.bonds:
        out[b.a].append(b.b)
        out[b.b].append(b.a)
    return out


def backbone(structure: Structure) -> list[BackboneResidue]:
    """Find N-CA-C=O in each residue.

    The carbonyl carbon is a carbon with an oxygen neighbour whose own alpha carbon carries a
    nitrogen: that rules out the side-chain amides of asparagine and glutamine, whose carbon has
    the same C(=O) pattern but no nitrogen two bonds away on the carbon side.
    """
    adj = _adjacency(structure)
    residue_of = [-1] * len(structure.atoms)
    for r, res in enumerate(structure.residues):
        for i in res.atom_indices:
            residue_of[i] = r
    elements = [a.element for a in structure.atoms]

    out: list[BackboneResidue] = []
    for r, res in enumerate(structure.residues):
        members = set(res.atom_indices)
        fallback: BackboneResidue | None = None
        found: BackboneResidue | None = None
        for c in res.atom_indices:
            if elements[c] != "C":
                continue
            oxygens = [x for x in adj[c] if elements[x] == "O"]
            if not oxygens:
                continue
            for ca in adj[c]:
                if elements[ca] != "C" or ca not in members:
                    continue
                nitrogens = [x for x in adj[ca] if elements[x] == "N" and x in members]
                if not nitrogens:
                    continue
                cand = BackboneResidue(residue=r, n=nitrogens[0], ca=ca, c=c, o=oxygens[0])
                # in the middle of a chain the carbonyl is bonded to the next residue's N, which
                # settles it; at the C terminus there is no such bond and the candidate stands
                if any(elements[x] == "N" and residue_of[x] != r for x in adj[c]):
                    found = cand
                    break
                fallback = fallback or cand
            if found is not None:
                break
        if found or fallback:
            out.append(found or fallback)  # type: ignore[arg-type]
    return out


def chains(structure: Structure, residues: list[BackboneResidue]) -> list[list[int]]:
    """Group residues into chains by peptide bonds and order each chain from N to C terminus.

    Residue numbers are not used: PDB numbering has gaps and insertion codes, and a chain break
    shows up as a missing peptide bond, not as a jump in the numbers.
    """
    adj = _adjacency(structure)
    by_atom = {r.n: i for i, r in enumerate(residues)}
    nxt: dict[int, int] = {}
    prev: dict[int, int] = {}
    for i, r in enumerate(residues):
        for x in adj[r.c]:
            j = by_atom.get(x)
            if j is not None and j != i:
                nxt[i] = j
                prev[j] = i
    out: list[list[int]] = []
    seen: set[int] = set()
    for i in range(len(residues)):
        if i in prev or i in seen:
            continue
        chain: list[int] = []
        cur: int | None = i
        while cur is not None and cur not in seen:
            seen.add(cur)
            chain.append(cur)
            cur = nxt.get(cur)
        out.append(chain)
    # a cyclic peptide has no start; whatever is left forms its own chain
    for i in range(len(residues)):
        if i not in seen:
            chain = []
            cur = i
            while cur is not None and cur not in seen:
                seen.add(cur)
                chain.append(cur)
                cur = nxt.get(cur)
            out.append(chain)
    return out


def _amide_hydrogens(
    structure: Structure, residues: list[BackboneResidue], order: list[list[int]]
) -> dict[int, np.ndarray]:
    """Amide H positions, placed as DSSP does: on the N, opposite the previous C=O.

    Proline has no amide hydrogen and neither does the first residue of a chain, so neither can
    donate.
    """
    pos = structure.positions()
    names = [r.name.upper() for r in structure.residues]
    out: dict[int, np.ndarray] = {}
    for chain in order:
        for k, i in enumerate(chain):
            if k == 0:
                continue
            res = residues[i]
            if names[res.residue] == "PRO":
                continue
            before = residues[chain[k - 1]]
            direction = pos[before.c] - pos[before.o]
            norm = float(np.linalg.norm(direction))
            if norm < 1e-6:
                continue
            out[i] = pos[res.n] + NH_LENGTH * direction / norm
    return out


def hydrogen_bonds(
    structure: Structure, residues: list[BackboneResidue], order: list[list[int]]
) -> dict[tuple[int, int], float]:
    """Backbone hydrogen bonds as ``{(donor, acceptor): energy}``, keyed by position in
    ``residues`` rather than by residue index."""
    if not residues:
        return {}
    pos = structure.positions()
    hydrogens = _amide_hydrogens(structure, residues, order)
    ca = np.array([pos[r.ca] for r in residues])
    index_in_chain = {i: (c, k) for c, chain in enumerate(order) for k, i in enumerate(chain)}

    out: dict[tuple[int, int], float] = {}
    for donor, h in hydrogens.items():
        n = pos[residues[donor].n]
        # the prefilter is what keeps this from being a full pair loop on a real protein
        near = np.nonzero(np.linalg.norm(ca - ca[donor], axis=1) < MAX_CA_DISTANCE)[0]
        for acceptor in near.tolist():
            if acceptor == donor:
                continue
            same_chain = (
                index_in_chain.get(donor, (0, 0))[0] == index_in_chain.get(acceptor, (1, 0))[0]
            )
            if same_chain:
                sep = abs(index_in_chain[donor][1] - index_in_chain[acceptor][1])
                if sep < MIN_SEPARATION:
                    continue
            c = pos[residues[acceptor].c]
            o = pos[residues[acceptor].o]
            energy = DSSP_FACTOR * (
                1.0 / float(np.linalg.norm(o - n))
                + 1.0 / float(np.linalg.norm(c - h))
                - 1.0 / float(np.linalg.norm(o - h))
                - 1.0 / float(np.linalg.norm(c - n))
            )
            if energy < HBOND_ENERGY:
                out[(donor, acceptor)] = energy
    return out


def _positions(order: list[list[int]]) -> dict[int, tuple[int, int]]:
    """Residue -> (chain, position in chain), so a step along the backbone is one lookup."""
    return {i: (c, k) for c, chain in enumerate(order) for k, i in enumerate(chain)}


def _turns(
    order: list[list[int]], bonded: Callable[[int | None, int | None], bool], count: int
) -> dict[int, list[bool]]:
    """n-turn(i): the C=O of residue i is hydrogen bonded to the N-H of residue i+n."""
    out: dict[int, list[bool]] = {}
    for n in (3, 4, 5):
        flags = [False] * count
        for chain in order:
            for k in range(len(chain) - n):
                if bonded(chain[k], chain[k + n]):
                    flags[chain[k]] = True
        out[n] = flags
    return out


def _helices(order: list[list[int]], turns: dict[int, list[bool]], codes: list[set[str]]) -> None:
    """Two consecutive n-turns make a helix; a single one only marks a turn."""
    position = _positions(order)
    for n, code in ((4, "H"), (3, "G"), (5, "I")):
        flags = turns[n]
        for chain in order:
            for k in range(len(chain) - n - 1):
                if flags[chain[k]] and flags[chain[k + 1]]:
                    for m in range(1, n + 1):
                        codes[chain[k + m]].add(code)
        for i, on in enumerate(flags):
            if not on:
                continue
            c, k = position[i]
            for m in range(1, n + 1):
                if k + m < len(order[c]):
                    codes[order[c][k + m]].add("T")


def _bridges(
    order: list[list[int]],
    bonded: Callable[[int | None, int | None], bool],
    codes: list[set[str]],
    count: int,
) -> None:
    """Parallel and antiparallel bridges, the two hydrogen-bond patterns that make a sheet."""
    position = _positions(order)

    def neighbour(i: int, delta: int) -> int | None:
        c, k = position[i]
        chain = order[c]
        return chain[k + delta] if 0 <= k + delta < len(chain) else None

    ladders: list[tuple[int, int]] = []
    for i in range(count):
        for j in range(i + 3, count):
            im, ip = neighbour(i, -1), neighbour(i, 1)
            jm, jp = neighbour(j, -1), neighbour(j, 1)
            complete = None not in (im, ip, jm, jp)
            parallel = complete and (
                (bonded(im, j) and bonded(j, ip)) or (bonded(jm, i) and bonded(i, jp))
            )
            antiparallel = (bonded(i, j) and bonded(j, i)) or (
                complete and bonded(im, jp) and bonded(jm, ip)
            )
            if parallel or antiparallel:
                ladders.append((i, j))

    bridged = {i for pair in ladders for i in pair}
    for i, j in ladders:
        # a bridge next to another bridge is part of a strand (E); a lone one is a beta bridge (B)
        for x in (i, j):
            extended = any(y in bridged for y in (neighbour(x, -1), neighbour(x, 1)) if y)
            codes[x].add("E" if extended else "B")


def _assign_codes(
    order: list[list[int]], bonds: dict[tuple[int, int], float], count: int
) -> list[str]:
    """DSSP's turn and bridge patterns, reduced to the codes Atomscope draws."""

    def bonded(acceptor: int | None, donor: int | None) -> bool:
        return (donor, acceptor) in bonds

    codes: list[set[str]] = [set() for _ in range(count)]
    _helices(order, _turns(order, bonded, count), codes)
    _bridges(order, bonded, codes, count)
    return [next((c for c in _PRIORITY if c in s), "-") for s in codes]


def analyse(structure: Structure) -> SecondaryStructure:
    """Backbone perception, hydrogen bonds and the helix/sheet assignment that follows."""
    residues = backbone(structure)
    order = chains(structure, residues)
    bonds = hydrogen_bonds(structure, residues, order)
    codes = _assign_codes(order, bonds, len(residues))
    result = SecondaryStructure(
        residues=[
            Assignment(residue=r.residue, code=codes[i], kind=_KIND_OF_CODE[codes[i]], backbone=r)
            for i, r in enumerate(residues)
        ],
        chains=[[residues[i].residue for i in chain] for chain in order],
        hbonds=[
            (residues[d].residue, residues[a].residue, e) for (d, a), e in sorted(bonds.items())
        ],
    )
    for c, chain in enumerate(order):
        for k, i in enumerate(chain):
            residues[i].chain = c
            residues[i].order = k
    return result
