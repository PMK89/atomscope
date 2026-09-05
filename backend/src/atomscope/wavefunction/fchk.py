"""Reader for Gaussian formatted checkpoint files (``.fchk``, also gzipped).

The format is a sequence of labelled records: ``label  type  value`` for scalars and
``label  type  N=  count`` followed by the values, five reals or six integers per line.
Only the sections needed to rebuild the basis and the orbitals are read.

Shell types follow Gaussian's convention: 0 = S, 1 = P, -1 = SP ("L", one s and one p shell
sharing exponents), 2 = 6D, -2 = 5D, 3 = 10F, -3 = 7F, and so on; a negative value means solid
harmonics.
"""

from __future__ import annotations

import gzip
from pathlib import Path

import numpy as np
from ase.data import chemical_symbols
from ase.units import Bohr

from atomscope.model import Atom, Provenance, Structure
from atomscope.wavefunction.model import MolecularOrbital, Shell, Wavefunction, shell_size


def _open_text(path: Path) -> str:
    if path.suffix == ".gz":
        with gzip.open(path, "rt", errors="replace") as fh:
            return fh.read()
    return path.read_text(errors="replace")


Record = int | float | str | list[int] | list[float]


def parse_records(text: str) -> dict[str, Record]:
    """Split an fchk into ``{label: value}``; arrays become lists of float/int."""
    records: dict[str, Record] = {}
    lines = text.splitlines()
    i = 2  # first two lines are title and route information
    while i < len(lines):
        line = lines[i]
        i += 1
        if len(line) < 43 or not line[:40].strip():
            continue
        label = line[:40].strip()
        kind = line[43:44]
        rest = line[44:].strip()
        if rest.startswith("N="):
            count = int(rest[2:])
            values: list[float] = []
            while len(values) < count and i < len(lines):
                values.extend(float(tok) for tok in lines[i].split())
                i += 1
            if kind == "I":
                records[label] = [int(v) for v in values[:count]]
            elif kind == "R":
                records[label] = values[:count]
            else:  # character arrays are not needed
                records[label] = values[:count]
        elif kind == "I":
            records[label] = int(float(rest))
        elif kind == "R":
            records[label] = float(rest)
        else:
            records[label] = rest
    return records


def _require(records: dict[str, Record], label: str) -> Record:
    if label not in records:
        msg = f"fchk is missing the '{label}' section"
        raise ValueError(msg)
    return records[label]


def _numbers(records: dict[str, Record], label: str) -> list[float]:
    value = _require(records, label)
    if not isinstance(value, list):
        msg = f"fchk section '{label}' is a scalar, expected an array"
        raise ValueError(msg)
    return [float(v) for v in value]


def _scalar(records: dict[str, Record], label: str, default: float) -> float:
    value = records.get(label, default)
    return float(value) if isinstance(value, int | float) else default


def read_fchk(path: Path) -> Wavefunction:
    """Read geometry, basis and molecular orbitals from a Gaussian formatted checkpoint."""
    records = parse_records(_open_text(path))
    numbers = [int(z) for z in _require(records, "Atomic numbers")]  # type: ignore[union-attr]
    coords = np.array(_require(records, "Current cartesian coordinates"), dtype=float).reshape(
        -1, 3
    )
    structure = Structure(
        name=path.stem,
        atoms=[
            Atom(element=chemical_symbols[z], position=(c[0] * Bohr, c[1] * Bohr, c[2] * Bohr))
            for z, c in zip(numbers, coords, strict=True)
        ],
        charge=_scalar(records, "Charge", 0.0),
        multiplicity=int(_scalar(records, "Multiplicity", 1.0)),
        provenance=Provenance(source=str(path), software="Gaussian fchk"),
    )

    shell_types = [int(t) for t in _numbers(records, "Shell types")]
    n_prim = [int(t) for t in _numbers(records, "Number of primitives per shell")]
    shell_atom = [int(t) for t in _numbers(records, "Shell to atom map")]
    exponents = np.array(_numbers(records, "Primitive exponents"), dtype=float)
    coefficients = np.array(_numbers(records, "Contraction coefficients"), dtype=float)
    raw_sp = records.get("P(S=P) Contraction coefficients", [])
    sp_coefficients = np.array(raw_sp if isinstance(raw_sp, list) else [], dtype=float)

    shells: list[Shell] = []
    offset = 0
    for shell_type, count, atom in zip(shell_types, n_prim, shell_atom, strict=True):
        exps = exponents[offset : offset + count]
        coefs = coefficients[offset : offset + count]
        if shell_type == -1:  # SP shell: an s shell and a p shell sharing exponents
            shells.append(Shell(atom - 1, 0, False, exps, coefs))
            shells.append(Shell(atom - 1, 1, False, exps, sp_coefficients[offset : offset + count]))
        else:
            shells.append(Shell(atom - 1, abs(shell_type), shell_type < 0, exps, coefs))
        offset += count

    n_basis = sum(s.size for s in shells)
    declared = int(_scalar(records, "Number of basis functions", float(n_basis)))
    if declared != n_basis:
        msg = f"basis size mismatch: fchk declares {declared}, shells give {n_basis}"
        raise ValueError(msg)

    n_alpha = int(_scalar(records, "Number of alpha electrons", 0.0))
    n_beta = int(_scalar(records, "Number of beta electrons", 0.0))
    orbitals = _read_orbitals(records, n_basis, n_alpha, n_beta)

    wavefunction = Wavefunction(
        structure=structure,
        shells=shells,
        orbitals=orbitals,
        source=str(path),
        n_electrons=_scalar(records, "Number of electrons", float(n_alpha + n_beta)),
        charge=_scalar(records, "Charge", 0.0),
        multiplicity=int(_scalar(records, "Multiplicity", 1.0)),
        metadata={"format": "fchk"},
    )
    wavefunction.validate()
    return wavefunction


def _read_orbitals(
    records: dict[str, Record], n_basis: int, n_alpha: int, n_beta: int
) -> list[MolecularOrbital]:
    alpha = np.array(_numbers(records, "Alpha MO coefficients"), dtype=float).reshape(-1, n_basis)
    raw_alpha_e = records.get("Alpha Orbital Energies", [])
    alpha_e = np.array(raw_alpha_e if isinstance(raw_alpha_e, list) else [], dtype=float)
    beta_raw = records.get("Beta MO coefficients")
    unrestricted = isinstance(beta_raw, list)
    beta = np.array(beta_raw, dtype=float).reshape(-1, n_basis) if unrestricted else None
    raw_beta_e = records.get("Beta Orbital Energies", [])
    beta_e = np.array(raw_beta_e if isinstance(raw_beta_e, list) else [], dtype=float)

    orbitals: list[MolecularOrbital] = []
    for i, row in enumerate(alpha):
        occupation = (1.0 if unrestricted else 2.0) if i < n_alpha else 0.0
        orbitals.append(
            MolecularOrbital(
                coefficients=row,
                energy=float(alpha_e[i]) if i < len(alpha_e) else None,
                occupation=occupation,
                spin="alpha" if unrestricted else "none",
            )
        )
    if beta is not None:
        for i, row in enumerate(beta):
            orbitals.append(
                MolecularOrbital(
                    coefficients=row,
                    energy=float(beta_e[i]) if i < len(beta_e) else None,
                    occupation=1.0 if i < n_beta else 0.0,
                    spin="beta",
                )
            )
    return orbitals


__all__ = ["parse_records", "read_fchk", "shell_size"]
