# Project state (resume here)

Branch: main; this file is updated in the commit that checkpoints the work, so `git log -1 -- docs/STATE.md` is the last checkpoint. Phases 0-1 done; Phase 2 (editor tools), 3 (volumetric, trajectories, vectors), 4-5 (CP-PAW setup/execution/forces), 6 (CP-PAW analysis: DOS, bands, orbitals), crystallography, molecular mechanics and wavefunction surfaces are merged and working. Parity matrix: 180 IMPLEMENTED, 33 PARTIAL, 98 NOT STARTED, 1 BLOCKED of 312 rows.

Tests: `pytest -q -m "not cppaw"` -> 379 passed, 1 skipped; `pytest -q -m cppaw` -> 7 passed (~90 s, needs the local CP-PAW install); `pnpm vitest run` -> 392 passed; `pnpm exec playwright test` -> 26 passed (against private servers, see below; `make test-e2e` points at the user's 5173, which is stale). `ruff check`, `mypy` and `pnpm typecheck` are clean. No known failing tests. **Type-check the frontend with `pnpm typecheck` (`tsc -b --noEmit`), never with `pnpm exec tsc --noEmit`:** the root `tsconfig.json` is a solution file with `files: []`, so a bare `tsc --noEmit` checks nothing and exits 0.

## Resume commands

```bash
cd /home/pmk/Projects/atomscope && source env.sh
git status && git log --oneline | head -20
cat docs/STATE.md ROADMAP.md
make test          # backend pytest + frontend vitest
make lint typecheck
make dev-backend   # 127.0.0.1:8765 ; make dev-frontend -> 127.0.0.1:5173
```

8765 and 5173 are usually already held by the user's own long-running servers (they are stale and
do not reload); starting ours there fails with `address already in use`. For anything that has to
run against current code -- Playwright above all -- use the private-server recipe under
**Known problems**, which binds 8791 and 5191 instead.

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
- This checkpoint (Avogadro parity, editor and rendering): a surface coloured by a second grid with
  a scale symmetric about zero; the Constraints dialog and the model behind it (`fix_angle`,
  `fix_dihedral`, `ignore_atoms`, target values, ASE `FixInternals` round trip); the bond
  properties table (periodic-safe lengths, editable, order select); the Auto-optimize tool
  (`/api/chem/optimize-step` in a loop, drag an atom while it runs, one undo step); residue and
  chain and secondary-structure colour schemes with `Select residues…`/`Select solvent`; the
  Settings dialog (quality, depth cueing, projection, background, backend list); Display scope
  (a display type per atom, keyed by uid, with hidden atoms dropped from the meshes, the labels
  and the picking); the colour maps Avogadro carries as colour plugins -- atom index, distance
  from the first atom, partial charge and a single custom colour; a colour map per engine (the
  ribbon now has its own, next to the structure layer's and each isosurface's); a File > Export
  dialog over every format the backend can write, which refuses to overwrite until asked twice;
  a MOPAC input generator in the qc_inputs plugin; Jmol's three residue palettes (amino, shapely,
  hydrophobicity) for the atoms and the ribbon; the angle and torsion property tables, both
  editable (typing a value turns the far side, and a value inside a ring says it cannot). Fixes found on the way: Optimize geometry sent valueless force-field
  constraints and was rejected with a 422; `add_hydrogens` dropped every residue of a PDB
  structure; `tsc --noEmit` at the repository root checks nothing (the real check is
  `pnpm typecheck`), which had hidden 37 type errors; depth cueing haloed a transparent image
  export.

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
  Playwright needs `PLAYWRIGHT_BROWSERS_PATH=$(pwd)/.playwright-browsers` too (the Makefile exports
  it; a bare `pnpm exec playwright test` looks in ~/.cache and finds nothing).
  Stop them again with `kill $(lsof -ti tcp:8791) $(lsof -ti tcp:5191)` -- never `pkill -f "port 8791"`,
  which matches the invoking shell's own command line and kills it. Both were stopped at the end of
  this checkpoint; nothing of ours is listening.

