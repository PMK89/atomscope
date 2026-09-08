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

One ``ase.db`` rule shapes what a row can hold: it refuses a *string* key-value pair whose text
``bool``, ``int`` or ``float`` can parse, so that ``select(k='1')`` is never ambiguous with
``select(k=1)``. There is no escape hatch. That bites two ways here, and both are handled below
with ASE's own :func:`str_represents` rather than a guess at its rule:

* a numeric parameter that arrives as a string (``epwpsi='30'``) is stored as the number, which is
  what one would want to select on anyway;
* a calculation id is twelve hex characters, and some of those look numeric -- ``391313492996``
  parses as an int and ``31719629e335`` as a float. Both are real ids this went wrong on. The id
  is therefore always written to ``data``, where nothing type-checks it, and additionally as a
  key-value pair when ASE will take it, so that ``select(calculation_id=...)`` works for the ids
  it can.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from ase.calculators.singlepoint import SinglePointCalculator
from ase.db.core import (  # noqa: PLC2701 -- ASE's own rules, not a guess at them
    convert_str_to_int_float_bool_or_str,
    str_represents,
)

from atomscope.ase_bridge import to_atoms
from atomscope.ase_bridge.convert import INITIAL_MAGMOMS_PROPERTY as INITIAL_MAGMOMS

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


def as_kvp(value: str) -> Any:
    """``value`` as ``ase.db`` itself would read it: a number, a bool, or the string unchanged.

    ASE's own converter, not an ordering of our own -- ``bool`` subclasses ``int`` in Python, so
    asking "is this an int?" first answers yes for ``'True'``. The exact original is kept in
    ``data['values']`` regardless, so reading it as a number here loses nothing.
    """
    return convert_str_to_int_float_bool_or_str(value)  # type: ignore[no-untyped-call]


def scalar_values(values: dict[str, object]) -> dict[str, Any]:
    """The parameters ASE can index: bools, numbers and strings, under legal key names.

    A parameter whose value is a list or a nested dict (a k-point path, an orbital projection) is
    left to ``data``; there is nothing sensible to select on it with. A string that spells a
    number or a bool is stored as that value, both because ASE refuses such strings outright and
    because a cutoff is better selected on with ``epwpsi>30`` than with a string comparison.
    """
    reserved = _reserved()
    out: dict[str, Any] = {}
    for key, value in values.items():
        if key in reserved or not key.replace("_", "").isalnum() or key[0].isdigit():
            continue
        if isinstance(value, bool | int | float):
            out[key] = value
        elif isinstance(value, str) and value.strip():
            out[key] = as_kvp(value)
    return out


def _spread_charge(atoms: Atoms, structure: Structure) -> None:
    """Put the total charge where ``ase.db`` looks for it: the per-atom initial charges.

    ASE's ``charge`` column is their sum. Atomscope keeps a structure's total charge as a property
    of the whole structure -- the bridge puts it in ``atoms.info`` -- so without this a charged
    calculation indexes as ``charge=0`` and ``ase db ... 'charge=-1'`` finds nothing. Spreading it
    evenly is a statement about the total, not a claim about any one atom; a real per-atom
    assignment already present is left alone.
    """
    n = len(atoms)
    if n and structure.charge and not atoms.get_initial_charges().any():  # type: ignore[no-untyped-call]
        atoms.set_initial_charges([structure.charge / n] * n)  # type: ignore[no-untyped-call]


def total_moment(structure: Structure, values: dict[str, object]) -> float | None:
    """The total magnetic moment in Bohr magnetons, or None if the run said nothing about spin.

    ASE's ``magmom`` column is *not* the sum of the initial moments -- measured, it stays empty
    however they are set. It is the moment the calculator reported, so this is passed to the
    ``SinglePointCalculator`` instead. (``charge`` is the opposite: that one *is* the sum of the
    per-atom initial charges. The two columns do not work the same way.)

    For a spin-only moment the value in Bohr magnetons is the number of unpaired electrons, 2S.
    A multiplicity of 3 is two unpaired electrons; CP-PAW's ``total_spin`` is S in hbar (one
    unpaired electron = 0.5), so both reduce to the same number. Per-atom moments, when a run
    carries them, are summed instead.
    """
    magmoms = structure.atomic_scalars.get(INITIAL_MAGMOMS)
    if magmoms is not None and any(magmoms.values):
        return float(sum(magmoms.values))
    if structure.multiplicity and structure.multiplicity > 1:
        return float(structure.multiplicity - 1)
    spin = values.get("total_spin")
    if isinstance(spin, int | float) and not isinstance(spin, bool) and spin > 0:
        return 2.0 * float(spin)
    return None


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
        kvp: dict[str, Any] = dict(scalar_values(calc.values))
        # An identity has to come back exactly as it went in, so these are never converted to the
        # number they resemble -- they are simply left out of the key-value pairs when ASE will
        # not take them, and read back from `data`, which always carries them.
        identity: dict[str, str] = {
            "calculation_id": calc.id,
            "name": calc.name,
            "backend": calc.backend_id,
            "status": calc.status,
        }
        if calc.sweep is not None:
            identity["sweep"] = calc.sweep.label
            kvp["sweep_x"] = calc.sweep.x
        if calc.parent_calculation_id is not None:
            identity["parent"] = calc.parent_calculation_id
        for key, text in identity.items():
            if text and not any(
                str_represents(text, t)  # type: ignore[no-untyped-call]
                for t in (bool, int, float)
            ):
                kvp[key] = text

        data: dict[str, Any] = {"values": calc.values, "identity": identity}
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
        _spread_charge(atoms, structure)

        results: dict[str, Any] = {}
        moment = total_moment(structure, calc.values)
        if moment is not None:
            results["magmom"] = moment
        if calc.results is not None:
            energy = calc.results.properties.get("energy")
            if energy is not None:
                results["energy"] = float(energy.value)
            final = calc.results.final_structure
            if final is not None and "forces" in final.atomic_vectors:
                results["forces"] = final.atomic_vectors["forces"].values
        if results:
            atoms.calc = SinglePointCalculator(atoms, **results)  # type: ignore[no-untyped-call]
        return atoms
