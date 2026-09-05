"""Data model for a molecular wavefunction expanded in contracted Gaussian-type orbitals.

This is the input Avogadro 1 reads through OpenQube (Gaussian fchk, Molden, ...) to generate
molecular-orbital and electron-density cubes. The model deliberately keeps the raw shell data so
that the evaluator can reproduce the conventions of the producing program.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from atomscope.model import Structure

# angular momentum letters, index == l
SHELL_LETTERS = "SPDFGHI"


# Number of basis functions per shell.
def shell_size(angular_momentum: int, pure: bool) -> int:
    """Functions in a shell: 2l+1 for solid harmonics, (l+1)(l+2)/2 for Cartesian."""
    if pure:
        return 2 * angular_momentum + 1
    return (angular_momentum + 1) * (angular_momentum + 2) // 2


@dataclass(frozen=True)
class Shell:
    """One contracted shell: primitives sharing a centre and angular momentum.

    ``coefficients`` are the contraction coefficients as written by the producing program, i.e.
    for primitives normalized in the usual quantum-chemistry convention (see ``gto.py``).
    """

    atom_index: int
    angular_momentum: int
    pure: bool
    exponents: np.ndarray
    coefficients: np.ndarray

    def __post_init__(self) -> None:
        if self.exponents.shape != self.coefficients.shape:
            msg = "exponents and coefficients must have the same length"
            raise ValueError(msg)
        if self.angular_momentum < 0:
            msg = "angular momentum must be non-negative (SP shells are split on read)"
            raise ValueError(msg)

    @property
    def size(self) -> int:
        return shell_size(self.angular_momentum, self.pure)

    @property
    def letter(self) -> str:
        return SHELL_LETTERS[self.angular_momentum]


@dataclass
class MolecularOrbital:
    """One orbital: expansion coefficients over the basis, plus its bookkeeping."""

    coefficients: np.ndarray
    energy: float | None = None
    occupation: float = 0.0
    spin: str = "none"  # none | alpha | beta
    label: str = ""


@dataclass
class Wavefunction:
    """Geometry, basis and orbitals of a converged calculation."""

    structure: Structure
    shells: list[Shell]
    orbitals: list[MolecularOrbital]
    source: str = ""
    n_electrons: float = 0.0
    charge: float = 0.0
    multiplicity: int = 1
    metadata: dict[str, str] = field(default_factory=dict)

    @property
    def n_basis(self) -> int:
        return sum(s.size for s in self.shells)

    def validate(self) -> None:
        n = self.n_basis
        for i, mo in enumerate(self.orbitals):
            if mo.coefficients.shape != (n,):
                msg = f"orbital {i} has {mo.coefficients.shape} coefficients, expected ({n},)"
                raise ValueError(msg)
        for shell in self.shells:
            if not 0 <= shell.atom_index < self.structure.n_atoms:
                msg = f"shell references atom {shell.atom_index} outside the structure"
                raise ValueError(msg)

    def homo_index(self, spin: str = "none") -> int | None:
        """Index of the highest occupied orbital of a spin channel, or None."""
        candidates = [
            i
            for i, mo in enumerate(self.orbitals)
            if mo.occupation > 0 and (spin == "none" or mo.spin in (spin, "none"))
        ]
        return candidates[-1] if candidates else None
