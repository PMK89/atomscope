# Calculation schemas ("input masks")

Module: `atomscope.schemas.engine`. A backend plugin publishes a `ParameterSchema`: sections of
`ParameterSpec`s. Everything is data, so the same React form renderer serves every backend.

| Concept | Field(s) | Purpose |
|---|---|---|
| type | `integer, number, boolean, string, text, enum, vector` | drives the widget and type validation |
| unit | `Unit` tag | shown in the form; conversion to backend units happens in the plugin |
| range | `minimum`, `maximum`, `exclusive_minimum` | validation for numbers and vector entries |
| choices | `choices: [{value,label,help}]` | enums (e.g. XC functional) |
| default | `default` | validated against the spec at schema-load time |
| dependency | `visible_when: [{key, op, value}]` | conditional visibility; hidden parameters are not validated and not emitted |
| classification | `advanced`, `group`, section `advanced` | basic/advanced UI split |
| documentation | `help`, `reference` | tooltip and manual pointer |
| backend mapping | `backend_path` | where the value goes (e.g. `CONTROL/GENERIC/NSTEP`) |

Operations: `defaults(schema)`, `merge_values(schema, preset, edits)`, `validate(schema, values)`
returning a `ValidationReport` (errors and warnings keyed by parameter), `is_visible(spec, values)`.
Presets are partial value dictionaries with a `schema_id`.

Plugins additionally implement semantic validation that needs the structure (e.g. "k-points
require a periodic cell") in `BackendPlugin.validate`, returning the same `ValidationReport`.

Reproducibility: the calculation record stores the full merged value dictionary and the schema
version, plus the generated input text. Reopening a calculation restores the form from the stored
values; regenerating the input from them must yield byte-identical files (tested).
