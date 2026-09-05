"""Backend plugin contract. Every computational code (CP-PAW, ASE calculators, ORCA ...) is a
plugin implementing :class:`BackendPlugin`; the rest of Atomscope only sees these types."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol, runtime_checkable

from pydantic import Field

from atomscope.jobs.models import RunSpec
from atomscope.model import Structure, Trajectory, VolumetricGrid
from atomscope.model.common import Quantity, StrictModel
from atomscope.schemas import ParameterSchema, Preset, ValidationReport

Values = dict[str, object]


class BackendCapabilities(StrictModel):
    energy: bool = False
    forces: bool = False
    stress: bool = False
    relaxation: bool = False
    molecular_dynamics: bool = False
    orbitals: bool = False
    density: bool = False
    dos: bool = False
    bands: bool = False
    periodic: bool = True
    molecular: bool = True
    vibrations: bool = False
    executes: bool = Field(default=True, description="False for input-generation-only plugins")


class GeneratedFile(StrictModel):
    name: str = Field(description="file name inside the input directory")
    text: str
    role: str = Field(default="input", description="input | structure | control | script")


class GeneratedInputs(StrictModel):
    files: list[GeneratedFile]
    root_name: str = Field(description="base name of the calculation, e.g. 'case'")
    summary: str = ""


class ExecutableReport(StrictModel):
    available: bool
    executables: dict[str, str] = Field(default_factory=dict, description="role -> absolute path")
    messages: list[str] = Field(default_factory=list)


class Resources(StrictModel):
    cores: int = 1
    mpi: bool = False


class ScalarSeries(StrictModel):
    """A named 1-D series (e.g. energy per iteration) with units."""

    name: str
    x_label: str
    y_label: str
    x: list[float]
    y: list[float]
    x_unit: str = ""
    y_unit: str = ""


class ResultBundle(StrictModel):
    """Parsed results in Atomscope model types. Backend-specific data stays in ``extra``."""

    final_structure: Structure | None = None
    properties: dict[str, Quantity] = Field(default_factory=dict)
    trajectory: Trajectory | None = None
    grids: list[VolumetricGrid] = Field(default_factory=list)
    series: list[ScalarSeries] = Field(default_factory=list)
    converged: bool | None = None
    complete: bool | None = Field(
        default=None, description="the program's own normal-termination marker was found"
    )
    warnings: list[str] = Field(default_factory=list)
    extra: dict[str, object] = Field(default_factory=dict)


@runtime_checkable
class BackendPlugin(Protocol):
    id: str
    name: str
    capabilities: BackendCapabilities

    def schema(self) -> ParameterSchema: ...
    def presets(self) -> list[Preset]: ...
    def discover_executables(self) -> ExecutableReport: ...
    def validate(self, structure: Structure, values: Values) -> ValidationReport: ...
    def generate_inputs(
        self, structure: Structure, values: Values, root_name: str
    ) -> GeneratedInputs: ...
    def run_spec(
        self, input_dir: Path, work_dir: Path, generated: GeneratedInputs, resources: Resources
    ) -> RunSpec: ...
    def parse_results(self, work_dir: Path, generated: GeneratedInputs) -> ResultBundle: ...
