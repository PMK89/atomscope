# ADR 0002: Technology stack

Status: ACCEPTED

## Context

The mission asks for a modern TypeScript UI, a Python scientific backend built on ASE,
a WebGL2-capable renderer, worker-based computation, and a later desktop distribution.
The workstation offers Python 3.12 (wheels for RDKit, Open Babel, ASE, spglib all available
for cp312), Node 22, pnpm 10 and uv. The prior workbench (React + 3Dmol.js + Plotly, FastAPI)
showed the failure modes to avoid: a 2500-line App component, hand-maintained TS types that
drifted from the backend, and a viewer library that could not do multiple isosurfaces, large
grids or worker-side meshing.

## Decision

Backend (`backend/`): Python 3.12, package `atomscope`.
- pydantic v2 models for every contract and for the on-disk project format (deterministic JSON).
- FastAPI + uvicorn bound to 127.0.0.1 only; WebSocket for job log streaming and events.
- ASE as the interoperability layer; NumPy/SciPy; spglib for symmetry; RDKit for cheminformatics
  (SMILES, hydrogens, 2D->3D); Open Babel for the long tail of file formats and force fields.
- uv for locked, project-local environments (`uv.lock`).

Frontend (`frontend/`): TypeScript strict, React 18, Vite 6, zustand for state, Three.js for the
renderer with our own instanced primitives, Web Workers (comlink) for parsing/meshing, vitest and
Playwright for tests. TypeScript API types are generated from the backend OpenAPI schema
(`make contracts`), never written by hand.

Desktop shell: decided later in a dedicated ADR after the browser-based development stack is solid
(candidates: Electron, Tauri, pywebview; see ADR 0005 when written).

## Alternatives considered

- Qt/PySide desktop app: mature, but conflicts with the JS/TS requirement and the web-first renderer.
- Svelte/Vue: viable; React chosen for ecosystem size and the team's familiarity.
- 3Dmol.js / NGL / Mol*: excellent viewers, but an editor needs full control over picking,
  primitives and volumetric pipelines (ADR 0003).

## Consequences

- Two lockfiles (`backend/uv.lock`, `frontend/pnpm-lock.yaml`) define the reproducible install.
- Contract changes are made in pydantic and propagated by regeneration.
