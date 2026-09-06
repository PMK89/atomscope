"""Reader for ORCA output files (also gzipped).

One of the OpenQube readers Avogadro 1 used (extensions/surfaces/openqube/orca.cpp). ORCA prints
everything a wavefunction needs into its ordinary output when the orbitals are printed
(``! LargePrint``, or ``%output print[p_mos] 1 end``), and these blocks are read:

``CARTESIAN COORDINATES (A.U.)``   ``NO LB ZA FRAG MASS X Y Z`` -- the geometry, in Bohr
``BASIS SET IN INPUT FORMAT``      per element: ``NewGTO``, shell letter and primitive count,
                                   then ``index exponent coefficient`` lines, ``end;``
``Total Charge`` / ``Multiplicity`` / ``Number of Electrons`` / ``Basis Dimension``
``MOLECULAR ORBITALS``             the coefficients, six orbitals to a block, each row labelled
                                   with its atom and basis function (``0C   1dz2``)

The last of each is used: a geometry optimization prints them once per step (and the basis and
the orbitals again for the final single point), so the last is the converged answer.

Two things are measured rather than assumed, because ORCA has surprised us on both:

* whether a shell is solid-harmonic is decided from the component labels the orbital block prints
  for it, not from what ORCA usually does, and
* the coefficient convention is measured by `gto.with_normalized_primitives`, as it is for Molden
  files. ORCA's output happens to follow the usual convention here where `orca_2mkl`'s Molden
  files do not, which is exactly why neither is assumed.

The row labels also say which component is which, so the basis functions are permuted into the
order `gto.py` evaluates in from the labels rather than from a table of what ORCA prints: only p
actually moves (ORCA writes pz, px, py).

Not read: unrestricted outputs (there is no fixture, and reading only the alpha orbitals would
quietly halve the density), and Cartesian-basis runs, whose component labels this has never seen.
"""

from __future__ import annotations

import gzip
import re
from pathlib import Path

import numpy as np
from ase.data import atomic_numbers
from ase.units import Bohr

from atomscope.model import Atom, Provenance, Structure
from atomscope.wavefunction.gto import with_normalized_primitives
from atomscope.wavefunction.model import SHELL_LETTERS, MolecularOrbital, Shell, Wavefunction

# The component labels ORCA prints, in its order, against the order gto.py evaluates in. Only the
# solid-harmonic labels are here: a Cartesian run prints something else, and is refused rather
# than guessed at. g shells (l = 4) have no solid-harmonic transformation in gto.py yet.
ORCA_LABELS: dict[int, list[str]] = {
    0: ["s"],
    1: ["pz", "px", "py"],
    2: ["dz2", "dxz", "dyz", "dx2y2", "dxy"],
    3: ["f0", "f+1", "f-1", "f+2", "f-2", "f+3", "f-3"],
}
INTERNAL_LABELS: dict[int, list[str]] = {
    0: ["s"],
    1: ["px", "py", "pz"],  # gto.py keeps p Cartesian: x, y, z
    2: ORCA_LABELS[2],  # d and f agree: m = 0, +1, -1, +2, -2, ...
    3: ORCA_LABELS[3],
}

# " 23H   1dx2y2   -0.000038  0.000025 ..." -- atom index, element, shell ordinal, component
_ROW = re.compile(r"^\s*(\d+)([A-Za-z]{1,2})\s+(\d+)([a-z][a-z0-9+-]*)\s+(.*\S)\s*$")
# ORCA prints coefficients as %10.6f, which run together when one needs the whole width
_NUMBER = re.compile(r"-?\d+\.\d{6}")


def _read_text(path: Path) -> str:
    if path.suffix == ".gz":
        with gzip.open(path, "rt", errors="replace") as fh:
            return fh.read()
    return path.read_text(errors="replace")


def _read_geometry(lines: list[str]) -> tuple[list[str], np.ndarray]:
    """The last ``CARTESIAN COORDINATES (A.U.)`` block, as symbols and positions in Angstrom."""
    symbols: list[str] = []
    positions: list[tuple[float, float, float]] = []
    for i, line in enumerate(lines):
        if "CARTESIAN COORDINATES (A.U.)" not in line:
            continue
        found_symbols: list[str] = []
        found_positions: list[tuple[float, float, float]] = []
        for row in lines[i + 3 :]:  # a rule and the column titles come first
            parts = row.split()
            if len(parts) != 8 or not parts[0].isdigit():
                break
            symbol = parts[1].capitalize()
            if symbol not in atomic_numbers:
                break
            found_symbols.append(symbol)
            found_positions.append(
                (float(parts[5]) * Bohr, float(parts[6]) * Bohr, float(parts[7]) * Bohr)
            )
        if found_symbols:
            symbols, positions = found_symbols, found_positions  # keep the last block
    if not symbols:
        msg = "no CARTESIAN COORDINATES (A.U.) block in the ORCA output"
        raise ValueError(msg)
    return symbols, np.array(positions, dtype=float)


