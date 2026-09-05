# ruff: noqa: E501
"""Calculation lifecycle inside a project: create -> generate -> run -> collect results."""

from __future__ import annotations

import builtins
import contextlib
import json
import shutil
from collections.abc import Sequence
from pathlib import Path

from atomscope.backends.base import GeneratedInputs, Resources, ResultBundle
from atomscope.backends.registry import BackendRegistry
from atomscope.calculations.grids import materialize_grids
from atomscope.calculations.models import AnalysisJob, Calculation
from atomscope.jobs import JobManager
from atomscope.jobs.models import StatusEvent
from atomscope.model import Provenance, Structure
from atomscope.project import ProjectStore
from atomscope.project.manifest import dump_json
from atomscope.schemas import ValidationReport, merge_values


class CalculationError(Exception):
    pass


class CalculationService:
    def __init__(self, project: ProjectStore, registry: BackendRegistry, jobs: JobManager) -> None:
        self.project = project
        self.registry = registry
        self.jobs = jobs
        self._cache: dict[str, Calculation] = {}
        jobs.add_listener(self._on_job_event)
        self.reconcile()

    def close(self) -> None:
        """Detach from the job manager (called when the project is closed)."""
        self.jobs.remove_listener(self._on_job_event)

    def reconcile(self) -> None:
        """Repair calculations left 'queued'/'running' by a backend that died while they ran."""
        live = {r.id for r in self.jobs.jobs.values() if r.is_active}
        for calc in self.list():
            if calc.status in ("queued", "running") and (
                calc.job is None or calc.job.id not in live
            ):
                try:
                    results = self.collect_results(calc.id)
                    complete = (
                        results.final_structure is not None
                        and bool(results.properties)
                        and results.complete is not False
                    )
                except Exception:  # noqa: BLE001
                    complete = False
                current = self.get(calc.id)
                current.status = "completed" if complete else "failed"
                if current.job is not None:
                    current.job.status = current.status
                    current.job.error = (
                        None if complete else "backend restarted while the job was active"
                    )
                self.save(current)

    # ---- persistence -----------------------------------------------------------------------
    def _dir(self, calc_id: str) -> Path:
        return self.project.calculation_dir(calc_id)

    def save(self, calc: Calculation) -> None:
        d = self.project.register_calculation(calc.id)
        (d / "calculation.json").write_text(dump_json(calc), encoding="utf-8")
        self._cache[calc.id] = calc

    def get(self, calc_id: str) -> Calculation:
        if calc_id in self._cache:
            return self._cache[calc_id]
        path = self._dir(calc_id) / "calculation.json"
        if not path.is_file():
            msg = f"calculation {calc_id} not found"
            raise CalculationError(msg)
        calc = Calculation.model_validate_json(path.read_text(encoding="utf-8"))
        self._cache[calc_id] = calc
        return calc

    def list(self) -> list[Calculation]:
        out = []
        for cid in self.project.manifest.calculation_ids:
            with contextlib.suppress(CalculationError):
                out.append(self.get(cid))
        return out

    def input_structure(self, calc: Calculation) -> Structure:
        path = self._dir(calc.id) / "input" / "structure.json"
        return Structure.model_validate_json(path.read_text(encoding="utf-8"))

    # ---- lifecycle -------------------------------------------------------------------------
    def create(
        self,
        *,
        name: str,
        backend_id: str,
        structure: Structure,
        values: dict[str, object],
        resources: Resources | None = None,
    ) -> Calculation:
        plugin = self.registry.get(backend_id)
        merged = merge_values(plugin.schema(), values)
        calc = Calculation(
            name=name,
            backend_id=backend_id,
            schema_version=plugin.schema().version,
            structure_id=structure.id,
            values=merged,
            resources=resources or Resources(),
            provenance=Provenance(source="user", parents=[structure.id]),
        )
        d = self.project.register_calculation(calc.id)
        (d / "input" / "structure.json").write_text(dump_json(structure), encoding="utf-8")
        self.save(calc)
        return calc

    def update_values(self, calc_id: str, values: dict[str, object]) -> Calculation:
        """Only unrun calculations are editable; a run calculation is immutable (use fork)."""
        calc = self.get(calc_id)
        if calc.status not in ("draft", "ready"):
            msg = f"calculation is {calc.status}; fork it to change parameters"
            raise CalculationError(msg)
        plugin = self.registry.get(calc.backend_id)
        calc.values = merge_values(plugin.schema(), values)
        calc.status = "draft"
        calc.generated = None
        self.save(calc)
        return calc

    def validate(self, calc_id: str) -> ValidationReport:
        calc = self.get(calc_id)
        plugin = self.registry.get(calc.backend_id)
        return plugin.validate(self.input_structure(calc), calc.values)

    def generate(self, calc_id: str) -> GeneratedInputs:
        """Validate, generate input files, write them to input/ and mark the calculation ready."""
        calc = self.get(calc_id)
        report = self.validate(calc_id)
        if not report.ok:
            msgs = "; ".join(f"{i.key}: {i.message}" for i in report.errors())
            msg = f"invalid parameters: {msgs}"
            raise CalculationError(msg)
        plugin = self.registry.get(calc.backend_id)
        generated = plugin.generate_inputs(self.input_structure(calc), calc.values, "case")
        input_dir = self._dir(calc.id) / "input"
        for f in generated.files:
            (input_dir / f.name).write_text(f.text, encoding="utf-8")
        # Plugins may need the merged values at run/parse time (e.g. which analysis files exist).
        (input_dir / "values.json").write_text(
            json.dumps(calc.values, indent=2, sort_keys=True, default=str) + "\n", encoding="utf-8"
        )
        calc.generated = generated
        calc.status = "ready"
        self.save(calc)
        return generated

    def fork(
        self,
        calc_id: str,
        values: dict[str, object] | None = None,
        *,
        name: str | None = None,
        restart_from_parent: bool = False,
        structure: Structure | None = None,
    ) -> Calculation:
        """New calculation derived from ``calc_id``: same structure (or a new one) and values
        overlaid with ``values``. With ``restart_from_parent`` the parent's restart file is
        copied into the new work directory (backend-specific file names come from the plugin)."""
        parent = self.get(calc_id)
        plugin = self.registry.get(parent.backend_id)
        merged = merge_values(plugin.schema(), parent.values, values or {})
        if restart_from_parent:
            restart_values = getattr(plugin, "restart_values", None)
            if callable(restart_values):
                merged = restart_values(merged)
        base_structure = structure or self.input_structure(parent)
        child = self.create(
            name=name or f"{parent.name} (fork)",
            backend_id=parent.backend_id,
            structure=base_structure,
            values=merged,
            resources=parent.resources,
        )
        child.parent_calculation_id = parent.id
        if restart_from_parent:
            copied = self._copy_restart_files(parent, child)
            if not copied:
                msg = "parent has no restart files to continue from"
                raise CalculationError(msg)
        self.save(child)
        return child

    def _copy_restart_files(self, parent: Calculation, child: Calculation) -> Sequence[str]:
        names = getattr(self.registry.get(parent.backend_id), "restart_files", None)
        patterns: Sequence[str] = (
            names(parent.generated) if callable(names) and parent.generated else ()
        )
        src = self._dir(parent.id) / "work"
        dst = self._dir(child.id) / "work"
        copied: builtins.list[str] = []
        for pattern in patterns:
            for f in src.glob(pattern):
                shutil.copy2(f, dst / f.name)
                copied.append(f.name)
        return copied

    def run(self, calc_id: str) -> Calculation:
        calc = self.get(calc_id)
        if calc.status in ("queued", "running"):
            msg = "calculation is already running"
            raise CalculationError(msg)
        if calc.status in ("completed", "failed", "cancelled"):
            msg = f"calculation already ran ({calc.status}); fork it to run again"
            raise CalculationError(msg)
        if calc.generated is None or calc.status == "draft":
            self.generate(calc_id)
            calc = self.get(calc_id)
        plugin = self.registry.get(calc.backend_id)
        if not plugin.capabilities.executes:
            msg = f"backend {plugin.name!r} only generates input files; run them with the target program"
            raise CalculationError(msg)
        exe = plugin.discover_executables()
        if not exe.available:
            msg = "backend executables not available: " + "; ".join(exe.messages)
            raise CalculationError(msg)
        d = self._dir(calc.id)
        work = d / "work"
        # Copy inputs into the work directory so the raw run is self-contained.
        assert calc.generated is not None  # noqa: S101
        for f in calc.generated.files:
            (work / f.name).write_text(f.text, encoding="utf-8")
        try:
            spec = plugin.run_spec(d / "input", work, calc.generated, calc.resources)
        except (RuntimeError, FileNotFoundError, OSError) as exc:
            raise CalculationError(str(exc)) from exc
        record = self.jobs.submit(spec, calculation_id=calc.id)
        calc.job = record
        calc.status = "queued"
        calc.results = None
        self.save(calc)
        return calc

    async def cancel(self, calc_id: str) -> Calculation:
        calc = self.get(calc_id)
        if calc.job is not None:
            await self.jobs.cancel(calc.job.id)
        return self.get(calc_id)

    def collect_results(self, calc_id: str) -> ResultBundle:
        calc = self.get(calc_id)
        plugin = self.registry.get(calc.backend_id)
        assert calc.generated is not None  # noqa: S101
        results = plugin.parse_results(self._dir(calc.id) / "work", calc.generated)
        materialize_grids(results, self._dir(calc.id) / "work", calc.id, self.project)
        (self._dir(calc.id) / "results" / "results.json").write_text(
            results.model_dump_json(indent=2), encoding="utf-8"
        )
        if results.final_structure is not None:
            final = results.final_structure
            final.name = f"{calc.name} (result)"
            final.provenance = Provenance(
                source=f"calculation:{calc.id}",
                software=calc.backend_id,
                parents=[calc.structure_id],
            )
            if final.id == calc.structure_id:
                final.id = f"{calc.id}-final"
            self.project.save_structure(final)
            calc.result_structure_id = final.id
        calc.results = results
        self.save(calc)
        return results

    # ---- post-processing ---------------------------------------------------------------------
    def run_analysis(self, calc_id: str, kind: str, options: dict[str, object]) -> Calculation:
        """Run a backend analysis tool (DOS, bands, orbital export) on a completed calculation as
        a job in its work directory. Outputs are fetched through the backend-specific routes."""
        calc = self.get(calc_id)
        if calc.status != "completed":
            msg = f"calculation is {calc.status}; analysis needs a completed calculation"
            raise CalculationError(msg)
        if any(a.job.is_active for a in calc.analysis_jobs):
            msg = "an analysis job is already running for this calculation"
            raise CalculationError(msg)
        plugin = self.registry.get(calc.backend_id)
        make_spec = getattr(plugin, "analysis_run_spec", None)
        if not callable(make_spec):
            msg = f"backend {calc.backend_id} has no analysis tools"
            raise CalculationError(msg)
        work = self._dir(calc.id) / "work"
        try:
            spec = make_spec(work, kind, options)
        except (ValueError, RuntimeError, FileNotFoundError, OSError) as exc:
            raise CalculationError(str(exc)) from exc
        record = self.jobs.submit(spec, calculation_id=calc.id)
        calc.analysis_jobs.append(AnalysisJob(kind=kind, options=options, job=record))
        self.save(calc)
        return calc

    def _collect_analysis(self, calc: Calculation, analysis: AnalysisJob) -> None:
        """Register the grids an analysis job produced with the calculation's results."""
        plugin = self.registry.get(calc.backend_id)
        collect = getattr(plugin, "analysis_collect", None)
        if not callable(collect) or calc.results is None:
            return
        work = self._dir(calc.id) / "work"
        bundle = ResultBundle(grids=collect(work, analysis.kind, analysis.options))
        materialize_grids(bundle, work, calc.id, self.project)
        new_ids = {g.id for g in bundle.grids}
        results = calc.results
        results.grids = [
            g
            for g in results.grids
            if g.id not in new_ids
            and not any(
                g.kind == "orbital" and g.orbital is not None and g.orbital == n.orbital
                for n in bundle.grids
            )
        ] + bundle.grids
        results.warnings.extend(bundle.warnings)
        (self._dir(calc.id) / "results" / "results.json").write_text(
            results.model_dump_json(indent=2), encoding="utf-8"
        )
        self.save(calc)

    def _on_job_event(self, event: object) -> None:
        if not isinstance(event, StatusEvent):
            return
        for calc in list(self._cache.values()):
            for analysis in calc.analysis_jobs:
                if analysis.job.id == event.job_id:
                    analysis.job = self.jobs.jobs[event.job_id]
                    self.save(calc)
                    if event.status == "completed":
                        with contextlib.suppress(Exception):
                            self._collect_analysis(calc, analysis)
            if calc.job is not None and calc.job.id == event.job_id:
                calc.job = self.jobs.jobs[event.job_id]
                calc.status = event.status
                if event.status == "failed":
                    plugin = self.registry.get(calc.backend_id)
                    diagnose = getattr(plugin, "diagnose_failure", None)
                    root = calc.generated.root_name if calc.generated else "case"
                    hint = (
                        diagnose(self._dir(calc.id) / "work", root) if callable(diagnose) else None
                    )
                    if hint:
                        calc.job.error = f"{calc.job.error or 'failed'}: {hint}"
                self.save(calc)
                if event.status == "completed":
                    with contextlib.suppress(Exception):
                        self.collect_results(calc.id)
