"""Reader for GAMESS-US log files (also gzipped).

One of the OpenQube readers Avogadro 1 used (extensions/surfaces/openqube/gamessus.cpp). A GAMESS
log is prose with a few fixed blocks in it, and only these are read:

``COORDINATES (BOHR)``          element, nuclear charge, x, y, z -- the geometry
``COORDINATES OF ALL ATOMS``    the same in Angstrom, printed by a geometry optimization
``ATOMIC BASIS SET``            per atom, one line per primitive:
                                ``shell TYPE primitive exponent coefficient [coefficient]``
``NUMBER OF ELECTRONS``         and the occupied-orbital counts beside it
``EIGENVECTORS``                the MO coefficients, five orbitals to a block

The last of each is used: a geometry optimization prints the blocks once per step, and the final
one is the converged answer.

Shells are always Cartesian here, whatever ``ISPHER`` says. GAMESS restricts the *variational*
space to solid harmonics when asked (the log says so, and the fixture used for the tests does),
but it still prints the orbitals over the Cartesian AO basis -- 126 functions for the 21 d shells
of the d-only fixture. Avogadro's reader makes the same assumption.

The Cartesian components come in GAMESS's order, which agrees with Gaussian's for d
(XX YY ZZ XY XZ YZ) and differs for f: GAMESS writes XXX YYY ZZZ XXY XXZ YYX YYZ ZZX ZZY XYZ
where Gaussian writes XXX YYY ZZZ XYY XXY XXZ XZZ YZZ YYZ XYZ, so f coefficients are permuted
into the order ``gto.py`` evaluates in.
"""

from __future__ import annotations

import gzip
import re
from pathlib import Path

import numpy as np
from ase.data import atomic_numbers, chemical_symbols
from ase.units import Bohr

from atomscope.model import Atom, Provenance, Structure
from atomscope.wavefunction.gto import CARTESIAN_ORDER
from atomscope.wavefunction.model import SHELL_LETTERS, MolecularOrbital, Shell, Wavefunction

# the component labels GAMESS prints, in its order, per angular momentum
GAMESS_CARTESIAN_LABELS: dict[int, list[str]] = {
    0: ["S"],
    1: ["X", "Y", "Z"],
    2: ["XX", "YY", "ZZ", "XY", "XZ", "YZ"],
    3: ["XXX", "YYY", "ZZZ", "XXY", "XXZ", "YYX", "YYZ", "ZZX", "ZZY", "XYZ"],
    4: [
        "XXXX",
        "YYYY",
        "ZZZZ",
        "XXXY",
        "XXXZ",
        "YYYX",
        "YYYZ",
        "ZZZX",
        "ZZZY",
        "XXYY",
        "XXZZ",
        "YYZZ",
        "XXYZ",
        "YYXZ",
        "ZZXY",
    ],
}


def _label_to_powers(label: str) -> tuple[int, int, int]:
    return (label.count("X"), label.count("Y"), label.count("Z"))


def _gamess_to_internal(l: int) -> list[int]:  # noqa: E741 - l is the angular momentum
    """For each internal component, which GAMESS column it is: `internal[i] = gamess[perm[i]]`."""
    labels = GAMESS_CARTESIAN_LABELS[l]
    powers = [_label_to_powers(label) for label in labels]
    return [powers.index(p) for p in CARTESIAN_ORDER[l]]


def _read_text(path: Path) -> str:
    if path.suffix == ".gz":
        with gzip.open(path, "rt", errors="replace") as fh:
            return fh.read()
    return path.read_text(errors="replace")


def _is_number(token: str) -> bool:
    try:
        float(token)
    except ValueError:
        return False
    return True


