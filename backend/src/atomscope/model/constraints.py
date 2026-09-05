"""Geometric constraints, mirroring the ASE constraint classes that are JSON-safe."""

from __future__ import annotations

from collections.abc import Mapping
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
    value: float | None = Field(
        default=None, description="target length in A; None keeps the current one"
    )

    def referenced_atoms(self) -> list[int]:
        return [self.a, self.b]


class FixAngle(StrictModel):
    """Hold the a-b-c angle, b being the vertex (ASE ``FixInternals``)."""

    kind: Literal["fix_angle"] = "fix_angle"
    a: int
    b: int
    c: int
    value: float | None = Field(
        default=None, description="target angle in degrees; None keeps the current one"
    )

    def referenced_atoms(self) -> list[int]:
        return [self.a, self.b, self.c]


class FixDihedral(StrictModel):
    """Hold the a-b-c-d torsion (ASE ``FixInternals``)."""

    kind: Literal["fix_dihedral"] = "fix_dihedral"
    a: int
    b: int
    c: int
    d: int
    value: float | None = Field(
        default=None, description="target torsion in degrees; None keeps the current one"
    )

    def referenced_atoms(self) -> list[int]:
        return [self.a, self.b, self.c, self.d]


class IgnoreAtoms(StrictModel):
    """Leave these atoms out of the force field entirely (Avogadro's "Ignore Atom").

    Open Babel understands this; ASE has no equivalent, so an ASE-driven calculation ignores it.
    """

    kind: Literal["ignore_atoms"] = "ignore_atoms"
    indices: list[int]

    def referenced_atoms(self) -> list[int]:
        return list(self.indices)


Constraint = Annotated[
    FixAtoms | FixCartesian | FixBondLength | FixAngle | FixDihedral | IgnoreAtoms,
    Field(discriminator="kind"),
]

def remap(c: Constraint, new_index: Mapping[int, int]) -> Constraint | None:
    """``c`` after atoms were removed or renumbered, or None when it no longer applies.

    A constraint over a set of atoms (fixed, ignored) keeps those that remain; one that ties
    specific atoms together (a bond, an angle, a torsion) is dropped as soon as one is gone.
    """
    if isinstance(c, FixAtoms | IgnoreAtoms):
        kept = [new_index[i] for i in c.indices if i in new_index]
        if not kept:
            return None
        return type(c)(indices=kept)
    if any(i not in new_index for i in c.referenced_atoms()):
        return None
    return _remap_atoms(c, new_index)


def _remap_atoms(
    c: FixCartesian | FixBondLength | FixAngle | FixDihedral,
    new_index: Mapping[int, int],
) -> Constraint:
    """The same constraint on renumbered atoms; every atom it names is known to have survived."""
    if isinstance(c, FixCartesian):
        return FixCartesian(index=new_index[c.index], mask=c.mask)
    if isinstance(c, FixBondLength):
        return FixBondLength(a=new_index[c.a], b=new_index[c.b], value=c.value)
    if isinstance(c, FixAngle):
        return FixAngle(a=new_index[c.a], b=new_index[c.b], c=new_index[c.c], value=c.value)
    return FixDihedral(
        a=new_index[c.a],
        b=new_index[c.b],
        c=new_index[c.c],
        d=new_index[c.d],
        value=c.value,
    )


__all__ = [
    "Constraint",
    "FixAngle",
    "FixAtoms",
    "FixBondLength",
    "FixCartesian",
    "FixDihedral",
    "IgnoreAtoms",
    "remap",
]
