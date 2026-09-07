# ruff: noqa: E501, PLR0912, PLR0915, S603
"""Collect a CP-PAW work directory into a ResultBundle (energies, forces, geometry,
trajectory, grids, convergence series). Units are converted here, once."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from ase.units import Bohr, Hartree

from atomscope.backends.base import ResultBundle, ScalarSeries
from atomscope.backends.cppaw.protocol import ProtocolData, parse_protocol
from atomscope.backends.cppaw.strc import read_strc_geometry
from atomscope.backends.cppaw.tra import read_position_trajectory
from atomscope.model import (
    AtomicVectorProperty,
    Cell,
    Frame,
    Provenance,
    Quantity,
    Structure,
    Trajectory,
    VolumetricGrid,
    new_uid,
)
from atomscope.model.grid import GridKind
from atomscope.parsers.cube import CubeData, centre_on, grid_period, read_cube, write_cube
from atomscope.units import Unit

MH_PER_BOHR_TO_EV_PER_ANG = 1e-3 * Hartree / Bohr
Vec3 = tuple[float, float, float]


def _v3(v: object) -> Vec3:
    seq = list(v)  # type: ignore[call-overload]
    return (float(seq[0]), float(seq[1]), float(seq[2]))


def _mat3(m: object) -> tuple[Vec3, Vec3, Vec3]:
    rows = list(m)  # type: ignore[call-overload]
    return (_v3(rows[0]), _v3(rows[1]), _v3(rows[2]))


def split_runs(text: str) -> list[str]:
    """CP-PAW appends to .prot; split the protocol into individual runs."""
    marker = "PROGRAM STARTED"
    parts = text.split(marker)
    if len(parts) <= 1:
        return [text]
    return [marker + p for p in parts[1:]]


def last_run(text: str) -> str:
    """Keep only the last run (from the last PROGRAM STARTED)."""
    return split_runs(text)[-1]


def collect(
    work: Path,
    root: str,
    structure: Structure,
    *,
    expect_forces: bool,
    analysis: list[tuple[str, str]],
    forces_at_input_geometry: bool = False,
) -> ResultBundle:  # noqa: PLR0912, PLR0915
    bundle = ResultBundle()
    prot_path = work / f"{root}.prot"
    if not prot_path.is_file():
        bundle.warnings.append(f"{root}.prot not found")
        return bundle
    runs = split_runs(prot_path.read_text(errors="replace"))
    text = runs[-1]
    prot: ProtocolData = parse_protocol_text_cached(text)
    finished = "PROGRAM FINISHED" in text
    bundle.complete = finished
    if not finished:
        bundle.warnings.append("protocol does not contain PROGRAM FINISHED (run incomplete)")
    if prot.error_lines:
        bundle.warnings.extend(prot.error_lines[:5])
    # Electronic convergence is judged on the wave-function optimization run: the previous run
    # for the two-stage 'forces' task, otherwise the last one.
    electron_run = runs[-2] if forces_at_input_geometry and len(runs) >= 2 else text
    autopilot = "STOP SIGNAL FROM AUTOPILOT" in electron_run
    bundle.converged = autopilot if finished else False
    if finished and not autopilot:
        bundle.warnings.append(
            "wave functions did not reach the autopilot convergence criterion within NSTEP; "
            "energies and forces may be unconverged"
        )

    if prot.final_energy_h is not None:
        bundle.properties["energy"] = Quantity(value=prot.final_energy_h * Hartree, unit=Unit.EV)
    if prot.absolute_gap_ev is not None:
        bundle.properties["band_gap"] = Quantity(value=prot.absolute_gap_ev, unit=Unit.EV)
    if prot.direct_gap_ev is not None:
        bundle.properties["direct_gap"] = Quantity(value=prot.direct_gap_ev, unit=Unit.EV)
    # How large the basis actually was. A cutoff or a cell size means nothing on its own, which
    # is why the tutorial's convergence tables ask for these beside every energy.
    if prot.plane_waves_wavefunction is not None:
        bundle.properties["plane_waves_wavefunction"] = Quantity(
            value=float(prot.plane_waves_wavefunction), unit=Unit.DIMENSIONLESS
        )
    if prot.plane_waves_density is not None:
        bundle.properties["plane_waves_density"] = Quantity(
            value=float(prot.plane_waves_density), unit=Unit.DIMENSIONLESS
        )
    if prot.energy_reports:
        for name, val in prot.energy_reports[-1].terms_h.items():
            bundle.extra[f"energy_term:{name}"] = val * Hartree

    # final structure: strc_out positions (fallback: last ATOMLIST), same topology as input
    final = structure.model_copy(deep=True)
    final.id = new_uid()
    strc_out = work / f"{root}.strc_out"
    positions = None
    cell = None
    if strc_out.is_file():
        try:
            geo = read_strc_geometry(strc_out.read_text(errors="replace"))
            if len(geo.names) == structure.n_atoms:
                positions = geo.positions_ang
                cell = geo.cell_ang
        except ValueError as exc:
            bundle.warnings.append(f"could not read {strc_out.name}: {exc}")
    al = prot.final_atom_list
    if forces_at_input_geometry:
        # 'forces' task: report the input geometry with the forces of the first propagated step.
        al = prot.first_forces_atom_list or al
        positions = structure.positions()
        cell = None
    if positions is None and al is not None and len(al.atoms) == structure.n_atoms:
        positions = np.array([a.position_ang for a in al.atoms])
        cell = np.array(al.lattice_ang) if len(al.lattice_ang) == 3 else None
    if positions is not None:
        for atom, p in zip(final.atoms, positions, strict=True):
            atom.position = (float(p[0]), float(p[1]), float(p[2]))
    if cell is not None and structure.is_periodic():
        final.cell = Cell(
            vectors=_mat3(cell),
            pbc=structure.cell.pbc if structure.cell else (True, True, True),
        )
    if al is not None and al.has_forces and len(al.atoms) == structure.n_atoms:
        final.atomic_vectors["forces"] = AtomicVectorProperty(
            values=[
                _v3(
                    [
                        f * MH_PER_BOHR_TO_EV_PER_ANG
                        for f in (a.force_mh_per_bohr or (0.0, 0.0, 0.0))
                    ]
                )
                for a in al.atoms
            ],
            unit=Unit.EV_PER_ANGSTROM,
            description="forces from the last ATOMLIST report (printed to 0.01 mH/Bohr)",
        )
    elif expect_forces:
        bundle.warnings.append("no forces in the protocol (ATOMLIST has no force column)")
    if al is not None and len(al.atoms) == structure.n_atoms:
        final.atomic_scalars["cppaw_charge"] = _scalars(
            [a.charge_e for a in al.atoms], Unit.ELEMENTARY_CHARGE, "Q[E] from ATOMLIST"
        )
    final.provenance = Provenance(source=str(work), software="CP-PAW")
    bundle.final_structure = final

    # series from the !> rows
    if prot.steps:
        nfi = [float(s.nfi) for s in prot.steps]
        bundle.series.append(
            ScalarSeries(
                name="energy",
                x_label="step",
                y_label="total energy",
                y_unit="eV",
                x=nfi,
                y=[s.energy_h * Hartree for s in prot.steps],
            )
        )
        bundle.series.append(
            ScalarSeries(
                name="conserved_energy",
                x_label="step",
                y_label="conserved energy",
                y_unit="eV",
                x=nfi,
                y=[s.econs_h * Hartree for s in prot.steps],
            )
        )
        bundle.series.append(
            ScalarSeries(
                name="ekin_psi",
                x_label="step",
                y_label="fictitious kinetic energy",
                y_unit="eV",
                x=nfi,
                y=[s.ekin_psi_h * Hartree for s in prot.steps],
            )
        )
        if any(s.temperature_k > 0 for s in prot.steps):
            bundle.series.append(
                ScalarSeries(
                    name="temperature",
                    x_label="time",
                    x_unit="ps",
                    y_label="ionic temperature",
                    y_unit="K",
                    x=[s.time_ps for s in prot.steps],
                    y=[s.temperature_k for s in prot.steps],
                )
            )
        # What the thermostats are doing. The course plots both against time (ch. 5.5): the wave
        # thermostat's friction says whether the wave functions are still following the atoms, and
        # the atom thermostat's says how hard it is pulling the atoms towards the target
        # temperature. Dimensionless, and zero throughout when a run has no thermostat at all.
        for name, label, values in (
            ("friction_psi", "wave-function friction", [s.friction_psi for s in prot.steps]),
            ("friction_atoms", "atom friction", [s.friction_atoms for s in prot.steps]),
        ):
            if any(v != 0.0 for v in values):
                bundle.series.append(
                    ScalarSeries(
                        name=name,
                        x_label="time",
                        x_unit="ps",
                        y_label=label,
                        y_unit="",
                        x=[s.time_ps for s in prot.steps],
                        y=values,
                    )
                )
    bundle.extra["homo_band_index"] = prot.homo_band_index
    bundle.extra["homo_band_index_by_spin"] = {
        str(k): v for k, v in sorted(prot.homo_band_index_by_spin.items())
    }
    if prot.eigenvalues:
        bundle.extra["eigenvalues_ev"] = [
            {"kpoint": e.kpoint, "spin": e.spin, "energies": e.energies_ev}
            for e in prot.eigenvalues[-1]
        ]

    # trajectory
    tra_path = work / f"{root}_r.tra"
    if tra_path.is_file() and structure.n_atoms > 0:
        try:
            tra = read_position_trajectory(tra_path, structure.n_atoms)
            frames = []
            energies = [s.energy_h * Hartree for s in prot.steps]
            temps = [s.temperature_k for s in prot.steps]
            for i, (pos, c, t) in enumerate(
                zip(tra.positions_ang, tra.cells_ang, tra.times_fs, strict=True)
            ):
                frames.append(
                    Frame(
                        positions=[_v3(p) for p in pos],
                        cell=_mat3(c),
                        time=t,
                        step=tra.steps[i],
                        energy=energies[i]
                        if i < len(energies) and len(energies) == len(tra.steps)
                        else None,
                        temperature=temps[i]
                        if i < len(temps) and len(temps) == len(tra.steps)
                        else None,
                    )
                )
            if frames:
                kind = "md" if any(f.temperature for f in frames) else "optimization"
                bundle.trajectory = Trajectory(
                    id=new_uid(),
                    name=f"{root} trajectory",
                    structure_id=structure.id,
                    symbols=structure.symbols(),
                    frames=frames,
                    kind=kind,
                )
        except (ValueError, OSError) as exc:
            bundle.warnings.append(f"could not read {tra_path.name}: {exc}")

    # grids
    for kind, wave_file in analysis:
        cube = work / f"{Path(wave_file).stem}.cub"
        if not cube.is_file():
            continue
        gkind: GridKind = "orbital" if kind.startswith("orbital:") else kind  # type: ignore[assignment]
        try:
            data = read_cube(cube, kind=gkind, unit=Unit.E_PER_BOHR3)
        except (ValueError, OSError) as exc:
            bundle.warnings.append(f"could not read {cube.name}: {exc}")
            continue
        grid: VolumetricGrid = data.grid
        grid.name = kind.replace("_", " ")
        grid.data_ref = centred_cube(cube, data, final)[0]
        grid.structure_id = final.id
        if kind.startswith("orbital:"):
            from atomscope.model import OrbitalInfo  # noqa: PLC0415

            band = int(kind.split(":")[1])
            energy = None
            if prot.eigenvalues and prot.eigenvalues[-1]:
                ev = prot.eigenvalues[-1][0].energies_ev
                energy = ev[band - 1] if band - 1 < len(ev) else None
            grid.orbital = OrbitalInfo(index=band - 1, energy=energy, spin="none", kpoint=0)
        bundle.grids.append(grid)
    return bundle


def geometry_from_run(work: Path, root: str, fallback: Structure) -> Structure:
    """``fallback`` with the positions the run finished at, when they can be read.

    The orbital export runs as a one-step restart of a finished calculation, so the grids belong
    to that calculation's geometry rather than to whatever was fed in at the start -- which after
    a relaxation is not the same structure.
    """
    strc_out = work / f"{root}.strc_out"
    if not strc_out.is_file():
        return fallback
    try:
        geo = read_strc_geometry(strc_out.read_text(errors="replace"))
    except (ValueError, OSError):
        return fallback
    if len(geo.positions_ang) != fallback.n_atoms:
        return fallback
    moved = fallback.model_copy(deep=True)
    for atom, position in zip(moved.atoms, geo.positions_ang, strict=True):
        atom.position = (float(position[0]), float(position[1]), float(position[2]))
    return moved


def centred_cube(cube: Path, data: CubeData, structure: Structure) -> tuple[str, np.ndarray | None]:
    """A copy of ``cube`` rolled so ``structure`` sits in the middle of the grid.

    CP-PAW writes its grids over the unit cell starting at the cell's own origin. The tutorial
    puts a molecule at that origin -- ch. 2.5 explains why the cell is chosen the way it is -- so
    the density and the orbitals come out split across the grid boundary, with lobes at the
    corners of the box and nothing in the middle. Rolling by a whole number of voxels fixes it
    exactly: no value changes, only which index it sits at, with the origin moved to match.

    Returns the name of the cube a viewer should read, and the rolled values when there was
    something to roll. The original file is left where it is, and is what comes back when the
    grid is not one cell of this structure's own.
    """
    if structure.cell is None or not structure.is_periodic():
        return cube.name, None
    grid = data.grid
    period = grid_period(grid.shape, grid.axes, structure.cell.vectors)
    if period is None:
        return cube.name, None
    positions = structure.positions()
    # the middle of what is drawn, not the centroid: a centroid is pulled about by where the
    # light atoms are, and for anything less symmetric than water that moves the picture
    middle = (positions.min(axis=0) + positions.max(axis=0)) / 2.0
    values, origin = centre_on(
        data.values, grid.origin, grid.axes, period, (middle[0], middle[1], middle[2])
    )
    if origin == tuple(grid.origin):
        return cube.name, None
    grid.origin = origin
    out = cube.with_name(f"{cube.stem}_centred{cube.suffix}")
    write_cube(out, grid, values, structure)
    return out.name, values


def _scalars(values: list[float], unit: Unit, description: str):  # type: ignore[no-untyped-def]  # noqa: ANN202
    from atomscope.model import AtomicScalarProperty  # noqa: PLC0415

    return AtomicScalarProperty(values=values, unit=unit, description=description)


def parse_protocol_text_cached(text: str) -> ProtocolData:
    from atomscope.backends.cppaw.protocol import parse_protocol_text  # noqa: PLC0415

    return parse_protocol_text(text)


__all__ = ["collect", "last_run", "parse_protocol"]