## Next actions
1. Renderer parity gaps left: ring and polygon engines (AV-VIS-021/022, both LOW) and QTAIM.
   Everything else the renderer owes is done -- cut/copy/paste, the label engine, the Display tab
   (which is where the label content and the selection's own display type are chosen), cartoon and
   ribbon rendering with DSSP, hydrogen bonds, isosurfaces coloured by a second grid, and the
   residue/chain/secondary-structure colour schemes.
2. Rows still PARTIAL worth finishing: MD at 300/600/900 K in the auto-optimize tool (AV-MM-010, the
   backend has no MD minimizer). The colour rows left
   are a SMARTS colour (AV-COLOR-006), a per-atom colour override (AV-COLOR-010) and colours as
   plugins (AV-COLOR-009).
3. What is left at HIGH or CRITICAL, from the matrix itself (an earlier version of this list said
   AV-XTAL-002 was the last HIGH gap; it is MEDIUM -- re-derive the list, do not trust prose):

   ```bash
   awk -F'|' 'NR>51 && /^\|/ {gsub(/^ +| +$/,"",$2); gsub(/^ +| +$/,"",$7); gsub(/^ +| +$/,"",$11);
     if(($7=="CRITICAL"||$7=="HIGH") && $11!="IMPLEMENTED") print $2, $7, $11}' \
     docs/avogadro1-feature-parity.md
   ```

   Today that is one HIGH `NOT STARTED`: a painter abstraction for POV-Ray/VRML export
   (AV-VIS-042), which is renderer architecture rather than a feature. Nothing CRITICAL is left open -- the
   two that were PARTIAL were decided in this checkpoint: AV-MM-002 is the `openbabel_ff` schema
   in the Calculation panel (the menu path shows no modal, which is the only difference) and
   AV-FILE-003 is now the Export dialog. AV-XTAL-003 was decided the same way: Avogadro's
   Show/Hide Editors toggles all of its cell editor docks, which for a tabbed dock is switching
   to the Crystal tab or away. The constraints dialog (AV-MM-005),
   the bond properties table (AV-ANAL-003), the auto-optimize tool (AV-EDIT-031), residue selection
   and colouring (AV-BIO-006), the Settings dialog (AV-UI-012), colour-by-second-cube
   (AV-SURF-013), engine primitive scoping (AV-VIS-029) and the colour maps (AV-COLOR-002/003/
   004/007/008) are done.
4. More wavefunction readers (MOPAC aux, GAMESS, ORCA, Molpro, Slater bases) for AV-SURF-006;
   ORCA/Gaussian/NWChem input-only plugins; desktop shell ADR.
5. Known limits and hand-overs:
   - `applyColors` rewrites every instance colour on every hover change (~300k operations per
     pointer move at 1e5 atoms) and both meshes have `frustumCulled = false`; ASE's CIF reader is
     O(N^2) in `equivalent_sites`; `list_structures` loads every structure; `editor/cartesian.ts`
     is O(N^2) around the fixed helper. All measured, all in `docs/performance.md`.
   - The orbit frame rates in `docs/performance.md` predate the tessellation fix; re-running
     `make test-perf` needs a backend and a frontend dev server of one's own, not the user's.
   - Colouring by secondary structure (like the ribbons) asks the backend for a new DSSP
     assignment on every document revision, so a run of the auto-optimizer costs one DSSP request
     per round next to the optimize-step. Debounce `bioStore.load` if that ever bites.
   - Display scope (AV-VIS-029) is not persisted with the project, and the ribbon and
     hydrogen-bond layers ignore it: a hidden backbone atom still gets its ribbon segment. The
     scope is dropped whenever a document is rebuilt from the backend with a different atom count
     (`Add hydrogens`), because the atom uids it is keyed by are regenerated then.
   - `removeAtoms` now filters the per-atom properties with the atoms, but adding or pasting atoms
     leaves `atomic_scalars`/`atomic_vectors` shorter than the atom list. Every reader checks the
     length, so charges and forces then read as absent rather than as belonging to the wrong atom
     -- honest, but they are silently gone and are still saved with the project.
   - CP-PAW's STRC writer takes only fixed atoms and fixed bond lengths from the constraint list;
     `fix_angle`, `fix_dihedral` and `ignore_atoms` are silently skipped there, and an ignored
     atom has no ASE meaning either (it is an Open Babel notion). Open Babel treats a torsion
     constraint as a restraint: it holds within a few degrees, not exactly.
   - Smaller items: NMR/UV-Vis/CD have parsers and spectrum builders but no route or UI (AV-SPEC-004/006/007); force-field IR intensities are qualitative because topological charge models have no charge flux; `resources` is hard-coded `{cores: 1, mpi: false}` in `CalculationPanel.tsx`, so the CP-PAW MPI path is unreachable from the UI; units render as raw tags; DOS and band results are not reloaded when a project is reopened; calculation renames are silently discarded (no rename endpoint); `ase_builtin` reads an `optimizer` key that its schema does not declare and tags `pressure` as eV rather than eV/A^3; `mode: "diagonalize"` bands still fail on the installed CP-PAW binaries (2025-05-07), which needs a rebuild -- the API now reports that instead of serving the previous run's file.
