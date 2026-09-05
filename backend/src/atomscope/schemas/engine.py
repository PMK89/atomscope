"""Generic parameter schema engine.

A backend plugin describes its calculation options as a :class:`ParameterSchema` (pure data,
JSON-serializable). The frontend renders forms from it; this module validates values, computes
defaults and evaluates conditional visibility. Nothing here knows about CP-PAW or any other code.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field, model_validator

from atomscope.model.common import StrictModel
from atomscope.units import Unit

ParameterType = Literal["integer", "number", "boolean", "string", "enum", "vector", "text"]
Values = dict[str, Any]


class VisibleWhen(StrictModel):
    """Show a parameter only when another parameter satisfies a condition."""

    key: str
    op: Literal["eq", "ne", "in", "not_in", "truthy", "falsy"] = "eq"
    value: Any = None


class Choice(StrictModel):
    value: str | int | float | bool
    label: str
    help: str = ""


class ParameterSpec(StrictModel):
    key: str = Field(description="unique within the schema, e.g. 'nstep'")
    label: str
    type: ParameterType
    default: Any = None
    unit: Unit | None = None
    minimum: float | None = None
    maximum: float | None = None
    exclusive_minimum: bool = False
    choices: list[Choice] | None = Field(default=None, description="for type 'enum'")
    length: int | None = Field(default=None, description="for type 'vector'")
    integer_vector: bool = Field(default=False, description="vector of ints instead of floats")
    required: bool = False
    advanced: bool = False
    help: str = ""
    reference: str | None = Field(default=None, description="manual section / paper")
    backend_path: str | None = Field(
        default=None,
        description="where the value lands in the backend input, e.g. 'CONTROL/GENERIC/NSTEP'",
    )
    visible_when: list[VisibleWhen] = Field(default_factory=list)
    group: str | None = Field(default=None, description="UI sub-grouping inside a section")

    @model_validator(mode="after")
    def _consistent(self) -> ParameterSpec:
        if self.type == "enum" and not self.choices:
            msg = f"parameter {self.key}: enum needs choices"
            raise ValueError(msg)
        if self.type == "vector" and not self.length:
            msg = f"parameter {self.key}: vector needs length"
            raise ValueError(msg)
        if self.default is not None:
            issue = _check_value(self, self.default)
            if issue:
                msg = f"parameter {self.key}: default invalid: {issue}"
                raise ValueError(msg)
        return self


class Section(StrictModel):
    id: str
    label: str
    help: str = ""
    parameters: list[ParameterSpec] = Field(default_factory=list)
    advanced: bool = False


class ParameterSchema(StrictModel):
    id: str = Field(description="e.g. 'cppaw'")
    backend: str
    version: int = 1
    title: str
    sections: list[Section]

    @model_validator(mode="after")
    def _unique_keys(self) -> ParameterSchema:
        seen: set[str] = set()
        for spec in self.parameters():
            if spec.key in seen:
                msg = f"duplicate parameter key {spec.key!r}"
                raise ValueError(msg)
            seen.add(spec.key)
        for spec in self.parameters():
            for cond in spec.visible_when:
                if cond.key not in seen:
                    msg = f"parameter {spec.key}: visible_when references unknown key {cond.key!r}"
                    raise ValueError(msg)
        return self

    def parameters(self) -> list[ParameterSpec]:
        return [p for s in self.sections for p in s.parameters]

    def spec(self, key: str) -> ParameterSpec:
        for p in self.parameters():
            if p.key == key:
                return p
        msg = f"unknown parameter {key!r}"
        raise KeyError(msg)


class Preset(StrictModel):
    id: str
    name: str
    schema_id: str
    description: str = ""
    values: Values = Field(default_factory=dict, description="partial: only keys that differ")


class ValidationIssue(StrictModel):
    key: str | None
    message: str
    severity: Literal["error", "warning"] = "error"


class ValidationReport(StrictModel):
    issues: list[ValidationIssue] = Field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not any(i.severity == "error" for i in self.issues)

    def errors(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.severity == "error"]


# ---- evaluation -----------------------------------------------------------------------------


def is_visible(spec: ParameterSpec, values: Values) -> bool:
    for cond in spec.visible_when:
        actual = values.get(cond.key)
        match cond.op:
            case "eq":
                ok = actual == cond.value
            case "ne":
                ok = actual != cond.value
            case "in":
                ok = actual in (cond.value or [])
            case "not_in":
                ok = actual not in (cond.value or [])
            case "truthy":
                ok = bool(actual)
            case "falsy":
                ok = not actual
        if not ok:
            return False
    return True


def defaults(schema: ParameterSchema) -> Values:
    return {p.key: p.default for p in schema.parameters() if p.default is not None}


def merge_values(schema: ParameterSchema, *layers: Values) -> Values:
    """Defaults overlaid by successive layers (e.g. preset, then user edits)."""
    out = defaults(schema)
    for layer in layers:
        out.update(layer)
    return out


def _is_number(v: Any) -> bool:
    return isinstance(v, int | float) and not isinstance(v, bool)


def _check_value(spec: ParameterSpec, value: Any) -> str | None:  # noqa: PLR0911, PLR0912
    t = spec.type
    if t == "integer":
        if not isinstance(value, int) or isinstance(value, bool):
            return "must be an integer"
    elif t == "number":
        if not _is_number(value):
            return "must be a number"
    elif t == "boolean":
        if not isinstance(value, bool):
            return "must be true or false"
    elif t in ("string", "text"):
        if not isinstance(value, str):
            return "must be a string"
    elif t == "enum":
        allowed = [c.value for c in spec.choices or []]
        if value not in allowed:
            return f"must be one of {allowed}"
    elif t == "vector":
        if not isinstance(value, list) or len(value) != spec.length:
            return f"must be a list of {spec.length} numbers"
        for x in value:
            if spec.integer_vector and (not isinstance(x, int) or isinstance(x, bool)):
                return "entries must be integers"
            if not spec.integer_vector and not _is_number(x):
                return "entries must be numbers"
    if t in ("integer", "number") or (t == "vector" and value):
        numbers = value if isinstance(value, list) else [value]
        for x in numbers:
            if spec.minimum is not None and (
                x < spec.minimum or (spec.exclusive_minimum and x == spec.minimum)
            ):
                return f"must be {'>' if spec.exclusive_minimum else '>='} {spec.minimum}"
            if spec.maximum is not None and x > spec.maximum:
                return f"must be <= {spec.maximum}"
    return None


def validate(schema: ParameterSchema, values: Values) -> ValidationReport:
    """Check types, ranges, enums, required keys and unknown keys. Hidden parameters are skipped."""
    report = ValidationReport()
    known = {p.key for p in schema.parameters()}
    for key in values:
        if key not in known:
            report.issues.append(ValidationIssue(key=key, message="unknown parameter"))
    for spec in schema.parameters():
        if not is_visible(spec, values):
            continue
        if spec.key not in values or values[spec.key] is None:
            if spec.required and spec.default is None:
                report.issues.append(ValidationIssue(key=spec.key, message="required"))
            continue
        issue = _check_value(spec, values[spec.key])
        if issue:
            report.issues.append(ValidationIssue(key=spec.key, message=issue))
    return report
