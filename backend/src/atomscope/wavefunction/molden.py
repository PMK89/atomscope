"""Reader for Molden files (``[Atoms]``, ``[GTO]``, ``[MO]``).

Molden is the interchange format most quantum-chemistry programs can write, and the one
Avogadro 1 reads through OpenQube. Sections used here:

``[Atoms] (Angs|AU)``   symbol, index, atomic number, x, y, z
``[GTO]``               per atom: shell letter, primitive count, scale, then exponent/coefficient
                        pairs (an ``sp`` shell carries two coefficient columns)
``[MO]``                per orbital: ``Sym=``, ``Ene=``, ``Spin=``, ``Occup=`` then
                        ``index coefficient`` lines
``[5D] [7F] [9G]``      flags marking solid-harmonic shells (``[5D10F]`` variants also exist)

Cartesian shells are assumed unless the corresponding flag is present, which is the Molden
convention.
"""

from __future__ import annotations

import gzip
import re
from pathlib import Path

import numpy as np
from ase.data import chemical_symbols
from ase.units import Bohr

from atomscope.model import Atom, Provenance, Structure
from atomscope.wavefunction.gto import contraction_norm, primitive_norm
from atomscope.wavefunction.model import SHELL_LETTERS, MolecularOrbital, Shell, Wavefunction

_SECTION = re.compile(r"^\s*\[([^\]]+)\]\s*(.*)$")


def _read_text(path: Path) -> str:
    if path.suffix == ".gz":
        with gzip.open(path, "rt", errors="replace") as fh:
            return fh.read()
    return path.read_text(errors="replace")


def _split_sections(text: str) -> list[tuple[str, str, list[str]]]:
    """Return (name, argument, lines) for every ``[Section]`` in order."""
    sections: list[tuple[str, str, list[str]]] = []
    current: tuple[str, str, list[str]] | None = None
    for line in text.splitlines():
        m = _SECTION.match(line)
        if m:
            if current is not None:
                sections.append(current)
            current = (m.group(1).strip().upper(), m.group(2).strip(), [])
        elif current is not None:
            current[2].append(line)
    if current is not None:
        sections.append(current)
    return sections


def _primitive_convention(shells: list[Shell]) -> str | None:
    """Which convention the single-primitive s and p shells are written in, if they agree.

    An uncontracted shell has nothing to contract, so a program that publishes coefficients for
    normalized primitives writes exactly 1; one that publishes them for unnormalized primitives
    writes the primitive's own normalization N(alpha). Shells with l >= 2 are left out: ORCA
    folds a further constant into them (sqrt(3) for d, so that the xy component comes out
    normalized), which is a per-shell factor the self-overlap absorbs but this test would not.

    Returns "normalized", "unnormalized", or None when the shells disagree, say neither, or
    there are no uncontracted s or p shells to ask.
    """
    votes: set[str] = set()
    for shell in shells:
        if len(shell.exponents) != 1 or shell.angular_momentum > 1:
            continue
        c = abs(float(shell.coefficients[0]))
        n = primitive_norm(float(shell.exponents[0]), (shell.angular_momentum, 0, 0))
        if abs(c - 1.0) < 0.01:
            votes.add("normalized")
        elif abs(c / n - 1.0) < 0.01:
            votes.add("unnormalized")
        else:
            return None
    return votes.pop() if len(votes) == 1 else None


def _with_normalized_primitives(shells: list[Shell]) -> tuple[list[Shell], str]:
    """Put the contraction coefficients into the convention the evaluator expects.

    Molden's specification says the coefficients are for *normalized* primitives, and the
    conforming files here -- from Molden, Gaussian and GAMESS -- follow it: every contracted
    shell then has a self-overlap of one, to the last digit, and a single-primitive shell is
    written with a coefficient of exactly 1.

    ORCA's `orca_2mkl` does not: it writes the coefficients for unnormalized primitives, so the
    primitive's own normalization is folded into them (a single-primitive s shell comes out as
    0.36, a d shell as 1.93 = sqrt(3) N). Read as the specification says, the *shapes* of the
    contracted functions are wrong -- each is still normalized afterwards, so nothing looks amiss
    until the orbitals are integrated and come back with norms around 0.82 instead of 1.

    The convention is measured rather than guessed from which program wrote the file, and two
    independent measurements have to agree before anything is divided out:

    * every shell's self-overlap is 1.000 under the specification (0.11 to 7.35 for the ORCA
      file here), and
    * an uncontracted s or p shell is written as 1 under the specification, as N(alpha) by ORCA.

    The first test alone would also fire on a conforming file whose *contractions* are not
    normalized -- coefficients copied out of a basis-set library, which Molden itself renormalizes
    on read. No such file is in the corpus here, but the second test tells that case apart, and
    when the two disagree the coefficients are left exactly as written.

    Returns the shells and a short note naming the convention they were read in.
    """
    factors = np.array([contraction_norm(shell) for shell in shells])
    if float(np.abs(factors - 1.0).max()) < 0.01:
        return shells, "normalized primitives"
    convention = _primitive_convention(shells)
    if convention == "normalized":
        return shells, "normalized primitives, unnormalized contractions"
    note = "unnormalized primitives"
    if convention is None:
        note += " (self-overlaps only)"
    fixed: list[Shell] = []
    for shell in shells:
        powers = (shell.angular_momentum, 0, 0)
        norms = np.array([primitive_norm(float(e), powers) for e in shell.exponents])
        fixed.append(
            Shell(
                shell.atom_index,
                shell.angular_momentum,
                shell.pure,
                shell.exponents,
                shell.coefficients / norms,
            )
        )
    return fixed, note


