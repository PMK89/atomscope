"""Project manifest and helpers for deterministic JSON on disk."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, Field

from atomscope.model.common import StrictModel
from atomscope.model.structure import new_uid

FORMAT_VERSION = 1


class ProjectManifest(StrictModel):
    id: str = Field(default_factory=new_uid)
    name: str = "untitled project"
    format_version: int = FORMAT_VERSION
    created_at: datetime = Field(default_factory=lambda: datetime.now(tz=UTC))
    modified_at: datetime = Field(default_factory=lambda: datetime.now(tz=UTC))
    structure_ids: list[str] = Field(default_factory=list)
    calculation_ids: list[str] = Field(default_factory=list)
    dataset_ids: list[str] = Field(default_factory=list)
    notes: str = ""
    view_settings: dict[str, Any] = Field(default_factory=dict)


def dump_json(model: BaseModel) -> str:
    """Deterministic JSON: sorted keys, 2-space indent, trailing newline."""
    data = model.model_dump(mode="json")
    return json.dumps(data, sort_keys=True, indent=2, ensure_ascii=False) + "\n"
