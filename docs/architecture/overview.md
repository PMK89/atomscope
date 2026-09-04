# System overview

```text
+---------------------------- frontend (browser / desktop shell) ----------------------------+
| React shell: menus, command palette, docks                                                  |
|   Viewport (Three.js renderer, display layers, tools)   Project explorer   Property panel   |
|   Calculation setup (schema-driven forms)  Results/data panel  Job console  Measurements    |
| zustand stores: project, structure (undoable), selection, view, jobs, datasets              |
| Web Workers: file parsing, marching cubes, geometry analysis                                |
+---------------------------------- HTTP + WebSocket (127.0.0.1) ----------------------------+
| FastAPI app (atomscope.api)                                                                 |
|   ProjectService  StructureService  CalculationService  JobManager  DatasetService          |
| atomscope.model  (pydantic scientific data model, units, provenance)                        |
| atomscope.ase_bridge (Atoms <-> Structure, calculators, optimizers, MD, NEB)                |
| atomscope.schemas (parameter schema engine, presets, validation, serialization)             |
| atomscope.backends.* (plugins: cppaw, ase_builtin, orca_input, ...) via entry points        |
| atomscope.jobs (process runner, argv-only, cwd inside project, streaming, cancellation)     |
| atomscope.parsers (cppaw protocol/strc/tra/cube/dx, cube, molden, xyz, ...)                 |
| atomscope.io (file formats via ASE / RDKit / Open Babel with capability discovery)          |
+--------------------------------------------------------------------------------------------+
| Project directory on disk: project.json, structures/, calculations/<id>/{input,work,output} |
+--------------------------------------------------------------------------------------------+
```

## Principles

1. The scientific truth lives in the Python model and on disk; the UI holds a projection of it.
2. Every backend package is a plugin implementing the same small interfaces (schema, input
   generation, runner spec, result parser); CP-PAW is the first and most complete one.
3. Units are explicit in the model (`Quantity`-like fields carry a unit tag); internal storage is
   eV/Å (ASE convention); CP-PAW's Hartree/Bohr are converted at the adapter boundary only.
4. Nothing executes from the UI; the JobManager is the only process spawner.
5. Long-running or large-data operations are asynchronous, cancellable and report progress.

## Directory layout

```text
backend/src/atomscope/
  model/        data model (structure, properties, grids, trajectories, project)
  units.py      unit definitions and conversions
  ase_bridge/   ase.Atoms conversion, calculator adapters, workflows
  schemas/      parameter schema engine
  backends/     plugins (cppaw/, ase_builtin/, ...)
  jobs/         job manager and process runner
  parsers/      file parsers (isolated, pure functions)
  io/           format registry (read/write via ASE, RDKit, Open Babel)
  chem/         chemistry rules (valence, hydrogens, bond perception) used by API only once
  api/          FastAPI routers, schemas, websocket events, OpenAPI export
  cli.py
frontend/src/
  api/          generated types + thin client
  model/        TS mirror helpers for structure snapshots (derived from generated types)
  state/        zustand stores, undo/redo
  renderer/     Three.js renderer, layers, picking, camera
  workers/      parsing, marching cubes
  editor/       interactive tools (draw, select, manipulate, measure, navigate ...)
  ui/           React components by panel
  plugins/      frontend plugin registry (tools, layers, panels)
```
