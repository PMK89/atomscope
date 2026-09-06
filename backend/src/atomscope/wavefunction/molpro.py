"""Reader for Molpro output files (also gzipped).

The last of Avogadro 1's surface readers to be added here (extensions/surfaces/molpro.cpp).
Molpro prints everything a wavefunction needs when it is asked to (``gprint,basis`` and
``gprint,orbitals``), and these blocks are read:

``NR  ATOM    CHARGE  X Y Z``   the geometry, in Bohr
``BASIS DATA``                  one row per basis function: ``Nr Sym Nuc Type`` and then the
                                exponent/coefficient pairs of its primitives, continuation lines
                                carrying only the pairs
``Orb  Occ    Energy``          the orbitals: first the names of the basis functions, ten to a
                                line, then one row per orbital with its coefficients in that order
``NUMBER OF ELECTRONS`` / ``NUMBER OF CONTRACTIONS``  for the electron count and a size check

The basis functions carry their own names, in both blocks -- ``1 2px``, ``1 3d2-`` -- and those
names are what the components are ordered by here, so nothing about the layout is guessed: a name
says which atom, which shell and which solid harmonic (``d2-`` is m = -2), and a name this reader
does not know stops the read rather than being taken for a neighbour.

Two shapes are refused instead of guessed at, because the one Molpro file in the Avogadro corpus
(6-31G methane, s and p only, segmented, no symmetry) cannot check any of them:

* a generally contracted basis, where several basis functions share one exponent list and Molpro
  prints a column of coefficients per function,
* a run that used point-group symmetry, which is Molpro's default: the basis functions and the
  orbitals are then printed per irreducible representation (``1.2``, ``B1``) and a basis function
  is a combination over equivalent centres rather than one function on one atom, and
* unrestricted output, whose alpha and beta orbitals are printed as two blocks. The marker for
  it (``NEGATIVE SPIN``) is recalled rather than sourced -- Avogadro's reader has no such check
  and the corpus has no such file -- so the guard that does the work is the electron count: the
  occupations of the orbitals read have to add up to the electrons the header says there are.

The solid-harmonic phase convention for d and above is likewise unchecked here: the component
*order* comes from the names, but no file in the corpus has a d shell to compare against.
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

# "1s", "2px", "3d2-": the leading number is the shell's ordinal on its atom, the rest the
# component. s and p are named after the Cartesian axes, d and above after m.
_COMPONENT = re.compile(r"^\d*([a-z])([a-z]*|\d[+-]?)$")
_BASIS_ROW = re.compile(r"^\s*(\d+)\.(\d+)\s+([A-Za-z][A-Za-z0-9']*)\s+(.*)$")
# "  1.1   2   -11.2312  -31.0184  0.996237 ..." -- orbital.irrep, occupancy (fractional for
# natural orbitals), energy and Coulomb energy to four decimals, then the coefficients to six.
# The four decimals are what tells this from a continuation line of coefficients.
_ORBITAL_ROW = re.compile(
    r"^\s*(\d+)\.(\d+)\s+(\d+(?:\.\d+)?)\s+(-?\d+\.\d{4})\s+(-?\d+\.\d{4})\s+(.*\S)\s*$"
)
_NUMBER = re.compile(r"-?\d+\.\d{6}")

# the components of a shell, in the order gto.py evaluates them: x, y, z for p, then m order
_INTERNAL = {
    0: ["s"],
    1: ["px", "py", "pz"],
    2: ["d0", "d1+", "d1-", "d2+", "d2-"],
    3: ["f0", "f1+", "f1-", "f2+", "f2-", "f3+", "f3-"],
}


# Both shapes of a generally contracted block: several basis functions sharing one exponent
# list, which Molpro prints as a column of coefficients per function.
_GENERAL = (
    "this Molpro basis is generally contracted (several basis functions to one exponent list,"
    " a column of coefficients each), which this reader has no file to check itself against"
)
# Molpro numbers every basis function and every orbital <n>.<irrep>. A run that uses point-group
# symmetry -- which is what Molpro does unless told otherwise -- prints them per irreducible
# representation, and a basis function is then a combination over equivalent centres rather than
# one function on one atom. The corpus has no such file, so it is refused.
_SYMMETRY = (
    "this Molpro output uses point-group symmetry: its basis functions and orbitals are printed"
    " per irreducible representation, which this reader has no file to check itself against."
    " Rerun with `symmetry,nosym`"
)


def _read_text(path: Path) -> str:
    if path.suffix == ".gz":
        with gzip.open(path, "rt", errors="replace") as fh:
            return fh.read()
    return path.read_text(errors="replace")


def _momentum(component: str) -> int:
    """The angular momentum a component name belongs to, by its letter."""
    match = _COMPONENT.match(component)
    if match is None or match.group(1).upper() not in SHELL_LETTERS:
        msg = f"{component!r} is not a basis function name this reader knows"
        raise ValueError(msg)
    return SHELL_LETTERS.index(match.group(1).upper())


def _component(name: str) -> str:
    """The component of a basis function name: ``2px`` -> ``px``, ``3d2-`` -> ``d2-``."""
    return name.lstrip("0123456789")


def _read_geometry(lines: list[str]) -> tuple[list[str], np.ndarray]:
    """The last ``NR ATOM CHARGE X Y Z`` table, as symbols and positions in Angstrom."""
    symbols: list[str] = []
    positions: list[tuple[float, float, float]] = []
    for i, line in enumerate(lines):
        if "NR  ATOM" not in line or "CHARGE" not in line:
            continue
        found_symbols: list[str] = []
        found_positions: list[tuple[float, float, float]] = []
        for row in lines[i + 1 :]:
            parts = row.split()
            if not parts:
                if found_symbols:
                    break
                continue
            if len(parts) != 6 or not parts[0].isdigit():
                break
            symbol = parts[1].capitalize()
            if symbol not in atomic_numbers:
                break
            found_symbols.append(symbol)
            found_positions.append(
                (float(parts[3]) * Bohr, float(parts[4]) * Bohr, float(parts[5]) * Bohr)
            )
        if found_symbols:
            symbols, positions = found_symbols, found_positions  # keep the last table
    if not symbols:
        msg = "no NR ATOM CHARGE table in the Molpro output"
        raise ValueError(msg)
    return symbols, np.array(positions, dtype=float)


class _Function:
    """One row of BASIS DATA: a contracted basis function on one atom."""

    def __init__(self, atom: int, name: str) -> None:
        self.atom = atom
        self.name = name
        self.component = _component(name)
        self.momentum = _momentum(self.component)
        self.exponents: list[float] = []
        self.coefficients: list[float] = []

    def same_primitives(self, other: _Function) -> bool:
        return (
            len(self.exponents) == len(other.exponents)
            and np.allclose(self.exponents, other.exponents)
            and np.allclose(self.coefficients, other.coefficients)
        )


def _read_functions(lines: list[str]) -> list[_Function]:
    """The last BASIS DATA block, one entry per basis function, in the order printed."""
    starts = [i for i, line in enumerate(lines) if line.strip() == "BASIS DATA"]
    if not starts:
        msg = "no BASIS DATA block in the Molpro output"
        raise ValueError(msg)
    functions: list[_Function] = []
    for line in lines[starts[-1] + 1 :]:
        parts = line.split()
        if not parts:
            if functions:
                break
            continue
        row = _BASIS_ROW.match(line)
        if row is not None:
            if row.group(2) != "1":
                raise ValueError(_SYMMETRY)
            rest = row.group(4).split()
            if not rest or not rest[0].isdigit():
                raise ValueError(_GENERAL)
            functions.append(_Function(int(rest[0]) - 1, rest[1]))
            numbers = rest[2:]
        elif functions and len(parts) >= 2 and all(_is_number(p) for p in parts):
            numbers = parts
        elif functions:
            break
        else:
            continue
        if len(numbers) != 2:
            raise ValueError(_GENERAL)
        functions[-1].exponents.append(float(numbers[0]))
        functions[-1].coefficients.append(float(numbers[1]))
    if not functions:
        msg = "the BASIS DATA block held no basis functions"
        raise ValueError(msg)
    return functions


def _is_number(token: str) -> bool:
    try:
        float(token)
    except ValueError:
        return False
    return True


def _shells_and_permutation(functions: list[_Function]) -> tuple[list[Shell], np.ndarray]:
    """Group the basis functions into shells, and say where each one sits in Molpro's order.

    A shell is the run of consecutive functions on one atom that share an angular momentum and
    the very same primitives -- ``2px``, ``2py``, ``2pz`` written three times over -- and the
    components are put in the order `gto.py` evaluates by their names.
    """
    groups: list[list[_Function]] = []
    for function in functions:
        group = groups[-1] if groups else None
        if (
            group is None
            or function.atom != group[0].atom
            or function.momentum != group[0].momentum
            or not function.same_primitives(group[0])
            or function.component in {f.component for f in group}
        ):
            groups.append([function])
        else:
            group.append(function)

    shells: list[Shell] = []
    order: list[int] = []
    offset = 0
    for group in groups:
        first = group[0]
        components = [f.component for f in group]
        expected = _INTERNAL.get(first.momentum)
        if expected is None:
            msg = f"{SHELL_LETTERS[first.momentum]} shells are not read from Molpro output yet"
            raise ValueError(msg)
        if sorted(components) != sorted(expected):
            msg = (
                f"atom {first.atom}: the basis names this {SHELL_LETTERS[first.momentum]} shell"
                f" {components}, which is not the {expected} this reader knows"
            )
            raise ValueError(msg)
        shells.append(
            Shell(
                first.atom,
                first.momentum,
                True,
                np.array(first.exponents),
                np.array(first.coefficients),
            )
        )
        order.extend(offset + components.index(name) for name in expected)
        offset += len(group)
    return shells, np.array(order, dtype=int)


def _read_orbitals(
    lines: list[str], n_basis: int
) -> tuple[list[np.ndarray], list[float], list[float], list[str]]:
    """The last orbital block: coefficients, energies, occupations and the basis-function names."""
    starts = [i for i, line in enumerate(lines) if "Orb  Occ" in line and "Energy" in line]
    if not starts:
        msg = "no orbital block in the Molpro output"
        raise ValueError(msg)
    names: list[str] = []
    columns: list[np.ndarray] = []
    energies: list[float] = []
    occupations: list[float] = []
    current: list[float] = []
    for line in lines[starts[-1] + 1 :]:
        row = _ORBITAL_ROW.match(line)
        if row is not None:
            if row.group(2) != "1":
                raise ValueError(_SYMMETRY)
            if current:
                columns.append(np.array(current))
            current = [float(v) for v in _NUMBER.findall(row.group(6))]
            energies.append(float(row.group(4)))
            occupations.append(float(row.group(3)))
            continue
        parts = line.split()
        if not parts:
            continue
        if current:
            if not all(_is_number(p) for p in parts):
                break
            current.extend(float(v) for v in _NUMBER.findall(line))
        elif not columns:
            # the names of the basis functions, ten "<atom> <name>" pairs to a line
            if len(parts) % 2 or not all(p.isdigit() for p in parts[::2]):
                break
            names.extend(parts[1::2])
    if current:
        columns.append(np.array(current))
    return _checked(columns, n_basis), energies, occupations, names


def _checked(columns: list[np.ndarray], n_basis: int) -> list[np.ndarray]:
    """Every orbital has to span the basis the BASIS DATA block described."""
    if not columns:
        msg = "the orbital block held no orbitals"
        raise ValueError(msg)
    for i, column in enumerate(columns):
        if column.shape != (n_basis,):
            msg = f"orbital {i + 1} has {column.size} coefficients, expected {n_basis}"
            raise ValueError(msg)
    return columns


def _electrons(lines: list[str]) -> tuple[float, int]:
    """The electron count and the multiplicity, from ``NUMBER OF ELECTRONS:  5+   5-``."""
    for line in reversed(lines):
        if "NUMBER OF ELECTRONS" not in line:
            continue
        counts = re.findall(r"(\d+)([+-])", line.split(":", 1)[-1])
        if len(counts) != 2:
            break
        alpha, beta = (int(counts[0][0]), int(counts[1][0]))
        return float(alpha + beta), abs(alpha - beta) + 1
    return 0.0, 1


def read_molpro(path: Path) -> Wavefunction:
    """Read geometry, basis and molecular orbitals from a Molpro output file."""
    text = _read_text(path)
    if "NEGATIVE SPIN" in text:
        msg = "unrestricted Molpro output is not read yet (this one has alpha and beta orbitals)"
        raise ValueError(msg)
    lines = text.splitlines()
    symbols, positions = _read_geometry(lines)
    structure = Structure(
        name=path.stem,
        atoms=[
            Atom(element=s, position=(p[0], p[1], p[2]))
            for s, p in zip(symbols, positions, strict=True)
        ],
        provenance=Provenance(source=str(path), software="Molpro"),
    )
    functions = _read_functions(lines)
    shells, order = _shells_and_permutation(functions)
    n_basis = sum(s.size for s in shells)
    columns, energies, occupations, names = _read_orbitals(lines, n_basis)
    if names and names != [f.name for f in functions]:
        msg = "the orbitals and the basis do not agree on the basis functions"
        raise ValueError(msg)
    shells, convention = with_normalized_primitives(shells)

    electrons, multiplicity = _electrons(lines)
    counted = float(sum(occupations))
    if electrons and abs(counted - electrons) > 0.5:
        msg = (
            f"the orbitals printed account for {counted:g} of the {electrons:g} electrons of this"
            " calculation -- one spin of an unrestricted wavefunction, or an active space without"
            " its core -- and reading them as the whole would give the wrong density"
        )
        raise ValueError(msg)
    wavefunction = Wavefunction(
        structure=structure,
        shells=shells,
        orbitals=[
            MolecularOrbital(
                coefficients=column[order],
                energy=energies[i],
                occupation=occupations[i],
                spin="none",
            )
            for i, column in enumerate(columns)
        ],
        source=str(path),
        n_electrons=electrons or float(sum(occupations)),
        charge=float(sum(atomic_numbers[s] for s in symbols)) - electrons,
        multiplicity=multiplicity,
        metadata={"format": "molpro", "coefficient_convention": convention},
    )
    wavefunction.validate()
    return wavefunction
