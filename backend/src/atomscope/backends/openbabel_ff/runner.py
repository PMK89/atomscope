"""Subprocess entry point: ``python -m atomscope.backends.openbabel_ff.runner input.json workdir``.

Runs the requested force-field task, appends progress lines to ``progress.log`` and writes
``results.json`` (a ResultBundle).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from atomscope.backends.base import ResultBundle, ScalarSeries
from atomscope.backends.openbabel_ff.plugin import parse_constraints
from atomscope.chem import forcefield as ffm
from atomscope.model import Quantity, Structure, Trajectory
from atomscope.units import Unit


def _energy_series(traj: Trajectory, x_label: str) -> ScalarSeries:
    return ScalarSeries(
        name="energy",
        x_label=x_label,
        y_label="potential energy",
        y_unit="eV",
        x=[float(f.step if f.step is not None else i) for i, f in enumerate(traj.frames)],
        y=[float(f.energy or 0.0) for f in traj.frames],
    )


def run(structure: Structure, p: dict[str, Any], log: Any) -> ResultBundle:
    ff = p["force_field"]
    constraints = parse_constraints(p.get("constraints_json"))
    native = ffm.single_point(structure, ff, constraints)
    e0 = native.energy.value
    print(
        f"{ff}: initial energy {e0:.6f} eV "
        f"({native.energy_native.value:.4f} {native.energy_native.unit})",
        file=log,
    )
    props: dict[str, Quantity] = {}
    unit_native = native.energy_native.unit
    factor = native.energy_native.value / e0 if e0 else 1.0

    if p["task"] == "single_point":
        final = structure.model_copy()
        final.properties = {**final.properties, "energy": native.energy}
        from atomscope.model import AtomicVectorProperty  # noqa: PLC0415

        final.atomic_vectors = {
            **final.atomic_vectors,
            "forces": AtomicVectorProperty(values=native.forces, unit=Unit.EV_PER_ANGSTROM),
        }
        props = {"energy": native.energy, "energy_native": native.energy_native}
        for k, v in native.terms.items():
            props[f"E_{k}"] = Quantity(value=v, unit=Unit.EV)
        return ResultBundle(final_structure=final, properties=props, converged=True)

    if p["task"] == "optimize":
        res = ffm.optimize(
            structure,
            ff,
            algorithm=p["algorithm"],
            max_steps=int(p["max_steps"]),
            convergence=float(p["convergence"]),
            constraints=constraints,
            record_every=int(p.get("record_every", 10)),
        )
        assert res.trajectory is not None
        for f in res.trajectory.frames:
            print(f"step {f.step} energy {f.energy:.6f} eV", file=log)
        print(
            f"{'converged' if res.converged else 'not converged'} after {res.steps} steps, "
            f"final energy {res.energy.value:.6f} eV",
            file=log,
        )
        props = {
            "energy": res.energy,
            "energy_native": Quantity(value=res.energy.value * factor, unit=unit_native),
        }
        return ResultBundle(
            final_structure=res.structure,
            properties=props,
            trajectory=res.trajectory,
            series=[_energy_series(res.trajectory, "step")],
            converged=res.converged,
        )

    res2 = ffm.conformer_search(
        structure,
        ff,
        method=p["conformer_method"],
        n_conformers=int(p["n_conformers"]),
        steps=int(p["conformer_steps"]),
        constraints=constraints,
    )
    for i, f in enumerate(res2.trajectory.frames):
        print(f"conformer {i} energy {f.energy:.6f} eV", file=log)
    energy = res2.structure.properties.get("energy")
    props = {"energy": energy} if energy is not None else {}
    return ResultBundle(
        final_structure=res2.structure,
        properties=props,
        trajectory=res2.trajectory,
        series=[_energy_series(res2.trajectory, "conformer")],
        converged=None,
    )


def main(argv: list[str]) -> int:
    payload = json.loads(Path(argv[1]).read_text())
    work = Path(argv[2])
    structure = Structure.model_validate(payload["structure"])
    with (work / "progress.log").open("w", buffering=1) as log:
        try:
            bundle = run(structure, payload["parameters"], log)
        except ffm.ForceFieldError as exc:
            print(f"error: {exc}", file=log)
            print(str(exc), file=sys.stderr)
            return 1
        (work / "results.json").write_text(bundle.model_dump_json(indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
