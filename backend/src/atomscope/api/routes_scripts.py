"""User Python scripts: store them in the project, run them, read what they produced."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status

from atomscope.api.state import AppState
from atomscope.model.common import StrictModel
from atomscope.scripting.models import Script, ScriptRun
from atomscope.scripting.service import ScriptService, ScriptServiceError

router = APIRouter(prefix="/api/scripts", tags=["scripts"])


class WriteScriptRequest(StrictModel):
    source: str


class RunScriptRequest(StrictModel):
    structure_id: str | None = None


class LogResponse(StrictModel):
    stream: str
    lines: list[str]


def _service(request: Request) -> ScriptService:
    state: AppState = request.app.state.atomscope
    return state.require_scripts()


@router.get("", response_model=list[Script])
def list_scripts(request: Request) -> list[Script]:
    return _service(request).list_scripts()


@router.get("/examples", response_model=list[Script])
def list_examples(request: Request) -> list[Script]:
    """The scripts Atomscope ships, as a starting point; they are not part of the project."""
    return _service(request).examples()


@router.get("/runs", response_model=list[ScriptRun])
def list_runs(request: Request) -> list[ScriptRun]:
    return _service(request).list_runs()


@router.get("/runs/{run_id}", response_model=ScriptRun)
def get_run(run_id: str, request: Request) -> ScriptRun:
    try:
        return _service(request).get_run(run_id)
    except ScriptServiceError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc


@router.get("/runs/{run_id}/log", response_model=LogResponse)
def run_log(run_id: str, request: Request, stream: str = "stdout", tail: int = 500) -> LogResponse:
    try:
        return LogResponse(stream=stream, lines=_service(request).log(run_id, stream, tail))
    except ScriptServiceError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.post("/runs/{run_id}/cancel", response_model=ScriptRun)
async def cancel_run(run_id: str, request: Request) -> ScriptRun:
    try:
        return await _service(request).cancel_run(run_id)
    except ScriptServiceError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc


@router.get("/{script_id}", response_model=Script)
def get_script(script_id: str, request: Request) -> Script:
    try:
        return _service(request).get(script_id)
    except ScriptServiceError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc


@router.put("/{script_id}", response_model=Script)
def write_script(script_id: str, body: WriteScriptRequest, request: Request) -> Script:
    try:
        return _service(request).write(script_id, body.source)
    except ScriptServiceError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.delete("/{script_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_script(script_id: str, request: Request) -> None:
    try:
        _service(request).delete(script_id)
    except ScriptServiceError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.post("/{script_id}/run", response_model=ScriptRun, status_code=status.HTTP_201_CREATED)
async def run_script(script_id: str, body: RunScriptRequest, request: Request) -> ScriptRun:
    """Async so that the job manager submits inside the server's own event loop."""
    try:
        return _service(request).run(script_id, body.structure_id)
    except ScriptServiceError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - a missing structure, a bad id
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
