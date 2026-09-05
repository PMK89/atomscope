"""Calculation lifecycle inside a project: create -> generate -> run -> collect results."""

from __future__ import annotations

import contextlib
from pathlib import Path

from atomscope.backends.base import GeneratedInputs, Resources, ResultBundle
from atomscope.backends.registry import BackendRegistry
from atomscope.calculations.models import Calculation
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
        calc = self.get(calc_id)
        if calc.status not in ("draft", "ready", "failed", "cancelled", "completed"):
            msg = "cannot edit a queued or running calculation"
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
        calc.generated = generated
        calc.status = "ready"
        self.save(calc)
        return generated

    def run(self, calc_id: str) -> Calculation:
        calc = self.get(calc_id)
        if calc.generated is None or calc.status == "draft":
            self.generate(calc_id)
            calc = self.get(calc_id)
        if calc.status in ("queued", "running"):
            msg = "calculation is already running"
            raise CalculationError(msg)
        plugin = self.registry.get(calc.backend_id)
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
        spec = plugin.run_spec(d / "input", work, calc.generated, calc.resources)
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

    def _on_job_event(self, event: object) -> None:
        if not isinstance(event, StatusEvent):
            return
        for calc in list(self._cache.values()):
            if calc.job is not None and calc.job.id == event.job_id:
                calc.job = self.jobs.jobs[event.job_id]
                calc.status = event.status
                self.save(calc)
                if event.status == "completed":
                    with contextlib.suppress(Exception):
                        self.collect_results(calc.id)
