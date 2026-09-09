"""Build `.scratch/neb-proj`, the two endpoints `frontend/e2e/neb.spec.ts` needs.

Usage (from `backend/`):

    ../.venv/bin/python ../scripts/make_neb_project.py

The system is ASE's own NEB tutorial: a gold atom hopping between two neighbouring hollow sites
on Al(100), with EMT. Its barrier is documented as about 0.40 eV, which is what makes the e2e
test a check on the number and not just on the panel. Both ends are relaxed here, exactly as the
tutorial relaxes them, so the band the application draws starts from real minima.

The spec *skips* when the project is missing rather than failing, so without this script a lost
scratch directory turns into a test that silently stops testing. Re-run it and the spec runs
again.
"""

from __future__ import annotations

from pathlib import Path

from ase import Atoms
from ase.build import add_adsorbate, fcc100
from ase.calculators.emt import EMT
from ase.constraints import FixAtoms
from ase.optimize import QuasiNewton

from atomscope.ase_bridge import from_atoms
from atomscope.project import ProjectStore

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / ".scratch" / "neb-proj"


def endpoint(shift: bool) -> Atoms:
    """One end of the hop: ASE's tutorial slab, with the adsorbate moved for the far end."""
    slab = fcc100("Al", size=(2, 2, 3))
    add_adsorbate(slab, "Au", 1.7, "hollow")
    slab.center(axis=2, vacuum=4.0)
    # everything but the top layer is held, as in the tutorial: a free slab would relax the
    # surface instead of the hop, and the two ends would no longer share their Al positions
    slab.set_constraint(FixAtoms(mask=[atom.tag > 1 for atom in slab]))
    if shift:
        slab[-1].x += slab.get_cell()[0, 0] / 2
    slab.calc = EMT()
    QuasiNewton(slab, logfile=None).run(fmax=0.05)
    return slab


def main() -> None:
    store = (
        ProjectStore.open(PROJECT)
        if (PROJECT / "project.json").exists()
        else ProjectStore.create(PROJECT, "NEB endpoints")
    )
    for name, shift in (("Au hollow site A", False), ("Au hollow site B", True)):
        # Re-runnable: a structure gets a fresh id every time, so without this the project ends up
        # with two of each name and the spec's `selectOption({label})` matches two elements.
        for old in store.list_structures():
            if old.name == name:
                store.delete_structure(old.id)
        structure = from_atoms(endpoint(shift))
        structure.name = name
        store.save_structure(structure)
        print(f"{name}: {structure.formula()} -> {store.structure_path(structure.id)}")


if __name__ == "__main__":
    main()