def _read_basis(lines: list[str]) -> dict[str, list[tuple[int, np.ndarray, np.ndarray]]]:
    """The last ``BASIS SET IN INPUT FORMAT``: shells per element, in the order printed."""
    starts = [i for i, line in enumerate(lines) if "BASIS SET IN INPUT FORMAT" in line]
    if not starts:
        msg = "no BASIS SET IN INPUT FORMAT block in the ORCA output"
        raise ValueError(msg)
    basis: dict[str, list[tuple[int, np.ndarray, np.ndarray]]] = {}
    i = starts[-1]
    while i < len(lines):
        line = lines[i].strip()
        if "AUXILIARY" in line:
            break
        if not line.startswith("NewGTO"):
            i += 1
            continue
        element = line.split()[1].capitalize()
        shells: list[tuple[int, np.ndarray, np.ndarray]] = []
        i += 1
        while i < len(lines) and lines[i].strip() != "end;":
            parts = lines[i].split()
            if len(parts) != 2 or parts[0].upper() not in SHELL_LETTERS:
                msg = f"unexpected line in the basis of {element}: {lines[i].strip()!r}"
                raise ValueError(msg)
            momentum, count = SHELL_LETTERS.index(parts[0].upper()), int(parts[1])
            primitives = [lines[i + 1 + j].split() for j in range(count)]
            shells.append(
                (
                    momentum,
                    np.array([float(p[1]) for p in primitives]),
                    np.array([float(p[2]) for p in primitives]),
                )
            )
            i += 1 + count
        basis[element] = shells
        i += 1
    if not basis:
        msg = "the BASIS SET IN INPUT FORMAT block held no shells"
        raise ValueError(msg)
    return basis


def _read_orbitals(
    lines: list[str],
) -> tuple[list[np.ndarray], list[float], list[float], list[tuple[int, int, str]]]:
    """The last ``MOLECULAR ORBITALS`` block: coefficients, energies, occupations, row labels.

    A row label is (atom index, shell ordinal on that atom, component), which is what says how
    the basis functions are grouped into shells and which component each row carries.
    """
    starts = [i for i, line in enumerate(lines) if line.strip() == "MOLECULAR ORBITALS"]
    if not starts:
        msg = "no MOLECULAR ORBITALS block in the ORCA output"
        raise ValueError(msg)
    columns: list[np.ndarray] = []
    energies: list[float] = []
    occupations: list[float] = []
    labels: list[tuple[int, int, str]] = []
    i = starts[-1] + 2  # the block title and its rule
    while i + 4 < len(lines):
        header = lines[i].split()
        if not header or not all(token.isdigit() for token in header):
            break
        count = len(header)
        energy = [float(x) for x in lines[i + 1].split()]
        occupation = [float(x) for x in lines[i + 2].split()]
        if len(energy) != count or len(occupation) != count:
            msg = f"orbital block at line {i + 1} has {count} columns but not that many energies"
            raise ValueError(msg)
        block, block_labels, i = _orbital_block(lines, i + 4, count)
        if not block_labels:
            break
        if labels and block_labels != labels:
            msg = "the orbital blocks do not agree on the basis functions"
            raise ValueError(msg)
        labels = block_labels
        columns.extend(block)
        energies.extend(energy)
        occupations.extend(occupation)
    if not columns:
        msg = "the MOLECULAR ORBITALS block held no orbitals"
        raise ValueError(msg)
    return columns, energies, occupations, labels


def _orbital_block(
    lines: list[str], start: int, count: int
) -> tuple[list[np.ndarray], list[tuple[int, int, str]], int]:
    """One block of `count` orbitals printed side by side, its row labels, and the line after."""
    block: list[list[float]] = [[] for _ in range(count)]
    labels: list[tuple[int, int, str]] = []
    i = start
    while i < len(lines):
        match = _ROW.match(lines[i])
        if not match:
            break
        values = _NUMBER.findall(match.group(5))
        if len(values) != count:
            msg = f"line {i + 1} of the orbitals has {len(values)} coefficients, expected {count}"
            raise ValueError(msg)
        labels.append((int(match.group(1)), int(match.group(3)), match.group(4)))
        for k, value in enumerate(values):
            block[k].append(float(value))
        i += 1
    return [np.array(column, dtype=float) for column in block], labels, i