def _read_geometry(lines: list[str]) -> tuple[list[str], np.ndarray]:
    """The last geometry block, as symbols and positions in Angstrom."""
    symbols: list[str] = []
    positions: list[tuple[float, float, float]] = []
    for i, line in enumerate(lines):
        if "COORDINATES (BOHR)" in line:
            start, factor = i + 2, Bohr  # element charge x y z, after one header line
        elif "COORDINATES OF ALL ATOMS ARE (ANGS)" in line:
            start, factor = i + 3, 1.0  # two header lines, the second a rule
        else:
            continue
        found_symbols: list[str] = []
        found_positions: list[tuple[float, float, float]] = []
        for row in lines[start:]:
            parts = row.split()
            if len(parts) < 5 or not all(_is_number(p) for p in parts[1:5]):
                break
            symbol = parts[0].capitalize()
            if symbol not in atomic_numbers:
                symbol = chemical_symbols[int(float(parts[1]))]
            found_symbols.append(symbol)
            found_positions.append(
                (float(parts[2]) * factor, float(parts[3]) * factor, float(parts[4]) * factor)
            )
        if found_symbols:
            symbols, positions = found_symbols, found_positions  # keep the last block
    if not symbols:
        msg = "no atom coordinates in the GAMESS log"
        raise ValueError(msg)
    return symbols, np.array(positions, dtype=float)


def _read_shells(lines: list[str], n_atoms: int) -> list[Shell]:
    """The ATOMIC BASIS SET block: primitives grouped into shells, grouped by atom."""
    try:
        start = next(i for i, line in enumerate(lines) if "ATOMIC BASIS SET" in line)
    except StopIteration:
        msg = "no ATOMIC BASIS SET block in the GAMESS log"
        raise ValueError(msg) from None
    shells: list[Shell] = []
    atom = -1
    current: list[tuple[float, float, float | None]] = []
    letter = ""
    index = -1

    def flush() -> None:
        nonlocal current
        if not current:
            return
        exps = np.array([e for e, _, _ in current], dtype=float)
        coefs = np.array([c for _, c, _ in current], dtype=float)
        if letter == "L":  # an s and a p shell sharing exponents, as in an fchk SP shell
            shells.append(Shell(atom, 0, False, exps, coefs))
            shells.append(
                Shell(atom, 1, False, exps, np.array([c or 0.0 for _, _, c in current], float))
            )
        else:
            shells.append(Shell(atom, SHELL_LETTERS.index(letter), False, exps, coefs))
        current = []

    for line in lines[start + 1 :]:
        if "TOTAL NUMBER OF BASIS" in line or "NUMBER OF CARTESIAN GAUSSIAN" in line:
            break
        parts = line.split()
        if len(parts) == 1 and parts[0].capitalize() in atomic_numbers:
            flush()
            atom += 1
            index = -1
            continue
        if len(parts) < 5 or not parts[0].isdigit() or not _is_number(parts[3]):
            continue
        shell_index = int(parts[0])
        if shell_index != index:
            flush()
            index = shell_index
            letter = parts[1].upper()
        current.append(
            (float(parts[3]), float(parts[4]), float(parts[5]) if len(parts) > 5 else None)
        )
    flush()
    if not shells:
        msg = "the ATOMIC BASIS SET block held no shells"
        raise ValueError(msg)
    if max(s.atom_index for s in shells) >= n_atoms:
        msg = "the basis set names more atoms than the geometry has"
        raise ValueError(msg)
    return shells


_HEADER = re.compile(r"^\s*\d+(\s+\d+)*\s*$")


def _orbital_block(
    lines: list[str], start: int, count: int, n_basis: int
) -> tuple[list[np.ndarray], int]:
    """One block of `count` orbitals printed side by side, and the line after it."""
    block: list[list[float]] = [[] for _ in range(count)]
    j = start
    while j < len(lines):
        parts = lines[j].split()
        # index element atom label c1 .. ck: the coefficients are the last `count` numbers
        if len(parts) < 4 + count or not parts[0].isdigit():
            break
        values = parts[-count:]
        if not all(_is_number(v) for v in values):
            break
        for k, value in enumerate(values):
            block[k].append(float(value))
        j += 1
    if not block[0]:
        return [], start
    for column in block:
        if len(column) != n_basis:
            msg = f"an orbital has {len(column)} coefficients, expected {n_basis}"
            raise ValueError(msg)
    return [np.array(column, dtype=float) for column in block], j


