"""Geometric constraints, mirroring the ASE constraint classes that are JSON-safe."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

from atomscope.model.common import StrictModel


class FixAtoms(StrictModel):
    kind: Literal["fix_atoms"] = "fix_atoms"
    indices: list[int]

    def referenced_atoms(self) -> list[int]:
        return list(self.indices)


class FixCartesian(StrictModel):
    """Fix selected Cartesian components (mask True = fixed) of one atom."""

    kind: Literal["fix_cartesian"] = "fix_cartesian"
    index: int
    mask: tuple[bool, bool, bool] = (True, True, True)

    def referenced_atoms(self) -> list[int]:
        return [self.index]


class FixBondLength(StrictModel):
    kind: Literal["fix_bond_length"] = "fix_bond_length"
    a: int
    b: int

    def referenced_atoms(self) -> list[int]:
        return [self.a, self.b]


Constraint = Annotated[FixAtoms | FixCartesian | FixBondLength, Field(discriminator="kind")]

__all__ = ["Constraint", "FixAtoms", "FixBondLength", "FixCartesian"]