def read_molden(path: Path) -> Wavefunction:
    sections = _split_sections(_read_text(path))
    names = {name for name, _, _ in sections}
    if "MOLDEN FORMAT" not in names and "ATOMS" not in names:
        msg = f"{path.name} does not look like a Molden file"
        raise ValueError(msg)
    pure = {
        2: any(n in names for n in ("5D", "5D7F", "5D10F")),
        3: any(n in names for n in ("7F", "5D7F")),
        4: "9G" in names,
    }
    if "5D10F" in names:
        pure[3] = False

    structure = _read_atoms(sections, path)
    shells = _read_shells(sections)
    shells = [
        Shell(
            s.atom_index,
            s.angular_momentum,
            pure.get(s.angular_momentum, False),
            s.exponents,
            s.coefficients,
        )
        for s in shells
    ]
    shells, convention = _with_normalized_primitives(shells)
    n_basis = sum(s.size for s in shells)
    orbitals = _read_orbitals(sections, n_basis)

    wavefunction = Wavefunction(
        structure=structure,
        shells=shells,
        orbitals=orbitals,
        source=str(path),
        n_electrons=float(sum(mo.occupation for mo in orbitals)),
        metadata={"format": "molden", "coefficient_convention": convention},
    )
    wavefunction.validate()
    return wavefunction


def _read_atoms(sections: list[tuple[str, str, list[str]]], path: Path) -> Structure:
    for name, argument, lines in sections:
        if name != "ATOMS":
            continue
        scale = Bohr if argument.upper().startswith("AU") else 1.0
        atoms = []
        for line in lines:
            parts = line.split()
            if len(parts) < 6:
                continue
            z = int(parts[2])
            x, y, zc = (float(v) * scale for v in parts[3:6])
            atoms.append(Atom(element=chemical_symbols[z], position=(x, y, zc)))
        return Structure(
            name=path.stem,
            atoms=atoms,
            provenance=Provenance(source=str(path), software="Molden"),
        )
    msg = "Molden file has no [Atoms] section"
    raise ValueError(msg)


def _read_shells(sections: list[tuple[str, str, list[str]]]) -> list[Shell]:
    for name, _, lines in sections:
        if name != "GTO":
            continue
        shells: list[Shell] = []
        atom_index = -1
        i = 0
        while i < len(lines):
            parts = lines[i].split()
            i += 1
            if not parts:
                continue
            if len(parts) >= 2 and parts[0].isdigit() and parts[1] in ("0", "0.0"):
                atom_index = int(parts[0]) - 1
                continue
            letter = parts[0].lower()
            if letter not in {c.lower() for c in SHELL_LETTERS} | {"sp"}:
                continue
            count = int(parts[1])
            exponents = np.empty(count)
            first = np.empty(count)
            second = np.empty(count)
            for p in range(count):
                values = [float(v.replace("D", "E").replace("d", "e")) for v in lines[i].split()]
                i += 1
                exponents[p] = values[0]
                first[p] = values[1]
                second[p] = values[2] if len(values) > 2 else 0.0
            if letter == "sp":
                shells.append(Shell(atom_index, 0, False, exponents, first))
                shells.append(Shell(atom_index, 1, False, exponents, second))
            else:
                shells.append(
                    Shell(atom_index, SHELL_LETTERS.index(letter.upper()), False, exponents, first)
                )
        return shells
    msg = "Molden file has no [GTO] section"
    raise ValueError(msg)


def _read_orbitals(
    sections: list[tuple[str, str, list[str]]], n_basis: int
) -> list[MolecularOrbital]:
    """Read the ``[MO]`` section.

    An orbital block is a run of ``key= value`` header lines followed by ``index coefficient``
    lines; the next header line after coefficients starts the next orbital (Molden files may or
    may not carry ``Sym=``, so the transition is detected on the coefficients, not on a key).
    """
    for name, _, lines in sections:
        if name != "MO":
            continue
        orbitals: list[MolecularOrbital] = []
        header: dict[str, str] = {}
        coefficients = np.zeros(n_basis)
        have_coefficients = False

        def flush(
            header: dict[str, str], coefficients: np.ndarray, have: bool
        ) -> MolecularOrbital | None:
            if not have:
                return None
            spin = header.get("spin", "alpha").lower()
            return MolecularOrbital(
                coefficients=coefficients.copy(),
                energy=float(header["ene"]) if "ene" in header else None,
                occupation=float(header.get("occup", 0.0)),
                spin="beta" if spin.startswith("b") else "alpha",
                label=header.get("sym", ""),
            )

        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue
            if "=" in stripped and not stripped[0].isdigit():
                if have_coefficients:
                    done = flush(header, coefficients, have_coefficients)
                    if done is not None:
                        orbitals.append(done)
                    header = {}
                    coefficients = np.zeros(n_basis)
                    have_coefficients = False
                key, _, value = stripped.partition("=")
                header[key.strip().lower()] = value.strip()
                continue
            parts = stripped.split()
            if len(parts) >= 2 and parts[0].isdigit():
                index = int(parts[0]) - 1
                if 0 <= index < n_basis:
                    coefficients[index] = float(parts[1].replace("D", "E"))
                    have_coefficients = True
        done = flush(header, coefficients, have_coefficients)
        if done is not None:
            orbitals.append(done)
        # a restricted Molden file marks every orbital "Alpha" with occupation 2
        if all(mo.spin == "alpha" for mo in orbitals) and any(
            mo.occupation > 1.5 for mo in orbitals
        ):
            for mo in orbitals:
                mo.spin = "none"
        return orbitals
    msg = "Molden file has no [MO] section"
    raise ValueError(msg)
