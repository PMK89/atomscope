# Project state (resume here)

Branch: main; this file is updated in the commit that checkpoints the work, so `git log -1 -- docs/STATE.md` is the last checkpoint. Phases 0-1 done; Phase 2 (editor tools), 3 (volumetric, trajectories, vectors), 4-5 (CP-PAW setup/execution/forces), 6 (CP-PAW analysis: DOS, bands, orbitals), crystallography, molecular mechanics and wavefunction surfaces are merged and working. Parity matrix: 210 IMPLEMENTED, 28 PARTIAL, 73 NOT STARTED, 1 BLOCKED of 312 rows.

Tests: `pytest -q -m "not cppaw"` -> 400 passed, 1 skipped; `pytest -q -m cppaw` -> 7 passed (~90 s, needs the local CP-PAW install); `pnpm vitest run` -> 470 passed; `pnpm exec playwright test` -> 35 passed (against private servers, see below; `make test-e2e` points at the user's 5173, which is stale). **`source env.sh` before Playwright**: without `PLAYWRIGHT_BROWSERS_PATH` it looks in `~/.cache/ms-playwright`, finds nothing, and every test fails at `browserType.launch`. `ruff check`, `mypy` and `pnpm typecheck` are clean. No known failing tests. **Type-check the frontend with `pnpm typecheck` (`tsc -b --noEmit`), never with `pnpm exec tsc --noEmit`:** the root `tsconfig.json` is a solution file with `files: []`, so a bare `tsc --noEmit` checks nothing and exits 0.

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

- Spectra exports (AV-SPEC-001/010, AV-VIB-005, AV-EXPORT-006/008): `spectrumTsv`/`modesTsv` in
  `model/vibration.ts`, and `ui/charts/chartExport.ts`, which serialises any `LineChart` with its
  own style block on white -- the live chart draws with CSS variables, so a plain clone would
  export a colourless plot. PNG goes through an `Image` and a canvas; the raster path was
  checked in a real Chromium (a 2x PNG with ink in it), since jsdom decodes no images.
- Properties tab (AV-ANAL-001/002): molecular weight and the document's attached quantities;
  Open Babel atom types through `POST /api/chem/atom-types` and `state/atomTypeStore.ts`.
  **The rule that shaped it:** a partial charge is a measurement and may sit on the document
  going stale with the geometry, so it is stored in `atomic_scalars`; an atom type is a
  function of the current graph, so a stored one would not be stale but wrong -- it is
  derived per `${doc.id}:${revision}` and never stored. Typing a charge by hand drops
  `properties.dipole_moment`, which was the sum over the charges (editor/edits.ts).
  The IUPAC name is a PubChem lookup on a locally computed InChIKey, on a button.
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
  (a display type and a colour per atom, keyed by uid, with hidden atoms dropped from the meshes,
  the labels, the picking, the ribbon and the hydrogen bonds); the colour maps Avogadro carries as colour plugins -- atom index, distance
  from the first atom, partial charge and a single custom colour; a colour map per engine (the
  ribbon now has its own, next to the structure layer's and each isosurface's); a File > Export
  dialog over every format the backend can write, which refuses to overwrite until asked twice;
  a MOPAC input generator in the qc_inputs plugin; Jmol's three residue palettes (amino, shapely,
  hydrophobicity) for the atoms and the ribbon; the angle and torsion property tables, both
  editable (typing a value turns the far side, and a value inside a ring says it cannot); a
  POV-Ray scene export; pasting a crystal, with the dialog that asks which element each species of
  a VASP 4 POSCAR is; named selections (uid-keyed, listed in the Select menu, cleared when another
  document is loaded); fetch by identifier from RCSB and PubChem, which is the first outbound
  request the backend makes and is bounded as `docs/architecture/security-model.md` now describes;
  a recent-files list in the File menu, kept by the backend so it outlives a project; any
  background colour with View ▸ Centre beside Fit to structure; and bonds as selectable
  primitives, which gave the selection store's long-unused `bonds` set a meaning; and Bohr and
  fractional units in the Cartesian editor.
  Fixes found on the way: Optimize geometry sent valueless force-field
  constraints and was rejected with a 422; `add_hydrogens` dropped every residue of a PDB
  structure; `tsc --noEmit` at the repository root checks nothing (the real check is
  `pnpm typecheck`), which had hidden 37 type errors; depth cueing haloed a transparent image
  export.

## Known problems / open questions

- **The PubChem name lookup has never been exercised against the live service.** PUG REST was
  answering `503 PUGREST.ServerBusy` to everything while it was written (the formula endpoint
  too, so it was load and not the address). The URL follows the same PUG REST base as the
  structure fetch that does work. To check it:

  ```bash
  cd backend && ../.venv/bin/python -c \
    "from atomscope.io.fetch import compound_name; print(compound_name('LFQSCWFLJHTTHZ-UHFFFAOYSA-N'))"
  # expect: ethanol
  ```

  If the answer has a different shape, `compound_name` in `io/fetch.py` takes the first line of
  the TXT body; the tests supply the body themselves and would not notice.

