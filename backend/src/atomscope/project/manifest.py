"""Project manifest and helpers for deterministic JSON on disk."""

from __future__ import annotations

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
    """Deterministic JSON: field-declaration order, 2-space indent, trailing newline.

    pydantic emits fields in declaration order, which is as stable and as diff-friendly as
    sorting them and lets the model serialise itself in one pass: dumping to a dict and running
    it through ``json.dumps(sort_keys=True)`` cost 0.83 s for a 1e5-atom structure against
    0.13 s here (docs/performance.md). Files written by earlier versions still load; the first
    re-save of such a file reorders its keys once.
    """
    return model.model_dump_json(indent=2) + "\n"
