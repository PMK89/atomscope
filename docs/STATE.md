# Project state (resume here)

Branch: main. Phases 0-1 done; Phase 2 (editor tools), 3 (volumetric, trajectories, vectors), 4-5 (CP-PAW setup/execution/forces) working; Phase 6 (CP-PAW analysis), crystallography and molecular mechanics in progress on feature branches.

## Resume commands

```bash
cd /home/pmk/Projects/atomscope && source env.sh
git status && git log --oneline | head -20
cat docs/STATE.md ROADMAP.md
make test          # backend pytest + frontend vitest
make lint typecheck
make dev-backend   # 127.0.0.1:8765 ; make dev-frontend -> 127.0.0.1:5173
```

## Completed
- Repository, licensing ADR (GPL-3.0-or-later provisional), provenance, toolchain (uv venv Python 3.12, pnpm store in-project).
- Investigation reports: `docs/avogadro1-feature-parity.md` (312 rows), `docs/ase-analysis.md`, `docs/cppaw-analysis.md` (1.7k lines, smoke-tested).
- Backend plugins: contract + registry; ASE built-in plugin (EMT/LJ/Morse, relax, MD) and the CP-PAW plugin (schema, STRC/CNTL generation, driver with soft stop, protocol/trajectory/cube parsing) — a real si2 run passes end-to-end in the test suite (`-m cppaw`).
- Schema engine, JobManager (streaming, cancellation), calculation service, REST + WebSocket API.
- Frontend: menubar, project panel, schema-driven calculation form, generated-input preview, results tab, job console; Playwright e2e smoke tests with project-local Chromium.
- Backend: data model (Structure/Atom/Bond/Cell, constraints, grids, trajectories, vibrations), units, ASE bridge (lossless), project store, API skeleton (project + structures), IO registry (ASE/RDKit/Open Babel, SMILES), bond perception, CP-PAW deck syntax parser/writer, protocol parser, cube reader/writer, golden fixtures from local CP-PAW smoke runs.
- Frontend: Vite/React/TS strict scaffold, generated OpenAPI types + client, normalized structure model, undoable store, selection store, Three.js renderer (instanced atoms/bonds, trackball camera, ortho/perspective, picking), Viewport, element data generated from ASE.

- Merged feature branches: volumetric (marching cubes worker, isosurfaces, grid API), trajectory (playback, vector/unit-cell/axes layers), editor tools (draw/select/manipulate/bond-centric/measure/auto-rotate, properties panel, Cartesian editor).
- CP-PAW: two-stage force evaluation, ASE CppawCalculator (BFGS with CP-PAW forces verified), fork/restart-from-parent, driver with soft stop and completion check; Codex review findings addressed (docs/reviews-codex-cppaw-2026-09-05.md).
- Worktrees in flight (agents): feat/crystallography, feat/molecular-mechanics, feat/cppaw-analysis; Codex frontend review running (.scratch/review/codex_frontend_review.md).

## Known problems / open questions
- Installed `/usr/bin/avogadro` is Avogadro 2; live Avogadro 1 comparison BLOCKED (source tree is the reference).
- pnpm wrote to the global store `~/.local/share/pnpm/store` once before `.npmrc` was placed in `frontend/`; nothing else outside PROJECT_ROOT was modified. Not deleted (outside boundary).
- CP-PAW total-density cube integrates to ~42.6 e for water (expected ~8-10): normalization of paw_wave "total" density still unexplained.
- Installed CP-PAW binaries need `LD_LIBRARY_PATH` to a libgfortran 13 (auto-detected in conda pkgs); a rebuild with the one-character `paw_trace.f90` fix is the permanent remedy (patched tree prepared in `.scratch/cppaw/build/cp-paw`, not built).
- `ase-cp-paw` declares MIT but has no LICENSE file (author = project owner).

## Next actions
1. Merge feat/crystallography, feat/molecular-mechanics, feat/cppaw-analysis when their agents finish (resolve shared-file conflicts: App.tsx, RightDock.tsx, MenuBar.tsx, styles.css, client.ts, app.py, contracts regenerate).
2. Act on the Codex frontend review; CP-PAW !OCCUPATIONS!STATE support (AFM), MPI runs, presets UI, view-settings persistence, PCA default camera.
3. Additional backends: ORCA/Gaussian/NWChem input generation via ASE calculators (input-only plugins); vibrations/spectra; biomolecule rendering (ribbons); desktop shell ADR.
4. Parity matrix updates; performance profiling with large systems; user documentation and tutorials.
