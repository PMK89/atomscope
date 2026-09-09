# Atomscope developer guide

How the repository is laid out, how to build and test it, and how to add the
four things people most often want to add: a computational backend, a file
format, a display layer and an editor tool.

The companion documents are `docs/architecture/` (one page per subsystem, the
*why*), `docs/decisions/` (ADRs), `docs/cppaw-analysis.md` (the CP-PAW input
schema and its traps, 1.7k lines) and `docs/avogadro1-feature-parity.md` (the
312-row parity matrix).

Contents:

1. [Repository layout](#1-repository-layout)
2. [Toolchain](#2-toolchain)
3. [Typed contracts](#3-typed-contracts)
4. [Adding a backend plugin](#4-adding-a-backend-plugin)
5. [Adding a file format](#5-adding-a-file-format)
6. [Adding a display layer](#6-adding-a-display-layer)
7. [Adding an editor tool](#7-adding-an-editor-tool)
8. [Testing strategy](#8-testing-strategy)
9. [Review and parity workflow](#9-review-and-parity-workflow)
10. [House rules](#10-house-rules)

---

## 1. Repository layout

```
backend/
  pyproject.toml            package metadata, dependencies, ruff/mypy/pytest config
  src/atomscope/
    model/                  pydantic data model: Structure, Atom, Bond, Cell, constraints,
                            VolumetricGrid, Trajectory, VibrationalMode, Spectrum, Provenance
    units.py                unit tags and conversions (constants come from ase.units)
    ase_bridge/             Structure <-> ase.Atoms, CppawCalculator, OpenBabel calculator
    schemas/engine.py       the parameter-schema engine (types, validation, visibility, presets)
    backends/               plugins: base.py (the contract), registry.py, cppaw/, ase_builtin/,
                            openbabel_ff/, qc_inputs/
    jobs/                   JobManager: the only component that spawns processes
    calculations/           CalculationService: create -> generate -> run -> collect
    parsers/                pure file parsers (cube; CP-PAW's live in backends/cppaw/)
    io/                     format registry (ASE / RDKit / Open Babel), trajectories, QC logs
    chem/                   bond perception, hydrogens, force fields, charges, identifiers, edits
    crystal/                cell operations, spglib symmetry, supercell/slab builders, CIF library
    build/                  fragment, peptide, nucleic-acid and carbon-nanostructure builders
    project/                ProjectStore and ProjectManifest — the only writer of project files
    api/                    FastAPI routers, request/response schemas, WebSocket, OpenAPI export
    data/                   redistributed data: crystals/ (507 CIF), fragments/ (382 CML)
    cli.py                  `atomscope serve`
  tests/                    mirrors src/ one-to-one, plus fixtures/
frontend/
  src/
    api/                    openapi.json + generated schema.d.ts + a thin fetch client
    model/                  normalized structure document, element data (generated), geometry
    state/                  zustand stores: structure (undoable), selection, view, project,
                            calculations, trajectory, volumetric, crystal
    renderer/               Three.js: Renderer, CameraController, layers/, marching cubes, math
    editor/                 Tool.ts, ToolHost.ts, tools/, valence, measure, cartesian, edits
    ui/                     React components: MenuBar, Viewport, RightDock, panels, forms, charts
    workers/                the marching-cubes Web Worker
  e2e/                      Playwright specs (smoke, calculation, surfaces)
  playwright.config.ts, vite.config.ts, eslint.config.js
docs/                       architecture/, decisions/, tutorials/, this guide, the parity matrix
scripts/                    bootstrap.sh, parity_status.py, gen_element_data.py,
                            dev_restart_backend.sh
Makefile, env.sh            developer commands and the cache-containment rules
```

Two structural rules are worth stating because they explain many decisions:

* **`atomscope.model` is the vocabulary.** Backends, parsers and the API all
  speak it; nothing backend-specific escapes a plugin. That is why the frontend
  never needs a CP-PAW-shaped type.
* **The backend owns the science, the frontend owns the interaction.** React
  components contain no chemistry. A deliberately small subset is duplicated in
  TypeScript so that drawing does not need a round trip —
  `model/connectivity.ts` (same distance rule as `atomscope.chem.bonds`:
  bonded when *d* < 1.15 (r_i + r_j) with Cordero radii) and `editor/valence.ts`
  (a small valence table with template hydrogen placement). Anything beyond
  that — aromaticity, force fields, pH models — stays on the backend.

There is no `tests/` directory at the repository root, despite what a couple of
older documents say; all Python tests live in `backend/tests/`.

## 2. Toolchain

### Cache containment

`env.sh` is not optional politeness — it is the rule that nothing this project
does installs outside its own checkout:

```bash
source env.sh
```

sets `PROJECT_ROOT`, `UV_CACHE_DIR=$PROJECT_ROOT/.uv-cache`,
`UV_PROJECT_ENVIRONMENT=$PROJECT_ROOT/.venv`, `UV_PYTHON_PREFERENCE=only-system`,
`npm_config_cache=$PROJECT_ROOT/.npm-cache`,
`PLAYWRIGHT_BROWSERS_PATH=$PROJECT_ROOT/.playwright-browsers` and
`ATOMSCOPE_DATA_DIR=$PROJECT_ROOT/app-data`. `frontend/.npmrc` pins the pnpm
store to `$PROJECT_ROOT/.pnpm-store`. The `Makefile` exports the same variables
itself, so `make` works without sourcing anything.

### Setup

```bash
./scripts/bootstrap.sh
```

does `uv sync --extra dev` (backend, Python 3.12), `pnpm install
--frozen-lockfile` (frontend), `pnpm exec playwright install chromium`
(optional — a failure here is tolerated and reported) and finally checks
whether a CP-PAW installation is visible. Verified end to end on a fresh
worktree; it exits 0 and prints

```
== CP-PAW
paw_fast.x found; the plugin probes the runtime at first launch
done. Run: make dev-backend  and  make dev-frontend
```

### `make` targets

| Target | What it runs |
|---|---|
| `make setup` | `backend-sync` + `frontend-install` |
| `make dev-backend` | `python -m atomscope.api.server --host 127.0.0.1 --port 8765` |
| `make dev-frontend` | `pnpm dev` (Vite on 127.0.0.1:5173, proxying `/api`) |
| `make test` | `test-backend` + `test-frontend` |
| `make test-backend` | `pytest -q` in `backend/` — **includes** the `cppaw`-marked tests |
| `make test-frontend` | `pnpm test` (vitest, single run) |
| `make test-e2e` | `pnpm exec playwright test` — needs both dev servers running |
| `make lint` | `ruff check` + `ruff format --check`, then `eslint` |
| `make typecheck` | `mypy` (strict), then `tsc -b --noEmit` |
| `make contracts` | regenerate `openapi.json` and `schema.d.ts` (see §3) |

Reference timings on the project workstation (Intel i7-6800K, 12 threads):

```
make test-backend    242 passed, 1 skipped in 153 s   (2:33; the 7 cppaw tests dominate)
pytest -m "not cppaw"  235 passed, 1 skipped, 7 deselected in 20 s
pytest -m cppaw        7 passed in 104 s
make test-frontend   121 tests in 20 files in 5 s
mypy                 no issues in 150 source files
```

To run a second instance next to a running one — which is what you want when
you are working on the frontend while somebody else's session is open:

```bash
cd backend  && PYTHONPATH=$PWD/src python -m atomscope.api.server --port 8770
cd frontend && ATOMSCOPE_API_URL=http://127.0.0.1:8770 pnpm dev --port 5178
```

`ATOMSCOPE_API_URL` is read by `vite.config.ts` and used as the proxy target.

### CI

`.github/workflows/ci.yml` has two jobs. The backend job runs
`ruff check src tests`, `ruff format --check src tests`, `mypy` and
`pytest -q -m "not cppaw"` (CP-PAW is not installed on runners). The frontend
job runs `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Run the same
commands locally before pushing; `make lint typecheck test` is close enough,
with the one difference that `make test-backend` also runs the `cppaw` tests.

## 3. Typed contracts

The frontend contains **no hand-written backend types**. The chain is:

```
pydantic models  ->  FastAPI OpenAPI document  ->  openapi-typescript  ->  schema.d.ts
                                                                       ->  api/client.ts
```

`make contracts` runs it:

```bash
cd backend  && python -m atomscope.api.export_openapi ../frontend/src/api/openapi.json
cd frontend && pnpm exec openapi-typescript src/api/openapi.json -o src/api/schema.d.ts
```

`export_openapi.py` dumps `create_app().openapi()` with `indent=2,
sort_keys=True` and a trailing newline, so the file is stable across runs.

> **Run `pnpm exec prettier --write src/api/` afterwards.** The committed files
> are Prettier-formatted; without that step `git diff` shows thousands of
> whitespace-only changes and you cannot see what actually moved. The correct
> check for "are the contracts current?" is:
> ```bash
> make contracts && cd frontend && pnpm exec prettier --write src/api/ && cd .. && git diff --stat frontend/src/api/
> ```
> An empty diff means they are.

`api/client.ts` derives every exported type from `components['schemas'][...]`,
so a renamed or retyped backend field turns into a TypeScript error rather than
a runtime surprise. Changing a response model is therefore a two-commit-message
kind of change: edit the pydantic model, regenerate, fix the compile errors.

## 4. Adding a backend plugin

### The contract

`backend/src/atomscope/backends/base.py`:

```python
@runtime_checkable
class BackendPlugin(Protocol):
    id: str
    name: str
    capabilities: BackendCapabilities

    def schema(self) -> ParameterSchema: ...
    def presets(self) -> list[Preset]: ...
    def discover_executables(self) -> ExecutableReport: ...
    def validate(self, structure: Structure, values: Values) -> ValidationReport: ...
    def generate_inputs(self, structure: Structure, values: Values,
                        root_name: str) -> GeneratedInputs: ...
    def run_spec(self, input_dir: Path, work_dir: Path,
                 generated: GeneratedInputs, resources: Resources) -> RunSpec: ...
    def parse_results(self, work_dir: Path,
                      generated: GeneratedInputs) -> ResultBundle: ...
```

`BackendCapabilities` carries `energy, forces, stress, relaxation,
molecular_dynamics, orbitals, density, dos, bands, vibrations` (all default
`False`), `periodic`/`molecular` (default `True`) and `executes` (default
`True`; set it to `False` for an input-generator, and the service will refuse
to run it).

Five further hooks are **optional** and looked up with `getattr`. Only the
CP-PAW plugin implements them today:

| Hook | Used for |
|---|---|
| `restart_values(values) -> Values` | rewrite parameters for a restart |
| `restart_files(generated) -> Sequence[str]` | glob patterns copied from the parent's `work/` |
| `analysis_run_spec(work_dir, kind, options) -> RunSpec` | post-processing jobs (DOS, bands, orbital export) |
| `analysis_collect(work_dir, kind, options) -> list[VolumetricGrid]` | grids produced by such a job |
| `diagnose_failure(work_dir, root_name) -> str \| None` | a human explanation appended to `job.error` |

### Registration

`backends/registry.py` builds the default registry from an explicit list plus
Python entry points:

```python
def default_registry() -> BackendRegistry:
    reg = BackendRegistry()
    reg.register(ase_plugin)        # atomscope.backends.ase_builtin
    reg.register(openbabel_plugin)  # atomscope.backends.openbabel_ff
    reg.register(qc_plugin)         # atomscope.backends.qc_inputs
    reg.load_entry_points()
    return reg
```

`load_entry_points()` iterates the `atomscope.backends` entry-point group. A
plugin that fails to import is recorded in `registry.load_errors` and skipped —
**a broken third-party plugin must never take the application down**. A plugin
whose id is already registered is skipped silently.

CP-PAW itself arrives through the entry point rather than the explicit list, so
it doubles as the reference for out-of-tree plugins:

```toml
[project.entry-points."atomscope.backends"]
cppaw = "atomscope.backends.cppaw:plugin"
```

Expose a module-level object called `plugin`, declare the entry point, install
the package into the same environment, and it appears in `GET /api/backends`.

### Worked example: `qc_inputs`, the smallest plugin

`backends/qc_inputs/plugin.py` is 387 lines and does one thing: turn a
structure plus a handful of parameters into a ready-to-run deck for someone
else's program. It is the best template for a new plugin because it exercises
every part of the contract except execution.

**1. The schema is a module-level constant.**

```python
SCHEMA = ParameterSchema(
    id="qc_inputs", backend="qc_inputs", title="Quantum chemistry input generator",
    sections=[
        Section(id="program", label="Program", parameters=[
            ParameterSpec(key="program", label="Program", type="enum", default="orca",
                          choices=[Choice(value="orca", label="ORCA"), ...]),
            ParameterSpec(key="method", label="Method / functional", type="string",
                          default="B3LYP", help="e.g. HF, B3LYP, PBE, MP2, CCSD(T)",
                          visible_when=[VisibleWhen(key="program", op="in",
                                                    value=list(MOLECULAR))]),
            ...
        ]),
        Section(id="planewave", label="Plane-wave settings", parameters=[...]),
    ],
)
```

Things to get right here, because the whole UI follows from them:

* `label` is what the user reads; `key` is what you read.
* `unit` is a `Unit` tag; the form shows it and *you* convert in the plugin.
* `visible_when` conditions are ANDed. Hidden parameters are neither validated
  nor emitted, which is how one schema serves six programs.
* `advanced=True` on a spec or a whole section puts it behind the
  *Show advanced options* checkbox.
* A non-`None` `default` is validated against its own spec at construction
  time, so a typo fails at import, not at runtime.
* `backend_path` (e.g. `"CONTROL/GENERIC/NSTEP"`) documents where the value
  ends up. Nothing enforces it — it is for the reader and for the docs — but
  keeping it accurate is what makes CP-PAW's form readable next to its manual.

**2. Capabilities and executables.**

```python
capabilities = BackendCapabilities(energy=True, forces=True, relaxation=True,
                                   vibrations=True, executes=False)

def discover_executables(self) -> ExecutableReport:
    return ExecutableReport(available=True, executables={},
        messages=["input generation only; run the deck with the target program"])
```

**3. Validation adds what the generic engine cannot know.** Call the engine
first, then append domain issues:

```python
def validate(self, structure, values):
    v = merge_values(SCHEMA, values)
    report = validate(SCHEMA, v)
    if not structure.atoms:
        report.issues.append(ValidationIssue(key=None, message="structure has no atoms",
                                             severity="error"))
    if v["program"] in PERIODIC and structure.cell is None:
        report.issues.append(ValidationIssue(key="program",
            message="plane-wave codes need a periodic cell", severity="warning"))
    return report
```

Errors block generation; warnings do not. Prefer a warning whenever the user
might legitimately know better.

**4. `generate_inputs` must be deterministic.** `qc_inputs` converts the
structure to `ase.Atoms`, clears `atoms.info`, and lets an ASE writer produce
the text:

```python
def generate_inputs(self, structure, values, root_name):
    ...
    text = _write(atoms, fmt, **kwargs)          # ase.io writer into a StringIO
    return GeneratedInputs(files=[GeneratedFile(name=f"{root_name}.inp", text=text)],
                           root_name=root_name,
                           summary=f"{program} {task} input for {structure.formula()}")
```

`root_name` is always `"case"` in practice. Roles are `input`, `structure`,
`control` or `script`; the *Generated input* tab shows them next to the file
name. The same values must always give byte-identical files — that is a tested
property, and it is what makes a stored calculation reproducible.

**5. `run_spec` for a non-executing plugin just refuses.**

```python
def run_spec(self, *_args, **_kwargs) -> RunSpec:
    raise RuntimeError("this backend only generates input files; "
                       "run them with the target program")
```

The service checks `capabilities.executes` before it ever gets here, so this is
belt and braces.

**6. `parse_results` returns an honest empty bundle.**

```python
def parse_results(self, work_dir, generated) -> ResultBundle:
    return ResultBundle(warnings=["input-generation-only backend: no results"])
```

### Executing plugins

An executing plugin differs in three places.

`discover_executables` looks for real programs and reports what it found. Copy
the pattern in `backends/cppaw/settings.py`: search `$ATOMSCOPE_<CODE>_DIR`,
then a conventional environment variable, then a conventional home directory,
then `PATH`; return absolute paths; put anything the user should know into
`messages`. CP-PAW additionally runs a ~0.2 s probe and, if the binaries abort
because of a `libgfortran` mismatch, finds a compatible runtime and remembers
it — a good example of turning an environment problem into a warning rather
than a mystery.

`run_spec` returns a `RunSpec`, and **that is all it does** — plugins never
spawn processes:

```python
RunSpec(argv=[exe, "case.cntl"],          # argv[0] must be an absolute executable
        cwd=work_dir,                      # must exist
        env={"LD_LIBRARY_PATH": ...},      # added to a minimal base environment
        stdout_name="driver.log", stderr_name="driver.err",
        watch_files=["case.prot"],         # tailed and streamed like stdout
        soft_stop_seconds=120.0)           # how long SIGTERM is given to work
```

The `JobManager` validates `argv[0]`, runs with `shell=False`,
`start_new_session=True`, stdin closed and an explicit environment (only
`PATH, HOME, LANG, LC_ALL, TMPDIR, USER` plus what you add), streams stdout,
stderr and every `watch_files` entry line by line, and on cancel walks the
ladder SIGTERM → (after `soft_stop_seconds`) SIGTERM to the process group →
(after 5 s) SIGKILL.

If your program needs anything more than "start it and wait", **write a driver
module** rather than complicating the manager. `backends/cppaw/runner.py` is
the pattern: a small `python -m ...` entry point that runs the real binary and
adds exactly four things — a soft stop (turn SIGTERM into CP-PAW's `ROOT.exit`
file so it finishes its step and writes a restart file), multi-stage runs, a
completion check that is stricter than the exit code (CP-PAW must print
`PROGRAM FINISHED`), and post-processing (converting `.wv` files to cubes with
`paw_wave.x`). It prints `[atomscope] …` status lines that the job console
shows, and it validates every file name it is handed against
`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`.

`parse_results` converts the working directory into a `ResultBundle`:
`final_structure`, `properties` (a dict of `Quantity`), `trajectory`, `grids`,
`series` (for the convergence charts), `converged`, `complete` (the program's
*own* normal-termination marker), `warnings` and a free-form `extra`. Two rules
from `docs/architecture/output-parsing.md` are non-negotiable:

* **Missing data is `None`, never zero.** CP-PAW prints forces only when the
  atoms are propagated; an earlier integration silently produced zero forces
  and "converged" at step 0. `AtomListReport.has_forces` exists because of
  that bug.
* **Units are converted once, at the adapter boundary.** Parsers return the
  file's native units and say so in the field name (`energy_h`,
  `force_mh_per_bohr`); the plugin converts to eV/Å.

### Checklist

- [ ] `plugin.py` with a module-level `plugin` object and a `[project.entry-points."atomscope.backends"]` line
- [ ] a `ParameterSchema` with labels, units, ranges, help and `backend_path`
- [ ] presets for the two or three setups people actually use
- [ ] `validate` with the structural checks the engine cannot make
- [ ] deterministic `generate_inputs` (there is a test for this)
- [ ] `run_spec` only; a driver module if the process needs supervision
- [ ] `parse_results` returning model types only
- [ ] tests: schema defaults validate, golden input generation, a parser test
      against a real output fixture, and — if you have the program —
      one end-to-end test behind a marker

## 5. Adding a file format

`io/registry.py` holds `_FORMATS`, an **ordered** list of `FormatInfo`; the
first entry matching an extension wins.

```python
FormatInfo("cml", ("cml",), "Chemical Markup Language",
           can_read=True, can_write=True, library="openbabel", has_bonds=True)
```

* `library` is one of `ase`, `rdkit`, `openbabel`. Choose ASE when positions
  and cells are what matter and its reader is lossless, RDKit when bond orders
  and chemical perception matter, Open Babel for the long tail. `has_bonds` and
  `has_cell` are advisory flags reported by `GET /api/io/formats`.
* For an ASE format, `_ASE_NAME` maps the Atomscope id to ASE's own name when
  they differ (`pdb → proteindatabank`, `orca-out → orca-output`). Nothing else
  is needed: `read`/`write` dispatch on `library`.
* For RDKit or Open Babel, add the branch in `io/rdkit_io.py` or
  `io/openbabel_io.py`.
* Readers must return a `Structure` **with bonds** — from the file if it has
  them, otherwise perceived. The registry does the perception for you when
  `structure.bonds` is empty.
* Stamp `Provenance(source=str(path), notes=f"read as {info.name}")`.
* `structure_to_string` (used by `POST /api/io/export` with no `path`) only
  supports the ASE-backed formats; RDKit/Open Babel formats must be written to
  a file.

Multi-frame formats go through `io/trajectory_io.py` instead, which reads
anything ASE can read with `index=":"` and requires the composition to be
identical across frames. Writing trajectories is extended-XYZ only.

Register the format, add a round-trip test in `backend/tests/io/test_registry.py`
and, if the frontend should offer it in the `File` menu, add the menu item —
`GET /api/io/formats` already reports it either way.

The plugin system reserves the entry-point groups `atomscope.formats` and
`atomscope.analyses` for out-of-tree readers and analysis providers; only
`atomscope.backends` is wired up today.

## 6. Adding a display layer

A layer is a plain class implementing `renderer/layers/Layer.ts`:

```ts
export interface DisplayLayer {
  readonly id: string;
  readonly object: THREE.Object3D;
  visible: boolean;
  update(ctx: LayerContext): void;
  dispose(): void;
}
```

`LayerContext` carries an immutable structure snapshot, its `revision`, the
selection set and the hovered atom. `LayerContext` also carries optional
`positionsOverride` / `cellOverride` — display-only geometry used by trajectory
playback, which layers must honour while keeping topology and colours from
`structure`. A layer that needs a second render pass with its own camera (the
axes gizmo) implements the optional `renderOverlay(gl, camera)`.

`update()` is called on every relevant
change, so **compare the revision and your own settings and return early** —
`StructureLayer` rebuilds geometry only when the revision changes and recolours
cheaply otherwise. Nothing in `renderer/` may import React or a store.

The existing layers are `StructureLayer` (instanced atom spheres, bonds as two
half-cylinders coloured by their atoms), `UnitCellLayer`, `AxesLayer`,
`VectorLayer` and `IsosurfaceLayer`.

Wire a new layer up in `ui/viewportLayers.ts`, which is the one place that
installs layers into the renderer and pushes view-store settings into them. If
the layer needs a user-visible toggle, add it to `state/viewStore.ts` — boolean
and numeric fields there are persisted with the project automatically by
`state/viewSettingsSync.ts` (arrays and strings currently are not, which is why
`cellRepeat` and `vectorField` do not survive a reopen).

Volumetric work belongs in a Web Worker: `workers/marchingCubes.worker.ts` runs
the mesher and transfers the output buffers back.

Tool feedback does **not** belong in a layer. Overlays (rubber band, measurement
markers, bond labels) are returned by the tool as shapes in canvas pixels and
drawn by the SVG layer `ui/ViewportOverlay.tsx`.

## 7. Adding an editor tool

A tool is a class implementing `editor/Tool.ts`, driven by `editor/ToolHost.ts`,
which binds canvas events, keyboard and hover, and hands the tool a
`ToolRenderer` façade (pick, project, unproject-on-a-plane, a camera subset).
That façade is why tools are unit-testable against a fake renderer with no
WebGL context — see `editor/tools.test.ts`.

```ts
export class MyTool implements Tool {
  readonly id = 'my-tool';                       // must be added to the ToolId union
  readonly label = 'My tool';
  readonly icon = '✧';                           // glyph on the toolbar button
  readonly shortcut = 'X';                       // single key, no modifier
  readonly description = 'What the toolbar tooltip says.';

  // every handler is optional
  onPointerDown?(e: PointerLike, ctx: ToolContext): void { ... }
  onPointerMove?(e: PointerLike, ctx: ToolContext): void { ... }
  onPointerUp?(e: PointerLike, ctx: ToolContext): void { ... }
  onDoubleClick?(e: PointerLike, ctx: ToolContext): void { ... }
  onKeyDown?(e: KeyLike, ctx: ToolContext): boolean { return false; }   // true = consumed
  overlay?(ctx: ToolContext): OverlayShape[] { return []; }
  activate?(ctx: ToolContext): void { ... }
  deactivate?(ctx: ToolContext): void { ... }
}
```

Note that events are the DOM-free `PointerLike` / `WheelLike` / `KeyLike`
structures, not real DOM events — that is what makes tools testable without a
browser. Overlay shapes are `line`, `rect`, `marker` or `label`, in CSS pixels
relative to the canvas.

Two edits are needed besides the class: extend the `ToolId` union in
`editor/Tool.ts` (it is a closed union, deliberately — the tool set is a
product decision), and register the tool in `editor/tools/index.ts`
(`createTools()`), which is the single source of truth for the tool bar's
order, icons and shortcut letters. There is no general frontend plugin registry
yet; `docs/architecture/plugin-system.md` describes one as a plan, not as
code.

Three conventions matter:

1. **One gesture, one undo step.** During a drag call
   `structureStore.preview(doc)` for live feedback and
   `structureStore.commit(label, doc)` exactly once on pointer-up. The label is
   what the `Edit` menu shows (`Undo Rotate 3 atoms`), so write it for a user.
   Cancel with `cancelPreview()` if the drag is abandoned or shorter than the
   3 px threshold.
2. **Camera or tool, not both.** `ToolHost.enter()` enables the
   `CameraController` only for the tools in `CAMERA_TOOLS`
   (`navigate`, `auto-rotate`). Everything else owns its drags. The wheel is
   always the camera's.
3. **Settings live in `editor/toolStore.ts`** and are rendered by
   `ui/ToolSettings.tsx`; the tool reads them through the context rather than
   holding React state.

If the tool needs a shortcut letter, check `ToolHost.keyDown` for a free one —
`N S D M B R A` are taken, and the handler ignores keys pressed with a modifier
or while an editable element has focus.

## 8. Testing strategy

Five layers, in increasing cost.

**Unit tests** — pure functions and small classes. Python:
`backend/tests/` mirrors `backend/src/atomscope/` one-to-one (`model/`,
`schemas/`, `chem/`, `crystal/`, `io/`, `parsers/`, `jobs/`, `project/`).
TypeScript: `*.test.ts` next to the source, run by vitest with jsdom
(`marchingCubes`, `principalAxes`, `scale`, `valence`, the stores, and the
tools against a fake renderer).

**Golden fixtures** — `backend/tests/fixtures/` holds real program output,
produced once on this workstation and treated as immutable:

```
fixtures/cppaw/si2/         wave-function optimization of the distribution example
fixtures/cppaw/si2_rdyn/    the same with !RDYN, so ATOMLIST carries FORCE columns
fixtures/cppaw/h2o/         protocol, trajectory, pdos, strc_out, density cube (gzipped)
fixtures/cppaw/h2o_dos/     paw_dos.x output plus the .dprot with the Fermi level
fixtures/qc_outputs/        Gaussian and NWChem logs (from Avogadro 1's testfiles/)
```

`fixtures/cppaw/README.md` records exactly how each was made. Parser tests
compare against numbers read by hand out of those files, with tolerances that
match the printed precision. **Regenerate them only deliberately** — a changed
fixture is a changed reference, not a passing test.

**API contract tests** — `backend/tests/api/` drives the FastAPI app with
`httpx` through complete flows (create a project, put a structure, create,
validate, generate, run and collect a calculation, import a cube, ask for a
band path). These are what catch a route that silently changed shape, and they
run in seconds because they use the cheap backends.

**`cppaw`-marked tests** — the ones that run the real executable. They are
declared in `pyproject.toml`:

```toml
markers = ["cppaw: runs the real CP-PAW executable (slow; skipped when unavailable)"]
```

There are 7 of them and they take about 100 s together:

```
tests/api/test_cppaw_analysis_api.py::test_cppaw_analysis_tools_over_api
tests/api/test_cppaw_api.py::test_cppaw_calculation_over_api
tests/ase_bridge/test_cppaw_calculator.py::test_cppaw_calculator_energy_forces_and_restart
tests/backends/ase_builtin/test_plugin.py::test_ase_bfgs_drives_cppaw
tests/backends/cppaw/test_plugin.py::test_real_si2_run
tests/backends/cppaw/test_plugin.py::test_real_forces_task_through_driver
tests/backends/cppaw/test_plugin.py::test_real_parallel_run
```

They skip themselves when CP-PAW is not installed, and CI deselects them
explicitly with `-m "not cppaw"`. Run them before touching anything in
`backends/cppaw/`:

```bash
cd backend && python -m pytest -q -m cppaw
```

**Playwright end-to-end** — `frontend/e2e/` has thirteen specs. They drive a
real browser against real servers, so `make dev-backend` and `make dev-frontend`
must be running, and they use `workers: 1, fullyParallel: false` because the
backend holds one project at a time. `PLAYWRIGHT_BASE_URL` points them at a
different frontend. Most specs create their project in a temporary directory
under `.scratch/`; `surfaces.spec.ts` writes into `frontend/test-results/`,
which is currently **tracked in git**, so running the suite dirties the working
tree — check out that directory again before committing.

Five of the thirteen are out of the default suite, because they are slow, they
photograph something, or they need a project the default suite does not build
(`OUT_OF_SUITE` in `playwright.config.ts`). Three selections exist:

| Command | Specs | Count |
| --- | --- | --- |
| `pnpm exec playwright test` | the other eight | 40, ~57 s |
| `ATOMSCOPE_COURSE=1 pnpm exec playwright test` | `course-visual`, `database`, `neb`, `vibrations` | 13, ~40 s |
| `ATOMSCOPE_PERF=1 pnpm exec playwright test` | `perf` | see [`performance.md`](performance.md) |

`source env.sh` first, always: without `PLAYWRIGHT_BROWSERS_PATH` the launcher
looks in `~/.cache/ms-playwright`, finds nothing, and every test fails at
`browserType.launch`. `course-visual.spec.ts` writes its pictures to
`.scratch/course-shots/` and reads the course project under
`.scratch/course-runs/`.

`neb.spec.ts` **requires** `.scratch/neb-proj` and *skips itself* when it is
missing, so a lost scratch directory turns it into a test that quietly stops
testing. Rebuild it with

```bash
cd backend && ../.venv/bin/python ../scripts/make_neb_project.py
```

which relaxes both ends of ASE's own NEB tutorial system (Au hopping between
hollow sites on Al(100), EMT) and saves them as the two structures the spec
picks by name.

Two practices that are not optional in this repository:

* **A bug becomes a test.** Findings from the archived reviews
  (`docs/reviews-codex-*.md`) are expected to come with a regression test; the
  zero-forces trap and the `PROGRAM FINISHED` completion check are both encoded
  in tests.
* **Determinism is a tested property**, not an aspiration: input generation is
  compared byte for byte, and JSON serialization uses sorted keys.

## 9. Review and parity workflow

### The parity matrix

`docs/avogadro1-feature-parity.md` is a 312-row inventory of Avogadro 1.2's
user-visible features, each with an id (`AV-EDIT-001`), a category, a
description, the evidence in the Avogadro source tree, an importance, the
expected behaviour, the suggested Atomscope component, a test strategy, a
status and notes. It is the acceptance list for "is this finished?" and the
place to look before designing a feature — Avogadro usually has an answer
already, and the evidence column points at the exact file and line.

Statuses are `NOT STARTED`, `PARTIAL`, `IMPLEMENTED`, `VERIFIED`, `BLOCKED`.
Update them with the script rather than by hand, so the table stays
machine-parsable:

```bash
.venv/bin/python scripts/parity_status.py \
    AV-VIS-002=IMPLEMENTED \
    AV-SEL-001=PARTIAL \
    'AV-EDIT-005=IMPLEMENTED::periodic table popup in the Draw tool settings'
```

The `::note` suffix appends to the Notes column. The script rewrites only the
status and notes cells of matching rows and prints how many it changed.

> The matrix currently **lags the code** — many features that are implemented
> and shipping are still marked `NOT STARTED`. Treat it as the target list and
> the evidence base; for "what works today", read the code, the tests and
> `docs/user-guide.md`. Bringing the statuses up to date is an open task, and
> the discipline that keeps it useful is to update a row in the same commit
> that implements it.

### Reviews

External reviews are archived under `docs/reviews-*.md` with their findings and
what was done about each one (`docs/reviews-codex-cppaw-2026-09-05.md`,
`docs/reviews-codex-frontend-2026-09-05.md`). The pattern is: record the
finding, fix it, add a regression test, and correct any *documentation* the
review showed to be wrong — several architecture claims were rewritten because
a review found them aspirational rather than true.

### Provenance

`docs/provenance.md` records every file or idea taken from outside the
repository, and `THIRD_PARTY_LICENSES.md` records everything redistributed
inside it. Anything copied in — a data file, a fixture, an algorithm read out
of someone else's source — gets a row before it gets a commit. Atomscope is
GPL-3.0-or-later; the Avogadro 1 material it reuses is GPL-2.0-or-later, which
is why the reuse is data, not code.

### Architecture decisions

Non-obvious choices go into `docs/decisions/` as short ADRs
(license, technology stack, renderer foundation, typed contracts, desktop
shell). Write one when a decision would otherwise have to be re-litigated in
six months.

## 10. House rules

* **Nothing installs globally.** See §2. If a tool insists on a global cache,
  configure it or do not use it.
* **Only `atomscope.jobs` spawns processes.** argv arrays, `shell=False`,
  absolute validated executables, an explicit environment, a cwd inside the
  project.
* **Only `atomscope.project.store` writes project files.** Paths from clients
  are resolved and checked with `is_relative_to(root)`; ids must match
  `^[A-Za-z0-9_-]{1,64}$`.
* **Input decks and imported files are data.** They are parsed, never executed,
  never interpolated into a command line.
* **The API binds to loopback only** and there is no authentication yet; a
  per-launch bearer token is planned (see
  `docs/architecture/security-model.md`).
* **`mypy --strict` passes** for the whole backend. ASE ships no annotations,
  so the modules that call into it relax `disallow_untyped_calls` — and only
  that — through per-module overrides in `pyproject.toml`.
* **Ruff with `E F I B UP N W ANN S PL`**, line length 100. `S101` (assert) is
  ignored because tests use it.
* **The frontend is TypeScript strict**, no `any`, and ESLint's React-hooks
  rules are on.
* **Commit messages describe the change, not the file list**, and a commit that
  fixes a review finding says which one.
