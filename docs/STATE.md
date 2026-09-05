# Project state (resume here)

Branch: main; this file is updated in the commit that checkpoints the work, so `git log -1 -- docs/STATE.md` is the last checkpoint. Phases 0-1 done; Phase 2 (editor tools), 3 (volumetric, trajectories, vectors), 4-5 (CP-PAW setup/execution/forces), 6 (CP-PAW analysis: DOS, bands, orbitals), crystallography, molecular mechanics and wavefunction surfaces are merged and working. Parity matrix: 161 IMPLEMENTED, 38 PARTIAL, 112 NOT STARTED, 1 BLOCKED of 312 rows.

Tests: `pytest -q -m "not cppaw"` -> 351 passed, 1 skipped; `pytest -q -m cppaw` -> 7 passed (~90 s, needs the local CP-PAW install); `pnpm vitest run` -> 229 passed; `make test-e2e` -> 8 passed. `ruff check`, `mypy` and `tsc --noEmit` are clean. No known failing tests.

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
- Merged: crystallography (cells, symmetry via spglib, builders, library), molecular mechanics (Open Babel forcefields, hydrogens, pH, properties), CP-PAW analysis (DOS, band structure, orbital export, convergence charts in the Analysis panel).
- Wavefunction surfaces (`atomscope.wavefunction`): Gaussian fchk and Molden readers (SP shells, 6D/5D, 10F/7F, gzip), contracted Gaussian evaluation with solid harmonics, molecular orbital / density / spin density / electrostatic potential / van der Waals fields, `POST /api/wavefunction/{load,surface}`, and the "Create surfaces" panel in the frontend. Validated as physics: MO overlap = identity, densities integrate to the electron count.

- Merged: vibrations and spectra (mass-weighted Hessian over any ASE calculator, IR intensities, Gaussian/Lorentzian broadening, Gaussian/ORCA/Q-Chem/JCAMP-DX/Turbomole parsers, Spectra dock panel with mode animation); 14 frontend review findings (periodic bond perception, marching-cubes budget, ARIA menus and dock tabs, undo during a preview gesture); molecular point groups and SMARTS selection with their UI; user guide, three tutorials, developer guide and README.
- Merged: performance (117-case backend benchmark harness, a Playwright renderer harness and the
  fixes they justified -- KD-tree bond perception, single-pass project JSON, O(1) atom placement --
  written up in `docs/performance.md`); the renderer now picks its sphere tessellation from the
  atom count.
- Chemistry, building and the remaining spectra reached the UI: Extensions menu, Build > Insert
  dialogs, NMR/UV-Vis/CD. No agent worktrees are open; `git worktree list` shows only main.

## Known problems / open questions
- Installed `/usr/bin/avogadro` is Avogadro 2; live Avogadro 1 comparison BLOCKED (source tree is the reference).
- pnpm wrote to the global store `~/.local/share/pnpm/store` once before `.npmrc` was placed in `frontend/`; nothing else outside PROJECT_ROOT was modified. Not deleted (outside boundary).
- Installed CP-PAW binaries need `LD_LIBRARY_PATH` to a libgfortran 13 (auto-detected in conda pkgs); a rebuild with the one-character `paw_trace.f90` fix is the permanent remedy (patched tree prepared in `.scratch/cppaw/build/cp-paw`, not built).
- `ase-cp-paw` declares MIT but has no LICENSE file (author = project owner).
- Hydrogen bonds are found without a minimum-image convention, so one across a periodic boundary
  is missed (AV-VIS-020's note says so).
- `backend/pyproject.toml` sets `--basetemp=../.scratch/pytest`, which is relative to the working
  directory: run pytest from `backend/`, as the Makefile does. From the repository root it resolves
  outside PROJECT_ROOT and every tmp_path test errors out.
- The dev servers on 127.0.0.1:8765/5173 are not ours and do not reload, so they serve whatever
  routes existed when they were started. E2E tests that need a new route want private servers:
  `python -m atomscope.api.server --host 127.0.0.1 --port 8791`, `ATOMSCOPE_API_URL=http://127.0.0.1:8791 pnpm dev --host 127.0.0.1 --port 5191`,
  then `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5191 pnpm exec playwright test`.

## Next actions
1. Remaining renderer parity gaps: ring and polygon engines (AV-VIS-021/022, both LOW) and QTAIM.
   Cut/copy/paste, the label engine, the Display tab, cartoon/ribbon rendering with DSSP detection
   and hydrogen-bond display are done. The label engine and the Display tab are done; the Display tab is where the label
   content is chosen (the View menu only switches labels on) and it can give the selection its own
   display type, which is what AV-VIS-001's "restricted to primitives" asks for.
2. UI gaps recorded as PARTIAL: Extensions menu for the chem operations that only have API routes (add/remove hydrogens, pH, invert chirality, H->methyl, partial charges, Copy as SMILES/InChI), fragment/peptide/DNA/nanotube insert dialogs, Auto-Optimization tool, image export, constraints dialog.
3. Remaining HIGH parity gaps outside the renderer: colour-by-second-cube (AV-SURF-013), residue-based selection and colouring (AV-BIO-006), paste of crystal text with an identity mapping dialog (AV-XTAL-002).
4. More wavefunction readers (MOPAC aux, GAMESS, ORCA, Molpro, Slater bases) for AV-SURF-006; ORCA/Gaussian/NWChem input-only plugins; desktop shell ADR.
5. Known limits and hand-overs:
   - `applyColors` rewrites every instance colour on every hover change (~300k operations per
     pointer move at 1e5 atoms) and both meshes have `frustumCulled = false`; ASE's CIF reader is
     O(N^2) in `equivalent_sites`; `list_structures` loads every structure; `editor/cartesian.ts`
     is O(N^2) around the fixed helper. All measured, all in `docs/performance.md`.
   - The orbit frame rates in `docs/performance.md` predate the tessellation fix; re-running
     `make test-perf` needs a backend and a frontend dev server of one's own, not the user's.
   - Smaller items: NMR/UV-Vis/CD have parsers and spectrum builders but no route or UI (AV-SPEC-004/006/007); force-field IR intensities are qualitative because topological charge models have no charge flux; `resources` is hard-coded `{cores: 1, mpi: false}` in `CalculationPanel.tsx`, so the CP-PAW MPI path is unreachable from the UI; units render as raw tags; DOS and band results are not reloaded when a project is reopened; calculation renames are silently discarded (no rename endpoint); `ase_builtin` reads an `optimizer` key that its schema does not declare and tags `pressure` as eV rather than eV/A^3; `mode: "diagonalize"` bands still fail on the installed CP-PAW binaries (2025-05-07), which needs a rebuild -- the API now reports that instead of serving the previous run's file.
