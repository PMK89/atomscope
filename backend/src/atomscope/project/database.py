"""An ASE database alongside the project, so finished calculations can be selected by chemistry.

A project stores calculations as directories, which is right for the files but wrong for the
question "which of these did I run on iron, spin-polarized, at a 30 Ry cutoff?". ASE already has
an answer to that -- ``ase.db`` and its selection language -- and it is the one the historical
CP-PAW/ASE workflow uses, so this is a sidecar index over the project rather than a new store:
``atomscope.db`` in the project root, one row per completed calculation, rebuildable at any time
from the directories, which stay the source of truth.

What a row is: the final structure as an ASE ``Atoms`` (so ``db.select('Fe')``, ``natoms``,
``formula``, ``charge`` and ``magmom`` all work as they do anywhere in ASE), the total energy on a
``SinglePointCalculator`` (so ``db.select('energy<-500')`` works), and the calculation's own
parameters as key-value pairs (so ``db.select(epwpsi=30)`` works). The full results dictionary
goes in ``data``, which ASE does not index but does carry.

Selection strings are passed to ASE untouched. Its syntax is the user-facing query language here
and reimplementing it would only be a worse version of it.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from ase.calculators.singlepoint import SinglePointCalculator

from atomscope.ase_bridge import to_atoms

if TYPE_CHECKING:  # pragma: no cover
    from ase import Atoms

    from atomscope.calculations.models import Calculation
    from atomscope.model import Structure

DB_NAME = "atomscope.db"


def _reserved() -> frozenset[str]:
    """ASE's own list of names it keeps for itself, rather than a hand-written guess at it.

    It is 150-odd names covering the columns ASE indexes (``energy``, ``charge``, ``magmom``,
    ``natoms``), the calculator's own metadata (``calculator``, ``calculator_parameters``) and
    every property a calculator can report. Writing one as a key-value pair raises ``Bad key``.
    """
    from ase.db.core import reserved_keys  # noqa: PLC0415

    return frozenset(reserved_keys)


def scalar_values(values: dict[str, object]) -> dict[str, Any]:
    """The parameters ASE can index: bools, numbers and non-empty strings, under legal key names.

    A parameter whose value is a list or a nested dict (a k-point path, an orbital projection) is
    left to ``data``; there is nothing sensible to select on it with.
    """
    reserved = _reserved()
    out: dict[str, Any] = {}
    for key, value in values.items():
        if key in reserved or not key.replace("_", "").isalnum() or key[0].isdigit():
            continue
        if isinstance(value, bool | int | float):
            out[key] = value
        elif isinstance(value, str) and value.strip():
            out[key] = value
    return out


class ProjectDatabase:
    """The project's ``atomscope.db``, opened lazily so a project without one is not given one."""

    def __init__(self, root: Path) -> None:
        self.path = root / DB_NAME

    def connect(self) -> Any:
        import ase.db  # noqa: PLC0415 -- importing ase.db costs ~0.2 s, and most calls never do

        return ase.db.connect(self.path)  # type: ignore[no-untyped-call]

    def row_for(self, calculation_id: str) -> int | None:
        """The row id standing for a calculation, if it has one."""
        if not self.path.exists():
            return None
        with self.connect() as db:
            for row in db.select(calculation_id=calculation_id):
                return int(row.id)
        return None

    def write(self, calc: Calculation, structure: Structure) -> int:
        """Index one calculation, replacing the row it already has.

        Replace rather than update: a re-collected calculation can have *fewer* keys than before
        (a parameter dropped, a property that no longer parses), and ASE's update merges, so an
        updated row would keep stale keys and quietly answer a query with them.
        """
        atoms = self._atoms(calc, structure)
        kvp: dict[str, Any] = {
            "calculation_id": calc.id,
            "name": calc.name,
            "backend": calc.backend_id,
            "status": calc.status,
            **scalar_values(calc.values),
        }
        if calc.sweep is not None:
            kvp["sweep"] = calc.sweep.label
            kvp["sweep_x"] = calc.sweep.x
        if calc.parent_calculation_id is not None:
            kvp["parent"] = calc.parent_calculation_id

        data: dict[str, Any] = {"values": calc.values}
        if calc.results is not None:
            data["properties"] = {
                name: {"value": q.value, "unit": str(q.unit)}
                for name, q in calc.results.properties.items()
            }
            data["warnings"] = list(calc.results.warnings)
            # every property, not only the ones ASE indexes, so a query can be followed by a read
            for name, q in calc.results.properties.items():
                if name != "energy" and isinstance(q.value, int | float):
                    kvp.setdefault(name, q.value)

        existing = self.row_for(calc.id)
        with self.connect() as db:
            if existing is not None:
                del db[existing]
            return int(db.write(atoms, key_value_pairs=kvp, data=data))

    def forget(self, calculation_id: str) -> None:
        row = self.row_for(calculation_id)
        if row is None:
            return
        with self.connect() as db:
            del db[row]

    def _atoms(self, calc: Calculation, structure: Structure) -> Atoms:
        atoms = to_atoms(structure)
        if calc.results is None:
            return atoms
        energy = calc.results.properties.get("energy")
        forces = None
        final = calc.results.final_structure
        if final is not None and "forces" in final.atomic_vectors:
            forces = final.atomic_vectors["forces"].values
        if energy is None and forces is None:
            return atoms
        atoms.calc = SinglePointCalculator(  # type: ignore[no-untyped-call]
            atoms,
            **({} if energy is None else {"energy": float(energy.value)}),
            **({} if forces is None else {"forces": forces}),
        )
        return atoms
