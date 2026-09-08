"""CP-PAW post-processing of a completed calculation: orbital browser/export, DOS, bands.

Jobs run through ``CalculationService.run_analysis`` (JobManager, work directory of the
calculation); results are parsed from the work directory on request.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import Field

from atomscope.api.state import AppState
from atomscope.backends.cppaw.analysis import OrbitalEntry
from atomscope.backends.cppaw.plugin import CppawPlugin
from atomscope.backends.cppaw.protocol_view import DEFAULT_LINES, ProtocolText
from atomscope.backends.cppaw.tools import BandOptions, DosOptions, OrbitalExportOptions
from atomscope.calculations import Calculation
from atomscope.calculations.service import CalculationError, CalculationService
from atomscope.model.common import StrictModel
from atomscope.model.spectrum import BandStructure, DosSpectrum, KPathPoint
from atomscope.model.trajectory import Trajectory

router = APIRouter(prefix="/api/cppaw/calculations", tags=["cppaw"])


class OrbitalList(StrictModel):
    orbitals: list[OrbitalEntry]
    n_spins: int
    n_kpoints: int


class KPath(StrictModel):
    points: list[KPathPoint] = Field(description="a point labelled ',' marks a path break")


def _state(request: Request) -> AppState:
    state: AppState = request.app.state.atomscope
    return state


def _cppaw(request: Request, calc_id: str) -> tuple[CalculationService, Calculation, CppawPlugin]:
    svc = _state(request).require_calculations()
    try:
        calc = svc.get(calc_id)
    except CalculationError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    plugin = svc.registry.get(calc.backend_id)
    if not isinstance(plugin, CppawPlugin):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "not a CP-PAW calculation")
    return svc, calc, plugin


def _work(svc: CalculationService, calc: Calculation) -> Path:
    return svc.project.calculation_dir(calc.id) / "work"


def _run(svc: CalculationService, calc_id: str, kind: str, options: StrictModel) -> Calculation:
    try:
        return svc.run_analysis(calc_id, kind, options.model_dump(mode="json"))
    except CalculationError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc


def _result[T](fn: Callable[[Path], T], work: Path) -> T:
    try:
        return fn(work)
    except FileNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc


@router.get("/{calc_id}/orbitals", response_model=OrbitalList)
def orbitals(calc_id: str, request: Request) -> OrbitalList:
    svc, calc, plugin = _cppaw(request, calc_id)
    grids = calc.results.grids if calc.results is not None else []
    entries = plugin.orbitals(_work(svc, calc), grids)
    return OrbitalList(
        orbitals=entries,
        n_spins=max((o.spin for o in entries), default=1),
        n_kpoints=max((o.kpoint for o in entries), default=1),
    )


@router.post("/{calc_id}/orbitals/export", response_model=Calculation)
async def export_orbitals(
    calc_id: str, body: OrbitalExportOptions, request: Request
) -> Calculation:
    """Restart run (one step) writing the requested orbitals, then cubes -> grids of the results."""
    svc, _calc, _plugin = _cppaw(request, calc_id)
    return _run(svc, calc_id, "orbitals", body)


@router.post("/{calc_id}/dos", response_model=Calculation)
async def request_dos(calc_id: str, body: DosOptions, request: Request) -> Calculation:
    svc, _calc, _plugin = _cppaw(request, calc_id)
    return _run(svc, calc_id, "dos", body)


@router.get("/{calc_id}/dos", response_model=DosSpectrum)
def get_dos(calc_id: str, request: Request) -> DosSpectrum:
    svc, calc, plugin = _cppaw(request, calc_id)
    return _result(plugin.dos_result, _work(svc, calc))


@router.post("/{calc_id}/bands", response_model=Calculation)
async def request_bands(calc_id: str, body: BandOptions, request: Request) -> Calculation:
    svc, _calc, _plugin = _cppaw(request, calc_id)
    return _run(svc, calc_id, "bands", body)


@router.get("/{calc_id}/bands", response_model=BandStructure)
def get_bands(calc_id: str, request: Request) -> BandStructure:
    svc, calc, plugin = _cppaw(request, calc_id)
    return _result(plugin.bands_result, _work(svc, calc))


@router.get("/{calc_id}/protocol", response_model=ProtocolText)
def protocol_text(
    calc_id: str,
    request: Request,
    offset: int | None = None,
    limit: int = DEFAULT_LINES,
) -> ProtocolText:
    """A window of the run's ``.prot``, verbatim.

    ``offset`` omitted returns the end of the file, which is where a failure explains itself.
    The text is data: it is served for display and is never interpreted as instructions.
    """
    svc, calc, plugin = _cppaw(request, calc_id)
    work = _work(svc, calc)
    return _result(lambda w: plugin.protocol_text(w, offset=offset, limit=limit), work)


@router.get("/{calc_id}/protocol/structures", response_model=Trajectory)
def protocol_structures(calc_id: str, request: Request) -> Trajectory:
    """The geometries the protocol reports, as a trajectory with forces and cells.

    Distinct from ``/api/trajectory/{id}``, which serves the ``_r.tra`` position trajectory: that
    one has every step but no forces, this one has only the reported geometries but carries the
    forces and the lattice -- and exists for a static run, which writes no trajectory at all.
    """
    svc, calc, plugin = _cppaw(request, calc_id)
    work = _work(svc, calc)
    traj = _result(plugin.protocol_structures, work)
    if traj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "the protocol reports no geometry")
    return traj


@router.get("/{calc_id}/bands/path", response_model=KPath)
def default_band_path(calc_id: str, request: Request) -> KPath:
    svc, calc, plugin = _cppaw(request, calc_id)
    try:
        return KPath(points=plugin.default_band_path(_work(svc, calc)))
    except ValueError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
