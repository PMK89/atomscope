import pytest
from pydantic import ValidationError

from atomscope.schemas import (
    ParameterSchema,
    ParameterSpec,
    Section,
    VisibleWhen,
    defaults,
    is_visible,
    merge_values,
    validate,
)
from atomscope.schemas.engine import Choice
from atomscope.units import Unit


def schema() -> ParameterSchema:
    return ParameterSchema(
        id="demo",
        backend="demo",
        title="Demo",
        sections=[
            Section(
                id="general",
                label="General",
                parameters=[
                    ParameterSpec(
                        key="nstep", label="Steps", type="integer", default=100, minimum=1
                    ),
                    ParameterSpec(
                        key="task",
                        label="Task",
                        type="enum",
                        default="static",
                        choices=[
                            Choice(value="static", label="Static"),
                            Choice(value="relax", label="Relax"),
                        ],
                    ),
                    ParameterSpec(
                        key="fmax",
                        label="Force tolerance",
                        type="number",
                        unit=Unit.EV_PER_ANGSTROM,
                        default=0.05,
                        minimum=0,
                        exclusive_minimum=True,
                        visible_when=[VisibleWhen(key="task", value="relax")],
                    ),
                    ParameterSpec(
                        key="kpts",
                        label="k-points",
                        type="vector",
                        length=3,
                        integer_vector=True,
                        default=[1, 1, 1],
                        minimum=1,
                    ),
                    ParameterSpec(key="title", label="Title", type="string", required=True),
                    ParameterSpec(
                        key="spin", label="Spin polarized", type="boolean", default=False
                    ),
                ],
            )
        ],
    )


def test_defaults_and_merge() -> None:
    s = schema()
    d = defaults(s)
    assert d["nstep"] == 100 and "title" not in d
    merged = merge_values(s, {"nstep": 5}, {"title": "x"})
    assert merged["nstep"] == 5 and merged["title"] == "x" and merged["task"] == "static"


def test_validation_reports() -> None:
    s = schema()
    ok = validate(s, {**defaults(s), "title": "run"})
    assert ok.ok
    bad = validate(s, {"nstep": 0, "task": "md", "kpts": [1, 1], "spin": "yes", "bogus": 1})
    keys = {i.key: i.message for i in bad.errors()}
    assert "nstep" in keys and ">=" in keys["nstep"]
    assert "task" in keys
    assert "kpts" in keys
    assert "spin" in keys
    assert keys["bogus"] == "unknown parameter"
    assert keys["title"] == "required"
    assert not bad.ok


def test_visibility_skips_hidden_parameters() -> None:
    s = schema()
    fmax = s.spec("fmax")
    assert not is_visible(fmax, {"task": "static"})
    assert is_visible(fmax, {"task": "relax"})
    # invalid fmax ignored while hidden, reported when visible
    assert validate(s, {"title": "t", "task": "static", "fmax": -1}).ok
    r = validate(s, {"title": "t", "task": "relax", "fmax": 0})
    assert [i.key for i in r.errors()] == ["fmax"]


def test_schema_integrity_checks() -> None:
    with pytest.raises(ValidationError, match="enum needs choices"):
        ParameterSpec(key="a", label="A", type="enum")
    with pytest.raises(ValidationError, match="default invalid"):
        ParameterSpec(key="a", label="A", type="integer", default=1.5)
    with pytest.raises(ValidationError, match="duplicate"):
        ParameterSchema(
            id="x",
            backend="x",
            title="x",
            sections=[
                Section(
                    id="s",
                    label="s",
                    parameters=[
                        ParameterSpec(key="a", label="A", type="integer"),
                        ParameterSpec(key="a", label="A2", type="integer"),
                    ],
                )
            ],
        )
    with pytest.raises(ValidationError, match="unknown key"):
        ParameterSchema(
            id="x",
            backend="x",
            title="x",
            sections=[
                Section(
                    id="s",
                    label="s",
                    parameters=[
                        ParameterSpec(
                            key="a",
                            label="A",
                            type="integer",
                            visible_when=[VisibleWhen(key="zzz", value=1)],
                        ),
                    ],
                )
            ],
        )


def test_schema_is_json_serializable() -> None:
    s = schema()
    again = ParameterSchema.model_validate_json(s.model_dump_json())
    assert again == s
