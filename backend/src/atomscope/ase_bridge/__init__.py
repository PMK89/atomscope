"""Bridge between the Atomscope data model and ASE (``ase.Atoms``, calculators, workflows)."""

from atomscope.ase_bridge.convert import from_atoms, to_atoms

__all__ = ["from_atoms", "to_atoms"]
