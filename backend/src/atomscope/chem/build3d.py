"""Rough 3D geometry for a structure that has none (Avogadro 1's "build a rough geometry").

A file drawn in two dimensions -- a molfile from a sketcher, a database's 2D record -- carries a
connection table and flat coordinates. Avogadro asked on load whether to build a geometry, and
built it with Open Babel: ``OBBuilder::Build``, add hydrogens, then MMFF94 (UFF if the molecule
has no MMFF types) for 250 conjugate-gradient steps (mainwindow.cpp:1164-1178). The same path is
taken here, so the result is the geometry the reference program produced.

``OBBuilder`` repositions the atoms it was given and appends hydrogens after them, so the atom
indices the user can see -- and the selection, the constraints and the residues that name them --
survive. Cis/trans survives too, because a drawing carries it in the coordinates. What cannot
survive is wedge/hash stereochemistry: the data model stores bonds and positions, not parities,
so a flat drawing of one enantiomer builds whichever the builder prefers. That is true of
anything built after import, and the note in the parity matrix says so.

Whether a structure needs this is decided where the file is opened (frontend ui/buildGeometry.ts):
the readers do not agree on how to report a dimension, so the answer is read off the coordinates.
"""

from __future__ import annotations

from openbabel import openbabel as ob

from atomscope.chem.forcefield import ForceFieldError, optimize
from atomscope.chem.obmol import OB_LOCK, from_obmol, to_obmol
from atomscope.model import Structure

BUILD_FORCE_FIELDS = ("MMFF94", "UFF")
BUILD_STEPS = 250
BUILD_CONVERGENCE = 1e-4


def generate_3d(structure: Structure, *, add_hydrogens: bool = True) -> Structure:
    """Build coordinates for ``structure`` and clean them up with a force field.

    Raises ``ValueError`` when there is nothing to build from: the builder walks bonds, so a
    structure without them would be scattered rather than built.
    """
    if structure.n_atoms == 0:
        msg = "cannot build a geometry for a structure without atoms"
        raise ValueError(msg)
    if not structure.bonds:
        msg = "cannot build a geometry without bonds: perceive bonds first"
        raise ValueError(msg)
    with OB_LOCK:
        mol = to_obmol(structure, implicit_hydrogens=True)
        # A drawing carries its double-bond stereochemistry in the coordinates: the two ends of
        # a cis bond are drawn on the same side. Open Babel reads that from a 2D molecule, but
        # only when it is asked to -- a molecule assembled atom by atom, as this one is, has no
        # stereo data until StereoFrom2D perceives it, and without it every double bond comes out
        # trans. (to_obmol marks every molecule 3D because everything else here is.)
        mol.SetDimension(2)
        ob.StereoFrom2D(mol)
        if not ob.OBBuilder().Build(mol):
            msg = f"Open Babel could not build a geometry for {structure.formula()}"
            raise ValueError(msg)
        mol.SetDimension(3)
        if add_hydrogens:
            mol.AddHydrogens()
        built = from_obmol(mol, structure)

    for name in BUILD_FORCE_FIELDS:
        try:
            return optimize(
                built,
                name,
                algorithm="conjugate_gradients",
                max_steps=BUILD_STEPS,
                convergence=BUILD_CONVERGENCE,
            ).structure
        except ForceFieldError:
            continue
    # no force field types the molecule: the builder's own geometry is still a geometry
    return built
