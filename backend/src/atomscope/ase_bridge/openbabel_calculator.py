"""ASE calculator backed by an Open Babel force field (energy in eV, forces in eV/Å).

Bonds are taken from ``atoms.info["atomscope"]`` when the Atoms came from :func:`to_atoms`;
otherwise they are perceived once (distance criterion + bond orders) and reused for the lifetime
of the calculator, so a geometry optimization keeps a consistent topology.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from ase import Atoms
from ase.calculators.calculator import Calculator, all_changes

from atomscope.ase_bridge.convert import from_atoms
from atomscope.chem.forcefield import single_point
from atomscope.chem.hydrogens import perceive_bonds
from atomscope.model import Bond


class OpenBabelCalculator(Calculator):
    implemented_properties = ["energy", "forces"]  # noqa: RUF012 - ASE convention

    def __init__(self, force_field: str = "MMFF94", **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.force_field = force_field
        self._bonds: list[Bond] | None = None
        self._topology_key: tuple[str, ...] | None = None

    def calculate(
        self,
        atoms: Atoms | None = None,
        properties: list[str] | None = None,
        system_changes: list[str] = all_changes,
    ) -> None:
        super().calculate(atoms, properties or ["energy"], system_changes)
        assert self.atoms is not None
        structure = from_atoms(self.atoms)
        key = tuple(structure.symbols())
        if structure.bonds:
            self._bonds, self._topology_key = structure.bonds, key
        elif self._bonds is None or self._topology_key != key:
            self._bonds, self._topology_key = perceive_bonds(structure).bonds, key
        structure.bonds = self._bonds
        res = single_point(structure, self.force_field)
        self.results = {"energy": res.energy.value, "forces": np.array(res.forces, dtype=float)}