def _groups(labels: list[tuple[int, int, str]]) -> list[list[str]]:
    """The row labels grouped into shells: consecutive rows of one atom, ordinal and momentum."""
    groups: list[list[str]] = []
    key: tuple[int, int, str] | None = None
    for atom, ordinal, component in labels:
        here = (atom, ordinal, component[0])
        if here != key:
            groups.append([])
            key = here
        groups[-1].append(component)
    return groups


def _shells_and_permutation(
    symbols: list[str],
    basis: dict[str, list[tuple[int, np.ndarray, np.ndarray]]],
    labels: list[tuple[int, int, str]],
) -> tuple[list[Shell], np.ndarray]:
    """Expand the per-element basis over the atoms, and say where each function sits in the file.

    The orbital rows are the check: they name one basis function each, in ORCA's order, so their
    grouping has to reproduce the shells the basis block gives -- and their labels, rather than a
    table of what ORCA prints, are what the coefficients are permuted by.
    """
    groups = _groups(labels)
    shells: list[Shell] = []
    order: list[int] = []
    offset = 0
    index = 0
    for atom, symbol in enumerate(symbols):
        if symbol not in basis:
            msg = f"the basis has nothing for {symbol}"
            raise ValueError(msg)
        for momentum, exponents, coefficients in basis[symbol]:
            if index >= len(groups):
                msg = "the orbitals stop before the basis does"
                raise ValueError(msg)
            group = groups[index]
            expected = ORCA_LABELS.get(momentum)
            if expected is None:
                letter = SHELL_LETTERS[momentum]
                msg = f"{letter} shells are not read from ORCA output yet"
                raise ValueError(msg)
            if sorted(group) != sorted(expected):
                msg = (
                    f"atom {atom} {symbol}: the orbitals label its {SHELL_LETTERS[momentum]} shell"
                    f" {group}, which is not the {expected} this reader knows"
                )
                raise ValueError(msg)
            shells.append(Shell(atom, momentum, True, exponents, coefficients))
            order.extend(offset + group.index(name) for name in INTERNAL_LABELS[momentum])
            offset += len(group)
            index += 1
    if index != len(groups):
        msg = f"the orbitals hold {len(groups)} shells, the basis {index}"
        raise ValueError(msg)
    return shells, np.array(order, dtype=int)


def _value(lines: list[str], key: str) -> float | None:
    """The last ``  <key>   XXX  ....  <value>`` line ORCA writes in its settings tables."""
    for line in reversed(lines):
        if key in line and "...." in line:
            try:
                return float(line.split("....")[-1])
            except ValueError:
                return None
    return None


def read_orca(path: Path) -> Wavefunction:
    """Read geometry, basis and molecular orbitals from an ORCA output file."""
    text = _read_text(path)
    if "SPIN UP ORBITALS" in text:
        msg = "unrestricted ORCA outputs are not read yet (this one has alpha and beta orbitals)"
        raise ValueError(msg)
    lines = text.splitlines()
    symbols, positions = _read_geometry(lines)
    structure = Structure(
        name=path.stem,
        atoms=[
            Atom(element=s, position=(p[0], p[1], p[2]))
            for s, p in zip(symbols, positions, strict=True)
        ],
        provenance=Provenance(source=str(path), software="ORCA"),
    )
    columns, energies, occupations, labels = _read_orbitals(lines)
    shells, order = _shells_and_permutation(symbols, _read_basis(lines), labels)
    shells, convention = with_normalized_primitives(shells)

    dimension = _value(lines, "Basis Dimension")
    if dimension is not None and int(dimension) != len(labels):
        msg = f"the orbitals hold {len(labels)} basis functions, the header says {int(dimension)}"
        raise ValueError(msg)

    orbitals = [
        MolecularOrbital(
            coefficients=column[order],
            energy=energies[i],
            occupation=occupations[i],
            spin="none",
        )
        for i, column in enumerate(columns)
    ]
    electrons = _value(lines, "Number of Electrons")
    charge = _value(lines, "Total Charge")
    multiplicity = _value(lines, "Multiplicity")
    wavefunction = Wavefunction(
        structure=structure,
        shells=shells,
        orbitals=orbitals,
        source=str(path),
        # the header is the calculation's own count; the occupations are the fallback for a
        # hand-cut file that has no settings table
        n_electrons=float(sum(occupations)) if electrons is None else electrons,
        charge=0.0 if charge is None else charge,
        multiplicity=1 if multiplicity is None else int(multiplicity),
        metadata={"format": "orca", "coefficient_convention": convention},
    )
    wavefunction.validate()
    return wavefunction