- Tool preferences now live in the browser's `localStorage` under `atomscope.*` (`tools`,
  `dock.tab`). There is no UI to reset them: clear those keys in the browser's devtools. A
  Playwright context is fresh per test, so e2e never sees them; a developer's own browser on 5173
  does. Avogadro's equivalent reset was `--erase-config` (AV-FILE-011, NOT STARTED).

- Playwright's smoke spec is order-coupled: `Save as writes a second structure` needs a project,
  and the project is created by a test in *another* spec file. The full suite passes; running
  `smoke.spec.ts` alone fails that one test with "No project open". Run the whole suite, or create
  a project in the test before fixing it.

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
  `ATOMSCOPE_DATA_DIR=/tmp/atomscope-e2e python -m atomscope.api.server --host 127.0.0.1 --port 8791`,
  `ATOMSCOPE_API_URL=http://127.0.0.1:8791 pnpm dev --host 127.0.0.1 --port 5191`,
  then `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5191 pnpm exec playwright test`.
  Give the private backend a data directory of its own: `env.sh` points `ATOMSCOPE_DATA_DIR` at
  `app-data/`, which is where the recent-files list lives, and `e2e/recent.spec.ts` ends by
  clearing it -- pointed at `app-data/` it would wipe the list the person using Atomscope built up.
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

   Today that prints **9 rows, all PARTIAL** -- no CRITICAL or HIGH row is NOT STARTED, which is
   not the same claim and an earlier version of this file got it wrong. Each of the 9 has a note
   saying which part is missing; they are the honest remaining HIGH work (Set Spacegroup, the Gaussian and GAMESS option dialogs, the wavefunction readers past
   fchk/Molden, frontend plugin registration, modal progress dialogs).
   Run the same awk with `MEDIUM` for what is next: today it lists 41 rows, of which the ones with
   a real workflow behind them are the conformer table (AV-MM-009), per-engine opacity
   (AV-VIS-007/011) and the dipole arrow (AV-ANAL-013, moved back to PARTIAL in this checkpoint:
   the number is shown in the Properties tab, the arrow Avogadro's dipole engine drew is not).

   **The matrix drifts the other way too.** Flipping AV-VIS-042 turned up three rows that were
   done but never flipped (AV-SEL-011 Select residues, AV-SEL-012 Select solvent, AV-VIS-031
   render quality) and one that was more done than it said (AV-VIS-032 depth cueing). A pass over
   all 127 open rows afterwards -- read the description, then one grep for its key noun -- turned
   up nine more: AV-MM-006/007 (the Constraints dialog is the Ignore/Fix UI the notes said was
   missing), AV-UI-020 (`dialogKeys.ts` gives all ten modals Escape), AV-VIS-041 (a tool's
   `overlay()` returns text shapes), AV-FILE-018 (untitled + the format's extension), and
   AV-QM-017, AV-SPEC-005, AV-UI-017, AV-UI-025 to PARTIAL. Before starting anything, read the rows
   of the category you are about to touch: the status column is only as true as the last person's
   bookkeeping, and prose about the matrix is worse -- derive it. Nothing CRITICAL is left open -- the
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
   - Display scope (AV-VIS-029) and the per-atom colours (AV-COLOR-010) are not persisted with the
     project, and both are dropped whenever a document is rebuilt from the backend with a
     different atom count (`Add hydrogens`), because the atom uids they are keyed by are
     regenerated then. The ribbon and hydrogen-bond layers now honour hidden atoms; the
     isosurfaces do not, which is right -- a surface is not made of atoms.
   - `applyPersisted` patches only the keys a project's manifest holds, so a project saved before
     a setting existed keeps whatever the previously open project had -- open one with a custom
     background and then an older project and the background stays. That is the contract for
     every setting added after a project was saved, not new; resetting the store to defaults
     before applying would fix all of them at once.
   - `removeAtoms` now filters the per-atom properties with the atoms, but adding or pasting atoms
     leaves `atomic_scalars`/`atomic_vectors` shorter than the atom list. Every reader checks the
     length, so charges and forces then read as absent rather than as belonging to the wrong atom
     -- honest, but they are silently gone and are still saved with the project.
   - CP-PAW's STRC writer takes only fixed atoms and fixed bond lengths from the constraint list;
     `fix_angle`, `fix_dihedral` and `ignore_atoms` are silently skipped there, and an ignored
     atom has no ASE meaning either (it is an Open Babel notion). Open Babel treats a torsion
     constraint as a restraint: it holds within a few degrees, not exactly.
   - Smaller items: NMR/UV-Vis/CD have parsers and spectrum builders but no route or UI (AV-SPEC-004/006/007); force-field IR intensities are qualitative because topological charge models have no charge flux; `resources` is hard-coded `{cores: 1, mpi: false}` in `CalculationPanel.tsx`, so the CP-PAW MPI path is unreachable from the UI; units render as raw tags; DOS and band results are not reloaded when a project is reopened; calculation renames are silently discarded (no rename endpoint); `ase_builtin` reads an `optimizer` key that its schema does not declare and tags `pressure` as eV rather than eV/A^3; `mode: "diagonalize"` bands still fail on the installed CP-PAW binaries (2025-05-07), which needs a rebuild -- the API now reports that instead of serving the previous run's file.
