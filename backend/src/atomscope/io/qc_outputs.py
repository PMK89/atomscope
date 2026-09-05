"""Import results from quantum-chemistry output files (Avogadro 1 "open a .log/.out" parity).

ASE readers (``gaussian-out``, ``orca-output``, ``nwchem-out``, ``espresso-out``, ``gamess-us-out``)
return one ``Atoms`` per geometry step with a SinglePointCalculator holding energy, forces, dipole
and charges where present. We turn the last frame into a Structure carrying those properties and
all frames into a Trajectory (optimization path). Vibrational data is not read by ASE; that is a
follow-up (dedicated parsers or cclib).
"""

from __future__ import annotations

from pathlib import Path

import ase.io
import numpy as np
from ase import Atoms

from atomscope.ase_bridge.convert import from_atoms
from atomscope.chem.bonds import perceive_bonds
from atomscope.model import (
    AtomicScalarProperty,
    AtomicVectorProperty,
    Frame,
    Provenance,
    Quantity,
    Structure,
    Trajectory,
    new_uid,
)
from atomscope.model.common import StrictModel
from atomscope.units import Unit

# extension -> ASE format
OUTPUT_FORMATS: dict[str, str] = {
    ".g03": "gaussian-out",
    ".g09": "gaussian-out",
    ".g16": "gaussian-out",
    ".log": "gaussian-out",
    ".out": "orca-output",
    ".orcaout": "orca-output",
    ".nwo": "nwchem-out",
    ".pwo": "espresso-out",
    ".gamout": "gamess-us-out",
}


class OutputImport(StrictModel):
    structure: Structure
    trajectory: Trajectory | None = None
    program_format: str
    n_frames: int


def detect_output_format(path: Path) -> str:
    fmt = OUTPUT_FORMATS.get(path.suffix.lower())
    if fmt is None:
        # sniff the first lines for program banners
        head = path.read_text(errors="replace")[:4000]
        if "Gaussian" in head and "Entering Gaussian System" in head:
            return "gaussian-out"
        if "O   R   C   A" in head:
            return "orca-output"
        if "Northwest Computational Chemistry Package" in head:
            return "nwchem-out"
        if "Program PWSCF" in head:
            return "espresso-out"
        msg = f"cannot determine the program that wrote {path.name}"
        raise ValueError(msg)
    return fmt


def _v3(v: object) -> tuple[float, float, float]:
    seq = list(v)  # type: ignore[call-overload]
    return (float(seq[0]), float(seq[1]), float(seq[2]))


def _attach_results(structure: Structure, atoms: Atoms) -> None:
    calc = atoms.calc
    if calc is None:
        return
    results = getattr(calc, "results", {})
    if "energy" in results:
        structure.properties["energy"] = Quantity(value=float(results["energy"]), unit=Unit.EV)
    if "forces" in results:
        structure.atomic_vectors["forces"] = AtomicVectorProperty(
            values=[_v3(f) for f in np.asarray(results["forces"])], unit=Unit.EV_PER_ANGSTROM
        )
    if "dipole" in results:
        d = np.asarray(results["dipole"], dtype=float)
        structure.properties["dipole_moment"] = Quantity(
            value=float(np.linalg.norm(d)), unit=Unit.E_ANGSTROM
        )
    if "charges" in results:
        structure.atomic_scalars["partial_charges"] = AtomicScalarProperty(
            values=[float(x) for x in results["charges"]], unit=Unit.ELEMENTARY_CHARGE
        )
    if "magmoms" in results:
        structure.atomic_scalars["magnetic_moments"] = AtomicScalarProperty(
            values=[float(x) for x in results["magmoms"]], unit=Unit.BOHR_MAGNETON
        )


def _drop_dummies(atoms: Atoms) -> Atoms:
    keep = [i for i, z in enumerate(atoms.numbers) if z > 0]
    if len(keep) == len(atoms):
        return atoms
    calc = atoms.calc
    sub = atoms[keep]
    if calc is not None:
        results = dict(getattr(calc, "results", {}))
        for key in ("forces", "charges", "magmoms"):
            if key in results:
                results[key] = np.asarray(results[key])[keep]
        from ase.calculators.singlepoint import SinglePointCalculator  # noqa: PLC0415

        sub.calc = SinglePointCalculator(sub, **results)
    return sub


def read_output(path: Path, fmt: str | None = None) -> OutputImport:
    program_format = fmt or detect_output_format(path)
    frames = ase.io.read(str(path), index=":", format=program_format)
    if not isinstance(frames, list):
        frames = [frames]
    # Gaussian z-matrix inputs can contain dummy atoms (symbol X, Z=0); drop them.
    frames = [_drop_dummies(a) for a in frames]
    frames = [a for a in frames if len(a) > 0]
    if not frames:
        msg = f"no geometry found in {path.name}"
        raise ValueError(msg)
    last = frames[-1]
    structure = from_atoms(last, name=path.stem)
    if structure.n_atoms > 1:
        structure.bonds = perceive_bonds(structure)
    _attach_results(structure, last)
    structure.provenance = Provenance(source=str(path), software=program_format)
    trajectory = None
    if len(frames) > 1:
        traj_frames = []
        for i, a in enumerate(frames):
            energy = None
            if a.calc is not None and "energy" in getattr(a.calc, "results", {}):
                energy = float(a.calc.results["energy"])
            traj_frames.append(
                Frame(positions=[_v3(p) for p in a.get_positions()], energy=energy, step=i)
            )
        trajectory = Trajectory(
            id=new_uid(),
            name=f"{path.stem} optimization",
            structure_id=structure.id,
            symbols=structure.symbols(),
            frames=traj_frames,
            kind="optimization",
        )
    return OutputImport(
        structure=structure,
        trajectory=trajectory,
        program_format=program_format,
        n_frames=len(frames),
    )
