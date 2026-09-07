"""Sweeps: several calculations that differ in one way, read back as one curve."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import Field

from atomscope.api.state import AppState
from atomscope.calculations import Calculation
from atomscope.calculations.sweeps import (
    MILLIHARTREE,
    SweepResult,
    create_sweep,
    members,
    run_sweep,
    sweep_result,
)
from atomscope.calculations.sweeps import SweepSpec as SweepSpecModel
from atomscope.model.common import StrictModel

router = APIRouter(prefix="/api/sweeps", tags=["sweeps"])


class CreateSweepRequest(StrictModel):
    """``structure_id`` is the sweep's reference structure; a point may name another instead."""

    structure_id: str
    spec: SweepSpecModel


class SweepPointStructure(StrictModel):
    """A point whose structure is what differs, named rather than carried inline."""

    x: float
    structure_id: str


class SweepSummary(StrictModel):
    """A sweep as a list entry: what it varies and how far it has got."""

    sweep_id: str
    label: str
    unit: str | None
    key: str | None
    points: int
    completed: int


class SweepCurve(StrictModel):
    """The curve plus the answer a convergence test is asking for."""

    result: SweepResult
    converged_from: float | None = Field(
        default=None, description="smallest x from which the energy holds within the tolerance"
    )
    tolerance_ev: float = MILLIHARTREE


def _state(request: Request) -> AppState:
    state: AppState = request.app.state.atomscope
    return state


@router.get("", response_model=list[SweepSummary])
def list_sweeps(request: Request) -> list[SweepSummary]:
    svc = _state(request).require_calculations()
    seen: dict[str, list[Calculation]] = {}
    for calc in svc.list():
        if calc.sweep is not None:
            seen.setdefault(calc.sweep.sweep_id, []).append(calc)
    out = []
    for sweep_id, group in seen.items():
        first = group[0].sweep
        assert first is not None  # noqa: S101
        out.append(
            SweepSummary(
                sweep_id=sweep_id,
                label=first.label,
                unit=first.unit,
                key=first.key,
                points=len(group),
                completed=sum(1 for c in group if c.status == "completed"),
            )
        )
    return sorted(out, key=lambda s: s.label)


@router.post("", response_model=list[Calculation], status_code=status.HTTP_201_CREATED)
def create(body: CreateSweepRequest, request: Request) -> list[Calculation]:
    state = _state(request)
    try:
        structure = state.require_project().load_structure(body.structure_id)
        return create_sweep(state.require_calculations(), body.spec, structure)
    except KeyError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


def _curve(result: SweepResult, tolerance_ev: float) -> SweepCurve:
    return SweepCurve(
        result=result,
        converged_from=result.converged_from(tolerance_ev),
        tolerance_ev=tolerance_ev,
    )


@router.get("/{sweep_id}", response_model=SweepCurve)
def get_sweep(sweep_id: str, request: Request, tolerance_ev: float = MILLIHARTREE) -> SweepCurve:
    try:
        return _curve(sweep_result(_state(request).require_calculations(), sweep_id), tolerance_ev)
    except KeyError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc


@router.post("/{sweep_id}/run", response_model=SweepCurve)
async def run(sweep_id: str, request: Request, tolerance_ev: float = MILLIHARTREE) -> SweepCurve:
    """Run every point that has not run, one after another. Real DFT runs on one workstation:
    two at once take longer than two in a row."""
    svc = _state(request).require_calculations()
    if not members(svc, sweep_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no sweep {sweep_id!r}")
    try:
        return _curve(await run_sweep(svc, sweep_id), tolerance_ev)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
