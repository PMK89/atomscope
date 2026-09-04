"""Shared building blocks for the data model."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from atomscope.units import Unit

Vec3 = Annotated[tuple[float, float, float], Field(description="3-vector")]
Mat3 = Annotated[
    tuple[Vec3, Vec3, Vec3],
    Field(description="3x3 matrix as three row vectors"),
]


class StrictModel(BaseModel):
    """Base class: forbid unknown fields, validate on assignment, deterministic JSON."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True, frozen=False)


class Quantity(StrictModel):
    """A scalar with an explicit unit."""

    value: float
    unit: Unit


class Provenance(StrictModel):
    """Where a piece of data came from."""

    source: str = Field(description="file path, backend id, tool name or 'user'")
    created_at: datetime = Field(default_factory=lambda: datetime.now(tz=UTC))
    software: str | None = Field(default=None, description="e.g. 'CP-PAW aa467ef', 'ASE 3.26'")
    parents: list[str] = Field(default_factory=list, description="ids of parent objects")
    notes: str = ""
