"""Subprocess entry point: ``python -m atomscope.backends.ase_builtin.runner input.json workdir``.

Reads the generated input, runs the requested ASE task, streams progress lines to
``progress.log`` (tailed by the JobManager) and writes ``results.json`` (a ResultBundle).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
from ase import Atoms, units
from ase.calculators.emt import EMT
from ase.calculators.lj import LennardJones
from ase.calculators.morse import MorsePotential
from ase.md.langevin import Langevin
from ase.md.velocitydistribution import MaxwellBoltzmannDistribution
from ase.optimize import BFGS, FIRE, LBFGS

from atomscope.ase_bridge import from_atoms, to_atoms
from atomscope.backends.base import ResultBundle, ScalarSeries
from atomscope.model import AtomicVectorProperty, Frame, Quantity, Structure, Trajectory
from atomscope.units import Unit

Vec3 = tuple[float, float, float]


def _v3(v: Any) -> Vec3:
    return (float(v[0]), float(v[1]), float(v[2]))


def make_calculator(p: dict[str, Any], work: Path) -> Any:
    match p["calculator"]:
        case "emt":
            return EMT()
        case "lj":
            return LennardJones(epsilon=p["lj_epsilon"], sigma=p["lj_sigma"], rc=p["lj_rc"])
        case "morse":
            return MorsePotential()
        case "openbabel":
            from atomscope.ase_bridge.openbabel_calculator import (  # noqa: PLC0415
                OpenBabelCalculator,
            )

            return OpenBabelCalculator(force_field=p.get("ob_force_field", "MMFF94"))
        case "cppaw":
            from atomscope.ase_bridge.cppaw_calculator import CppawCalculator  # noqa: PLC0415

            return CppawCalculator(
                work / "cppaw",
                values={
                    "epwpsi": p.get("cppaw_epwpsi", 30.0),
                    "nstep": p.get("cppaw_nstep", 400),
                    "kpoint_r": p.get("cppaw_kpoint_r", 12.0),
                    "empty_bands": p.get("cppaw_empty_bands", 4),
                    "spin_polarized": p.get("cppaw_spin_polarized", False),
                    "box_margin": p.get("cppaw_box_margin", 4.0),
                },
                keep_history=False,
            )
    msg = f"unknown calculator {p['calculator']}"
    raise ValueError(msg)


def snapshot(atoms: Atoms, energy: float, step: int, time_fs: float | None = None) -> Frame:
    forces = atoms.get_forces()
    return Frame(
        positions=[_v3(r) for r in atoms.get_positions()],
        cell=(_v3(atoms.cell[0]), _v3(atoms.cell[1]), _v3(atoms.cell[2]))
        if atoms.cell.rank > 0
        else None,
        energy=float(energy),
        forces=[_v3(f) for f in forces],
        step=step,
        time=time_fs,
        temperature=float(atoms.get_temperature()) if time_fs is not None else None,
    )


def main(argv: list[str]) -> int:  # noqa: PLR0915
    input_path = Path(argv[1])
    work = Path(argv[2])
    payload = json.loads(input_path.read_text())
    structure = Structure.model_validate(payload["structure"])
    p = payload["parameters"]
    atoms = to_atoms(structure)
    atoms.calc = make_calculator(p, work)
    log = (work / "progress.log").open("w", buffering=1)
    traj = Trajectory(
        id="traj",
        name=p["task"],
        structure_id=structure.id,
        symbols=structure.symbols(),
        kind=p["task"],
    )
    converged: bool | None = None

    e0 = float(atoms.get_potential_energy())
    print(f"initial energy {e0:.6f} eV", file=log)
    traj.frames.append(snapshot(atoms, e0, 0))

    if p["task"] == "relax":
        traj.kind = "optimization"
        opt_cls = {"bfgs": BFGS, "lbfgs": LBFGS, "fire": FIRE}[p.get("optimizer", "bfgs")]
        opt = opt_cls(atoms, logfile=None)
        step = 0

        def record() -> None:
            nonlocal step
            step += 1
            e = float(atoms.get_potential_energy())
            fmax = float(np.sqrt((atoms.get_forces() ** 2).sum(axis=1).max()))
            print(f"step {step} energy {e:.6f} eV fmax {fmax:.4f} eV/A", file=log)
            traj.frames.append(snapshot(atoms, e, step))

        opt.attach(record)
        converged = bool(opt.run(fmax=p["fmax"], steps=p["max_steps"]))
    elif p["task"] == "md":
        traj.kind = "md"
        rng = np.random.default_rng(p["seed"])
        MaxwellBoltzmannDistribution(atoms, temperature_K=p["temperature"], rng=rng)
        dyn = Langevin(
            atoms,
            p["timestep"] * units.fs,
            temperature_K=p["temperature"],
            friction=p["friction"] / units.fs,
            rng=rng,
        )
        step = 0

        def record_md() -> None:
            nonlocal step
            step += 1
            e = float(atoms.get_potential_energy())
            t = step * p["timestep"]
            print(
                f"step {step} t {t:.1f} fs epot {e:.6f} eV T {atoms.get_temperature():.1f} K",
                file=log,
            )
            traj.frames.append(snapshot(atoms, e, step, time_fs=t))

        dyn.attach(record_md)
        dyn.run(p["max_steps"])
        converged = None

    energy = float(atoms.get_potential_energy())
    final = from_atoms(atoms)
    final.id = structure.id
    final.name = structure.name
    final.bonds = structure.bonds
    final.atomic_vectors["forces"] = AtomicVectorProperty(
        values=[_v3(f) for f in atoms.get_forces()],
        unit=Unit.EV_PER_ANGSTROM,
        description="forces",
    )
    props = {"energy": Quantity(value=energy, unit=Unit.EV)}
    if structure.is_periodic():
        try:
            stress = atoms.get_stress(voigt=True)
            props["pressure"] = Quantity(value=float(-stress[:3].mean()), unit=Unit.EV)  # eV/Å^3
        except Exception as exc:  # noqa: BLE001
            print(f"stress unavailable: {exc}", file=log)
    series = [
        ScalarSeries(
            name="energy",
            x_label="step",
            y_label="potential energy",
            y_unit="eV",
            x=[float(f.step or 0) for f in traj.frames],
            y=[float(f.energy or 0.0) for f in traj.frames],
        )
    ]
    bundle = ResultBundle(
        final_structure=final, properties=props, trajectory=traj, series=series, converged=converged
    )
    (work / "results.json").write_text(bundle.model_dump_json(indent=2))
    print(f"final energy {energy:.6f} eV", file=log)
    log.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
