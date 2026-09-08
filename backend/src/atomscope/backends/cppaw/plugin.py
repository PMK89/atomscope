# ruff: noqa: E501, PLR0912, PLR0915, S603
"""The CP-PAW backend plugin (flagship backend)."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from ase.units import Bohr

from atomscope.backends.base import (
    BackendCapabilities,
    ExecutableReport,
    GeneratedFile,
    GeneratedInputs,
    Resources,
    ResultBundle,
    Values,
)
from atomscope.backends.cppaw import settings as cppaw_settings
from atomscope.backends.cppaw.analysis import (
    AnalysisKind,
    OrbitalEntry,
    default_kpath,
    electronic_info,
    list_orbitals,
    orbital_label,
)
from atomscope.backends.cppaw.bands import read_bands
from atomscope.backends.cppaw.cntl import (
    analysis_files,
    cntl_text,
    force_stage_values,
    parse_orbital_bands,
)
from atomscope.backends.cppaw.dos import read_dos, read_fermi_level
from atomscope.backends.cppaw.protocol_view import (
    DEFAULT_LINES,
    ProtocolText,
    protocol_structures,
    read_protocol_text,
)
from atomscope.backends.cppaw.results import centred_cube, collect, geometry_from_run
from atomscope.backends.cppaw.schema import PRESETS, SCHEMA
from atomscope.backends.cppaw.setups import SetupsLibrary
from atomscope.backends.cppaw.strc import (
    StrcOptions,
    molecule_box,
    parse_occupation_states,
    strc_text,
)
from atomscope.backends.cppaw.tools import (
    BandOptions,
    DosOptions,
    OrbitalExportOptions,
    band_sidecar,
    band_sidecar_text,
    bcntl_text,
    dcntl_text,
    orbital_cntl_text,
    orbital_root,
    orbital_wave_file,
)
from atomscope.jobs.models import RunSpec
from atomscope.model import OrbitalInfo, Structure, VolumetricGrid
from atomscope.model.spectrum import BandStructure, DosSpectrum, KPathPoint
from atomscope.model.trajectory import Trajectory
from atomscope.parsers.cube import read_cube
from atomscope.schemas import (
    ParameterSchema,
    Preset,
    ValidationIssue,
    ValidationReport,
    merge_values,
    validate,
)
from atomscope.units import Unit

Vec3 = tuple[float, float, float]


def _v3(row: object) -> Vec3:
    seq = list(row)  # type: ignore[call-overload]
    return (float(seq[0]), float(seq[1]), float(seq[2]))


class CppawPlugin:
    id = "cppaw"
    name = "CP-PAW"
    capabilities = BackendCapabilities(
        energy=True,
        forces=True,
        relaxation=True,
        molecular_dynamics=True,
        orbitals=True,
        density=True,
        dos=True,
        bands=True,
        periodic=True,
        molecular=True,
    )

    def __init__(self, settings: cppaw_settings.CppawSettings | None = None) -> None:
        self.settings = settings or cppaw_settings.CppawSettings.from_env()
        self.health: cppaw_settings.HealthReport | None = None

    def schema(self) -> ParameterSchema:
        return SCHEMA

    def presets(self) -> list[Preset]:
        return PRESETS

    def discover_executables(self) -> ExecutableReport:
        report = cppaw_settings.discover(self.settings)
        if self.health is not None:
            report.messages.append(
                ("healthy: " if self.health.ok else "unhealthy: ") + self.health.message
            )
        return report

    def _setups_library(self) -> SetupsLibrary:
        path = self.settings.setups_file
        if path is None or not path.is_file():
            msg = "setups library requested but ATOMSCOPE_CPPAW_SETUPS_FILE is not set or missing"
            raise ValueError(msg)
        return SetupsLibrary.from_file(path)

    def restart_values(self, values: Values) -> Values:
        """Values for a calculation continuing from a copied restart file."""
        out = dict(values)
        if out.get("start") not in ("restart", "restart_new_structure"):
            out["start"] = "restart"
        return out

    def restart_files(self, generated: GeneratedInputs) -> list[str]:
        """Glob patterns (relative to work/) copied when continuing from a previous run."""
        return [f"{generated.root_name}.rstrt"]

    def health_check(self) -> cppaw_settings.HealthReport:
        self.health = cppaw_settings.health_check(self.settings)
        return self.health

    # ---- validation --------------------------------------------------------------------------
    def validate(self, structure: Structure, values: Values) -> ValidationReport:
        merged = merge_values(SCHEMA, values)
        report = validate(SCHEMA, merged)
        if structure.n_atoms == 0:
            report.issues.append(ValidationIssue(key=None, message="structure has no atoms"))
        if (
            merged.get("kpoint_mode") != "gamma"
            and not structure.is_periodic()
            and merged.get("kpoint_mode") == "grid"
        ):
            report.issues.append(
                ValidationIssue(
                    key="kpoint_mode",
                    message="k-point grids need a periodic cell",
                    severity="warning",
                )
            )
        if merged.get("write_spin_density") and not merged.get("spin_polarized"):
            report.issues.append(
                ValidationIssue(
                    key="write_spin_density",
                    message="requires a spin-polarized calculation",
                    severity="warning",
                )
            )
        _, bad_bands = parse_orbital_bands(merged.get("orbital_bands", ""))
        if bad_bands:
            report.issues.append(
                ValidationIssue(
                    key="orbital_bands",
                    message=f"not band numbers or ranges: {', '.join(bad_bands)}",
                )
            )
        if merged.get("occupations") == "mermin" and merged.get("safeortho"):
            report.issues.append(
                ValidationIssue(
                    key="safeortho",
                    message="Mermin occupations require SAFEORTHO=F (will be forced off)",
                    severity="warning",
                )
            )
        if merged.get("setup_source") == "library":
            try:
                lib = self._setups_library()
            except ValueError as exc:
                report.issues.append(ValidationIssue(key="setup_source", message=str(exc)))
            else:
                missing = sorted(set(structure.symbols()) - set(lib.elements()))
                if missing:
                    report.issues.append(
                        ValidationIssue(
                            key="setup_source",
                            message=f"library has no setups for {missing}; internal setups will be used for them",
                            severity="warning",
                        )
                    )
        states_text = str(merged.get("occupation_states", "") or "")
        if states_text.strip():
            try:
                states = parse_occupation_states(states_text)
            except ValueError as exc:
                report.issues.append(ValidationIssue(key="occupation_states", message=str(exc)))
            else:
                if any(st.spin == 2 for st in states) and not merged.get("spin_polarized"):
                    report.issues.append(
                        ValidationIssue(
                            key="occupation_states",
                            message="spin 2 states require a spin-polarized calculation",
                        )
                    )
        if merged.get("task") == "md" and merged.get("start") == "scratch":
            report.issues.append(
                ValidationIssue(
                    key="start",
                    message="MD from random wave functions is unphysical; converge the electrons first and start from the restart file",
                    severity="warning",
                )
            )
        return report

    # ---- inputs --------------------------------------------------------------------------------
    def generate_inputs(
        self, structure: Structure, values: Values, root_name: str
    ) -> GeneratedInputs:
        merged = merge_values(SCHEMA, values)
        opts = StrcOptions.from_values(merged)
        if merged.get("setup_source") == "library":
            opts.library = self._setups_library()
        strc = strc_text(structure, opts)
        task = merged.get("task")
        files = [GeneratedFile(name=f"{root_name}.strc", text=strc, role="structure")]
        if task == "forces":
            # Two stages: converge the electrons, then a few damped atomic steps for forces.
            files.append(
                GeneratedFile(
                    name=f"{root_name}.stage1.cntl",
                    text=cntl_text(root_name, merged),
                    role="control",
                )
            )
            files.append(
                GeneratedFile(
                    name=f"{root_name}.stage2.cntl",
                    text=cntl_text(root_name, force_stage_values(merged)),
                    role="control",
                )
            )
        else:
            files.append(
                GeneratedFile(
                    name=f"{root_name}.cntl", text=cntl_text(root_name, merged), role="control"
                )
            )
        summary = f"CP-PAW {task} on {structure.formula()} ({'periodic' if structure.is_periodic() else 'molecule'})"
        return GeneratedInputs(files=files, root_name=root_name, summary=summary)

    def _structure_from_inputs(self, input_dir: Path) -> Structure:
        return Structure.model_validate_json(
            (input_dir / "structure.json").read_text(encoding="utf-8")
        )

    def run_spec(
        self, input_dir: Path, work_dir: Path, generated: GeneratedInputs, resources: Resources
    ) -> RunSpec:
        exe = self._executable(cppaw_settings.MAIN_EXE)
        mpi_args: list[str] = []
        if resources.cores > 1:
            if not self.settings.mpirun:
                msg = "parallel run requested but mpirun is not available"
                raise RuntimeError(msg)
            exe = self._executable(cppaw_settings.PARALLEL_EXE)
            mpi_args = ["--mpirun", self.settings.mpirun, "--np", str(resources.cores)]
        structure = self._structure_from_inputs(input_dir)
        values = self._values_from_inputs(input_dir)
        argv = [
            sys.executable,
            "-m",
            "atomscope.backends.cppaw.runner",
            str(work_dir),
            generated.root_name,
            str(exe),
        ]
        stages = sorted(
            f.name for f in generated.files if ".stage" in f.name and f.name.endswith(".cntl")
        )
        if stages:
            argv += ["--stages", *stages]
        argv += mpi_args
        wave = self.settings.find("paw_wave.x")
        analysis = analysis_files(generated.root_name, values)
        if wave is not None and analysis:
            argv += ["--wave", str(wave)]
            for kind, fname in analysis:
                argv += ["--cube", f"{kind}={fname}"]
            origin, vectors = self._view_box(structure, values)
            argv += [
                "--box",
                *[f"{x:.6f}" for x in origin],
                *[f"{x:.6f}" for row in vectors for x in row],
            ]
        env = self.settings.env()
        if resources.cores > 1:
            env["OMP_NUM_THREADS"] = "1"
        return RunSpec(
            argv=argv,
            cwd=work_dir,
            env=env,
            stdout_name="driver.log",
            stderr_name="driver.err",
            watch_files=[f"{generated.root_name}.prot"],
            description=generated.summary,
            soft_stop_seconds=120.0,  # runner touches ROOT.exit and waits for PROGRAM FINISHED
        )

    def _executable(self, name: str) -> Path:
        """Absolute path of a CP-PAW executable with a verified libgfortran runtime."""
        exe = self.settings.find(name)
        if exe is None:
            msg = f"{name} not found"
            raise FileNotFoundError(msg)
        if not self.settings.runtime_verified:
            problem = cppaw_settings.ensure_runtime(self.settings)
            if problem:
                raise RuntimeError(problem)
        return exe

    def _values_from_inputs(self, input_dir: Path) -> Values:
        import json  # noqa: PLC0415

        path = input_dir / "values.json"
        if path.is_file():
            values: Values = json.loads(path.read_text(encoding="utf-8"))
            return merge_values(SCHEMA, values)
        return merge_values(SCHEMA, {})

    def _view_box(
        self, structure: Structure, values: Values
    ) -> tuple[Vec3, tuple[Vec3, Vec3, Vec3]]:
        """View box (Bohr): the full cell (three edge vectors) for periodic systems, the
        molecule bounding box plus margin otherwise."""
        if structure.is_periodic() and structure.cell is not None:
            m = np.array(structure.cell.vectors) / Bohr
            return (0.0, 0.0, 0.0), (_v3(m[0]), _v3(m[1]), _v3(m[2]))
        margin = float(values.get("box_margin", 4.0))  # type: ignore[arg-type]
        pos = structure.positions()
        lo = (pos.min(axis=0) - margin) / Bohr
        cell = molecule_box(structure, margin)
        v = np.array(cell.vectors) / Bohr
        return (float(lo[0]), float(lo[1]), float(lo[2])), (_v3(v[0]), _v3(v[1]), _v3(v[2]))

    def diagnose_failure(self, work_dir: Path, root_name: str) -> str | None:
        """Called by the calculation service when a job fails; returns a human explanation."""
        text = ""
        for name in (f"{root_name}.out", "driver.log", "driver.err"):
            p = work_dir / name
            if p.is_file():
                text += p.read_text(errors="replace")[-20000:]
        return cppaw_settings.diagnose_output(text)

    # ---- results -------------------------------------------------------------------------------
    def parse_results(self, work_dir: Path, generated: GeneratedInputs) -> ResultBundle:
        input_dir = work_dir.parent / "input"
        structure = self._structure_from_inputs(input_dir)
        values = self._values_from_inputs(input_dir)
        task = str(values.get("task", "single_point"))
        return collect(
            work_dir,
            generated.root_name,
            structure,
            expect_forces=task in ("forces", "relax", "md"),
            analysis=analysis_files(generated.root_name, values),
            forces_at_input_geometry=task == "forces",
        )

    # ---- post-processing (DOS, bands, orbital export) -----------------------------------------
    def analysis_run_spec(
        self, work_dir: Path, kind: AnalysisKind, options: dict[str, object]
    ) -> RunSpec:
        """Job that runs one analysis tool in the finished calculation's work directory. The
        control file is written here; outputs are read back by :meth:`analysis_result` /
        :meth:`analysis_collect`."""
        input_dir = work_dir.parent / "input"
        structure = self._structure_from_inputs(input_dir)
        values = self._values_from_inputs(input_dir)
        root = "case"
        info = electronic_info(work_dir, root)
        env = self.settings.env()
        if kind == "dos":
            exe = self._executable("paw_dos.x")
            (work_dir / f"{root}.dcntl").write_text(
                dcntl_text(root, structure, DosOptions.model_validate(options)), encoding="utf-8"
            )
            return RunSpec(
                argv=[str(exe), f"{root}.dcntl"],
                cwd=work_dir,
                env=env,
                stdout_name="dos.log",
                stderr_name="dos.err",
                watch_files=[f"{root}.dprot"],
                description=f"DOS of {structure.formula()}",
            )
        if kind == "bands":
            exe = self._executable("paw_bands.x")
            bopts = BandOptions.model_validate(options)
            path = bopts.path or default_kpath(structure)
            nb = info.n_bands or 20
            (work_dir / f"{root}.bcntl").write_text(
                bcntl_text(root, path, bopts, nb, info.n_spins), encoding="utf-8"
            )
            (work_dir / band_sidecar(root)).write_text(
                band_sidecar_text(path, bopts, info.n_spins), encoding="utf-8"
            )
            return RunSpec(
                argv=[str(exe), f"{root}.bcntl"],
                cwd=work_dir,
                env=env,
                stdout_name="bands.log",
                stderr_name="bands.err",
                watch_files=[f"{root}.bprot"],
                description=f"band structure of {structure.formula()}",
            )
        if kind == "orbitals":
            exe = self._executable(cppaw_settings.MAIN_EXE)
            wave = self._executable("paw_wave.x")
            opts = OrbitalExportOptions.model_validate(options)
            for req in opts.orbitals:
                if (
                    req.band > info.n_bands
                    or req.kpoint > info.n_kpoints
                    or req.spin > info.n_spins
                ):
                    msg = f"orbital band={req.band} k={req.kpoint} spin={req.spin} does not exist"
                    raise ValueError(msg)
            if not (work_dir / f"{root}.rstrt").is_file():
                msg = f"{root}.rstrt not found: the calculation has no restart file"
                raise FileNotFoundError(msg)
            orb = orbital_root(root)
            (work_dir / f"{orb}.cntl").write_text(
                orbital_cntl_text(root, values, opts.orbitals), encoding="utf-8"
            )
            argv = [
                sys.executable,
                "-m",
                "atomscope.backends.cppaw.runner",
                str(work_dir),
                orb,
                str(exe),
            ]
            argv += ["--wave", str(wave)]
            for req in opts.orbitals:
                argv += ["--cube", f"orbital:{req.band}={orbital_wave_file(orb, req)}"]
            origin, vectors = self._view_box(structure, values)
            argv += [
                "--box",
                *[f"{x:.6f}" for x in origin],
                *[f"{x:.6f}" for row in vectors for x in row],
            ]
            return RunSpec(
                argv=argv,
                cwd=work_dir,
                env=env,
                stdout_name="orbitals.log",
                stderr_name="orbitals.err",
                watch_files=[f"{orb}.prot"],
                description=f"orbital export ({len(opts.orbitals)}) of {structure.formula()}",
                soft_stop_seconds=60.0,
            )
        msg = f"unknown analysis kind {kind!r}"
        raise ValueError(msg)

    def analysis_collect(
        self, work_dir: Path, kind: AnalysisKind, options: dict[str, object]
    ) -> list[VolumetricGrid]:
        """Grids produced by a finished analysis job (only orbital exports make grids)."""
        if kind != "orbitals":
            return []
        root = "case"
        info = electronic_info(work_dir, root)
        opts = OrbitalExportOptions.model_validate(options)
        grids: list[VolumetricGrid] = []
        for req in opts.orbitals:
            cube = work_dir / f"{Path(orbital_wave_file(orbital_root(root), req)).stem}.cub"
            if not cube.is_file():
                continue
            data = read_cube(cube, kind="orbital", unit=Unit.E_PER_BOHR3)
            grid = data.grid
            grid.name = f"orbital b{req.band} k{req.kpoint} s{req.spin}"
            # ...rolled so the molecule is in the middle of it; see `centred_cube`
            geometry = geometry_from_run(
                work_dir, root, self._structure_from_inputs(work_dir.parent / "input")
            )
            grid.data_ref = centred_cube(cube, data, geometry)[0]
            eig = next(
                (e for e in info.eigenvalues if e.kpoint == req.kpoint and e.spin == req.spin), None
            )
            energy = (
                eig.energies_ev[req.band - 1]
                if eig is not None and req.band - 1 < len(eig.energies_ev)
                else None
            )
            homo = info.homo(req.spin)
            grid.orbital = OrbitalInfo(
                index=req.band - 1,
                energy=energy,
                occupation=(2.0 if info.n_spins == 1 else 1.0)
                if homo is not None and req.band <= homo
                else 0.0,
                spin="none" if info.n_spins == 1 else ("up" if req.spin == 1 else "down"),
                kpoint=req.kpoint,
                label=orbital_label(req.band, homo),
            )
            grids.append(grid)
        return grids

    def orbitals(self, work_dir: Path, grids: list[VolumetricGrid]) -> list[OrbitalEntry]:
        return list_orbitals(electronic_info(work_dir, "case"), grids)

    def dos_result(self, work_dir: Path) -> DosSpectrum:
        info = electronic_info(work_dir, "case")
        return read_dos(work_dir, "case", homo_energy=info.homo_energy, n_spins=info.n_spins)

    def bands_result(self, work_dir: Path) -> BandStructure:
        # Which reference level a band structure is read against decides whether each band counts
        # as filled, and the two candidates are not interchangeable. A variable-occupation run
        # reports its self-consistent Fermi level in the protocol; a DOS run has one in .dprot.
        # A fixed-occupation run has neither, and there ``homo_energy`` -- the top of the filled
        # states -- is the level, which for an insulator is what the course draws anyway.
        info = electronic_info(work_dir, "case")
        return read_bands(
            work_dir,
            "case",
            # `or`, not `??`: a run that died after DYNOCC's first print leaves the
            # uninitialised 0.0 behind, and a level drawn at zero would be a lie.
            fermi_level=info.fermi_level or read_fermi_level(work_dir / "case.dprot"),
            homo_energy=info.homo_energy,
        )

    def protocol_text(
        self, work_dir: Path, *, offset: int | None = None, limit: int = DEFAULT_LINES
    ) -> ProtocolText:
        return read_protocol_text(work_dir / "case.prot", offset=offset, limit=limit)

    def protocol_structures(self, work_dir: Path) -> Trajectory | None:
        """The geometries the protocol reports, in order.

        The calculation's own structure supplies the element names; it is beside the work
        directory, and falling back to the atom names only matters for a run Atomscope did not
        set up itself.
        """
        symbols: list[str] | None = None
        try:
            symbols = self._structure_from_inputs(work_dir.parent / "input").symbols()
        except (OSError, ValueError):
            symbols = None
        return protocol_structures(work_dir, "case", symbols=symbols)

    def default_band_path(self, work_dir: Path) -> list[KPathPoint]:
        return default_kpath(self._structure_from_inputs(work_dir.parent / "input"))


plugin = CppawPlugin()
