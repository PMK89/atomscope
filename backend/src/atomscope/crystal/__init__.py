"""Crystallography: cell operations, spglib symmetry, builders and the bundled CIF library.

All operations are pure functions ``Structure -> Structure`` (or ``-> SymmetryInfo``).
"""

from atomscope.crystal.build import bulk, from_spacegroup, slab, supercell
from atomscope.crystal.cell import (
    CoordinateMode,
    LatticeType,
    add_cell,
    cell_from_parameters,
    fractional_coordinates,
    lattice_type_from_parameters,
    lattice_type_from_spacegroup,
    remove_cell,
    rotate_to_standard_orientation,
    scale_to_volume,
    set_cell,
    set_fractional_coordinates,
    translate_atoms,
    wrap_atoms,
)
from atomscope.crystal.library import LibraryEntry, library_entries, load_entry
from atomscope.crystal.symmetry import (
    SpacegroupSetting,
    SymmetryInfo,
    asymmetric_unit,
    fill_unit_cell,
    niggli_reduce,
    perceive_symmetry,
    primitive_cell,
    primitive_standardized,
    spacegroup_settings,
    symmetrize,
)

__all__ = [
    "CoordinateMode",
    "LatticeType",
    "LibraryEntry",
    "SpacegroupSetting",
    "SymmetryInfo",
    "add_cell",
    "asymmetric_unit",
    "bulk",
    "cell_from_parameters",
    "fill_unit_cell",
    "fractional_coordinates",
    "from_spacegroup",
    "lattice_type_from_parameters",
    "lattice_type_from_spacegroup",
    "library_entries",
    "load_entry",
    "niggli_reduce",
    "perceive_symmetry",
    "primitive_cell",
    "primitive_standardized",
    "remove_cell",
    "rotate_to_standard_orientation",
    "scale_to_volume",
    "set_cell",
    "set_fractional_coordinates",
    "slab",
    "supercell",
    "spacegroup_settings",
    "symmetrize",
    "translate_atoms",
    "wrap_atoms",
]
