"""Calculation lifecycle and job monitoring (REST + WebSocket event stream)."""

from __future__ import annotations

import asyncio
import contextlib

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from pydantic import Field

from atomscope.api.state import AppState
from atomscope.backends.base import GeneratedInputs, Resources, ResultBundle
from atomscope.calculations import Calculation
from atomscope.calculations.service import CalculationError
from atomscope.jobs.models import LogEvent, StatusEvent
from atomscope.model.common import StrictModel
from atomscope.schemas import ValidationReport

router = APIRouter(prefix="/api/calculations", tags=["calculations"])


class CreateCalculationRequest(StrictModel):
    name: str
    backend_id: str
    structure_id: str
    values: dict[str, object] = Field(default_factory=dict)
    resources: Resources = Field(default_factory=Resources)


class UpdateValuesRequest(StrictModel):
    values: dict[str, object]


class ForkRequest(StrictModel):
    values: dict[str, object] = Field(default_factory=dict)
    name: str | None = None
    restart_from_parent: bool = False
    structure_id: str | None = Field(
        default=None, description="use another structure instead of the parent's"
    )


class LogResponse(StrictModel):
    stream: str
    lines: list[str]


def _state(request: Request) -> AppState:
    state: AppState = request.app.state.atomscope
    return state


@router.get("", response_model=list[Calculation])
def list_calculations(request: Request) -> list[Calculation]:
    return _state(request).require_calculations().list()


@router.post("", response_model=Calculation, status_code=status.HTTP_201_CREATED)
def create_calculation(body: CreateCalculationRequest, request: Request) -> Calculation:
    state = _state(request)
    svc = state.require_calculations()
    try:
        structure = state.require_project().load_structure(body.structure_id)
        return svc.create(
            name=body.name,
            backend_id=body.backend_id,
            structure=structure,
            values=body.values,
            resources=body.resources,
        )
    except KeyError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.get("/{calc_id}", response_model=Calculation)
def get_calculation(calc_id: str, request: Request) -> Calculation:
    try:
        return _state(request).require_calculations().get(calc_id)
    except CalculationError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc


@router.put("/{calc_id}/values", response_model=Calculation)
def update_values(calc_id: str, body: UpdateValuesRequest, request: Request) -> Calculation:
    try:
        return _state(request).require_calculations().update_values(calc_id, body.values)
    except CalculationError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc


@router.post("/{calc_id}/fork", response_model=Calculation, status_code=status.HTTP_201_CREATED)
def fork_calculation(calc_id: str, body: ForkRequest, request: Request) -> Calculation:
    state = _state(request)
    svc = state.require_calculations()
    try:
        structure = (
            state.require_project().load_structure(body.structure_id) if body.structure_id else None
        )
        return svc.fork(
            calc_id,
            body.values,
            name=body.name,
            restart_from_parent=body.restart_from_parent,
            structure=structure,
        )
    except CalculationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.get("/{calc_id}/validate", response_model=ValidationReport)
def validate_calculation(calc_id: str, request: Request) -> ValidationReport:
    return _state(request).require_calculations().validate(calc_id)


@router.post("/{calc_id}/generate", response_model=GeneratedInputs)
def generate_inputs(calc_id: str, request: Request) -> GeneratedInputs:
    try:
        return _state(request).require_calculations().generate(calc_id)
    except CalculationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.post("/{calc_id}/run", response_model=Calculation)
async def run_calculation(calc_id: str, request: Request) -> Calculation:
    """Async so that JobManager.submit runs inside the server's event loop."""
    try:
        return _state(request).require_calculations().run(calc_id)
    except CalculationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.post("/{calc_id}/cancel", response_model=Calculation)
async def cancel_calculation(calc_id: str, request: Request) -> Calculation:
    return await _state(request).require_calculations().cancel(calc_id)


@router.get("/{calc_id}/results", response_model=ResultBundle)
def results(calc_id: str, request: Request) -> ResultBundle:
    svc = _state(request).require_calculations()
    calc = svc.get(calc_id)
    if calc.results is not None:
        return calc.results
    if calc.generated is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "calculation has not run")
    return svc.collect_results(calc_id)


@router.get("/{calc_id}/log", response_model=LogResponse)
def read_log(
    calc_id: str, request: Request, stream: str = "stdout", tail: int = 500
) -> LogResponse:
    """Return the last ``tail`` lines of stdout/stderr or a watched file from the work directory."""
    state = _state(request)
    svc = state.require_calculations()
    calc = svc.get(calc_id)
    if calc.job is None:
        return LogResponse(stream=stream, lines=[])
    name = {"stdout": calc.job.spec.stdout_name, "stderr": calc.job.spec.stderr_name}.get(
        stream, stream
    )
    if name not in (
        calc.job.spec.stdout_name,
        calc.job.spec.stderr_name,
        *calc.job.spec.watch_files,
    ):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown stream")
    path = state.require_project().path_in_project("calculations", calc_id, "work", name)
    if not path.is_file():
        return LogResponse(stream=stream, lines=[])
    lines = path.read_text(errors="replace").splitlines()
    return LogResponse(stream=stream, lines=lines[-tail:])


@router.websocket("/ws")
async def job_events(ws: WebSocket) -> None:
    """Stream LogEvent/StatusEvent JSON for all jobs of the open project."""
    await ws.accept()
    state: AppState = ws.app.state.atomscope
    queue: asyncio.Queue[LogEvent | StatusEvent] = asyncio.Queue(maxsize=10000)

    def listener(event: LogEvent | StatusEvent) -> None:
        with contextlib.suppress(asyncio.QueueFull):
            queue.put_nowait(event)

    state.jobs.add_listener(listener)
    try:
        while True:
            event = await queue.get()
            kind = "log" if isinstance(event, LogEvent) else "status"
            await ws.send_json({"kind": kind, **event.model_dump(mode="json")})
    except WebSocketDisconnect:
        pass
    finally:
        state.jobs.remove_listener(listener)