def _read_orbitals(lines: list[str], n_basis: int) -> tuple[np.ndarray, list[float], list[str]]:
    """The last EIGENVECTORS block: coefficients (n_mo x n_basis), energies and symmetry labels."""
    titles = ("EIGENVECTORS", "MOLECULAR ORBITALS")
    starts = [i for i, line in enumerate(lines) if line.strip() in titles]
    if not starts:
        msg = "no EIGENVECTORS block in the GAMESS log"
        raise ValueError(msg)
    columns: list[np.ndarray] = []
    energies: list[float] = []
    symmetries: list[str] = []
    i = starts[-1] + 1
    while i < len(lines):
        line = lines[i]
        if "END OF" in line or "....." in line:
            break
        if not _HEADER.match(line):
            i += 1
            continue
        count = len(line.split())
        energy_row = lines[i + 1].split()
        symmetry_row = lines[i + 2].split()
        block, end = _orbital_block(lines, i + 3, count, n_basis)
        if not block:
            i += 1
            continue
        columns.extend(block)
        energies.extend(float(e) for e in energy_row[:count] if _is_number(e))
        symmetries.extend(symmetry_row[:count])
        i = end
    if not columns:
        msg = "the EIGENVECTORS block held no orbitals"
        raise ValueError(msg)
    return np.array(columns), energies, symmetries


def _permutation(shells: list[Shell]) -> np.ndarray:
    """Where each internal basis function sits in GAMESS's ordering of the same basis."""
    order: list[int] = []
    offset = 0
    for shell in shells:
        order.extend(offset + k for k in _gamess_to_internal(shell.angular_momentum))
        offset += shell.size
    return np.array(order, dtype=int)


def read_gamess(path: Path) -> Wavefunction:
    """Read geometry, basis and molecular orbitals from a GAMESS-US log."""
    lines = _read_text(path).splitlines()
    symbols, positions = _read_geometry(lines)
    structure = Structure(
        name=path.stem,
        atoms=[
            Atom(element=s, position=(p[0], p[1], p[2]))
            for s, p in zip(symbols, positions, strict=True)
        ],
        provenance=Provenance(source=str(path), software="GAMESS-US"),
    )
    shells = _read_shells(lines, structure.n_atoms)
    n_basis = sum(s.size for s in shells)
    coefficients, energies, symmetries = _read_orbitals(lines, n_basis)
    coefficients = coefficients[:, _permutation(shells)]

    n_electrons = 0.0
    n_alpha = n_beta = 0
    for line in lines:
        if "NUMBER OF ELECTRONS" in line and "=" in line:
            n_electrons = float(line.split("=")[-1])
        elif "NUMBER OF OCCUPIED ORBITALS (ALPHA)" in line:
            n_alpha = int(float(line.split("=")[-1]))
        elif "NUMBER OF OCCUPIED ORBITALS (BETA" in line:
            n_beta = int(float(line.split("=")[-1]))
    if n_alpha == 0 and n_electrons:
        n_alpha = n_beta = int(n_electrons) // 2

    orbitals = [
        MolecularOrbital(
            coefficients=row,
            energy=energies[i] if i < len(energies) else None,
            # a restricted log prints one set of orbitals holding both spins
            occupation=2.0 if i < min(n_alpha, n_beta) else 0.0,
            spin="none",
            label=symmetries[i] if i < len(symmetries) else "",
        )
        for i, row in enumerate(coefficients)
    ]
    wavefunction = Wavefunction(
        structure=structure,
        shells=shells,
        orbitals=orbitals,
        source=str(path),
        n_electrons=n_electrons or float(n_alpha + n_beta),
        metadata={"format": "gamess"},
    )
    wavefunction.validate()
    return wavefunction


__all__ = ["read_gamess"]
