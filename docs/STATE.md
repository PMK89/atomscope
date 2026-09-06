# Project state (resume here)

Branch: main; this file is updated in the commit that checkpoints the work, so `git log -1 -- docs/STATE.md` is the last checkpoint. Phases 0-1 done; Phase 2 (editor tools), 3 (volumetric, trajectories, vectors), 4-5 (CP-PAW setup/execution/forces), 6 (CP-PAW analysis: DOS, bands, orbitals), crystallography, molecular mechanics and wavefunction surfaces are merged and working. Parity matrix: 218 IMPLEMENTED, 20 PARTIAL, 73 NOT STARTED, 1 BLOCKED of 312 rows.

Tests: `pytest -q -m "not cppaw"` -> 475 passed, 1 skipped; `pytest -q -m cppaw` -> 7 passed (~90 s, needs the local CP-PAW install); `pnpm vitest run` -> 496 passed; `pnpm exec playwright test` -> 38 passed in 54 s at `ee4149c` (against private servers, see below; `make test-e2e` points at the user's 5173, which is stale). **`source env.sh` before Playwright**: without `PLAYWRIGHT_BROWSERS_PATH` it looks in `~/.cache/ms-playwright`, finds nothing, and every test fails at `browserType.launch`. `ruff check`, `mypy` and `pnpm typecheck` are clean. No known failing tests. **Type-check the frontend with `pnpm typecheck` (`tsc -b --noEmit`), never with `pnpm exec tsc --noEmit`:** the root `tsconfig.json` is a solution file with `files: []`, so a bare `tsc --noEmit` checks nothing and exits 0.

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
- The dipole arrow (AV-ANAL-013): `renderer/layers/DipoleLayer.ts` draws one arrow from
  `model/dipole.ts`'s `dipoleFromCharges`, recomputed every rebuild from the charges and the
  current positions -- derived, never stored, which is also what Avogadro did. Always the
  estimate from the charges: the QC output importer keeps only the magnitude of a computed
  dipole, and keeping the vector is the follow-up. Physics sign (negative toward positive), as
  the backend's `Dipole.vector` reports; anchored at the centroid; 1 A/Debye by default where
  the reference drew 3. `properties["dipole_moment"]` has two writers with different units
  (Debye from chem/properties.py, e*A from io/qc_outputs.py) -- fine today because the Quantity
  carries its unit, but not a key to read blind.
- The Cartesian editor's Format and Sort boxes (AV-EDIT-023): seven column layouts written,
  and read back by shape rather than by the box -- element first (symbol, `C1`, name or atomic
  number) then three numbers, a GAMESS charge column recognised by equalling that element's
  atomic number, Turbomole's trailing symbol and Priroda's leading number by position, and
  anything past the coordinates ignored so an extxyz line reads. Sorting is an edit:
  `reorderAtoms` (editor/edits.ts) permutes the atoms and renumbers the bonds, per-atom
  properties, constraints and residues with them, and the panel renumbers the selection.
  Avogadro sorted its text and rebuilt the molecule from it on Apply, ending in ConnectTheDots
  + PerceiveBondOrders, so its bonds came back from the distances rather than surviving.
- Set space group (AV-XTAL-015): `GET /api/crystal/spacegroups` is spglib's whole database, all
  530 settings, and `POST /api/crystal/fill` takes `hall_number` beside the ITA `spacegroup`.
  The Hall path applies `spglib.get_symmetry_from_database` itself because ASE's `crystal` knows
  only origin/cell choices -- ITA 3's unique-axis settings cannot be said through it, and the
  test asserts the three fill differently. The chosen setting lives in `crystalStore`, not on the
  document (a filled cell's group is a function of its atoms; a stored assertion would be a
  second truth), keyed by document id the way `symmetry` is keyed by revision -- asserted state
  that outlives what it was asserted about is the same bug in another place. Avogadro's dialog is 530 rows, not the 230 the matrix's description claimed --
  corrected in the same commit.
- A file drawn in two dimensions is offered a rough geometry on import (AV-MM-013): the offer
  is made in `frontend/src/ui/buildGeometry.ts`, on the one path File > Open, Open Recent and a
  dropped file share, and `POST /api/chem/generate-3d` builds it exactly as the reference did
  (OBBuilder, AddHydrogens, MMFF94 with a UFF fallback, 250 conjugate-gradient steps).
  Flatness is decided from the coordinates, in the frontend only -- the backend deliberately has
  no second copy of the predicate to drift from it. The build is one undo step and
  Build > Generate 3D coordinates repeats it while the document is still flat (the builder
  discards the coordinates it is given, so offering it on a geometry would replace one).
  `ob.StereoFrom2D` runs before the build, without which every double bond comes out trans.
  Not covered: a molfile pasted with Ctrl+V, which is a fragment insertion, not a document open. RDKit cannot serve this
  path: `structure_to_mol` sets `NoImplicit`, so `AddHs` adds nothing to a structure that came
  through it.
- Long field evaluations are tasks (AV-UI-022): `POST /api/wavefunction/surface` returns a
  token and computes in a worker thread, `GET`/`cancel` follow and stop it, and
  `EvaluationHooks` (wavefunction/cubes.py) is checked once per chunk of grid points so a
  cancel ends the arithmetic. Two things a background task has to get right and this one
  first did not: it must catch everything (`except Exception`, including the write of the
  dataset, since there is no caller to raise to -- anything else leaves a task reading
  "running" forever and a Cancel button that lies), and a field assembled from two others
  must share one run of the bar (`EvaluationHooks.part`). The vibrational Hessian is the
  other synchronous long one and would take the same shape.
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

- Wavefunction readers, as far as the Avogadro corpus can validate them: Gaussian fchk, Molden
  (with the coefficient convention measured, not assumed), GAMESS-US logs, ORCA output (checked
  coefficient by coefficient against the Molden file `orca_2mkl` wrote from the same job) and
  Molpro output (checked on methane's four equivalent bonds, which is what a permuted basis
  breaks and orthonormality does not).
- Quantum input generators: the Gaussian dialog's whole option set (AV-QM-002, including
  `chem/zmatrix.py`, which belongs to no one program) and the GAMESS-US dialog's, all twelve
  tabs of it (AV-QM-003).

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

- **ORCA writes Molden files in a different coefficient convention, and the reader now measures
  which one a file uses.** Molden's specification says the contraction coefficients are for
  *normalized* primitives; `orca_2mkl` writes them for unnormalized ones, folding the primitive's
  own normalization in (a single-primitive s shell comes out as 0.36 where the specification says
  1). Read as the specification says, the shells are the wrong shape and each is still normalized
  afterwards, so nothing looks wrong until the orbitals are integrated: they came back at 0.82.
  `gto.with_normalized_primitives` tells the two apart by measuring, two ways that have to
  agree before anything is divided out: every conforming shell's self-overlap is 1.000 (the ORCA
  file's run from 0.11 to 7.35), and an uncontracted s or p shell is written as 1 under the
  specification and as N(alpha) by ORCA. The self-overlap test alone has a false positive -- a
  conforming file whose *contractions* are not normalized, i.e. coefficients copied out of a
  basis-set library, which Molden itself renormalizes on read -- and the second test is what
  keeps that file from being mangled the way ORCA's were. No such file is in the corpus (there
  are only two Molden files in it, and they are the two fixtures), so that case is tested from a
  handmade file. The measured convention rides in `wavefunction.metadata` and reaches the
  surfaces panel, so a reader that transforms the numbers it was given says that it did. Ruled
  out on the way, so nobody repeats it: it is not
  quadrature (converged over spacing 0.18 to 0.08 and padding 5 to 12 A), not the primitive
  normalization on its own (dropping `contraction_norm` gives 6.3), and not a dropped or
  misparsed coefficient (all 246 per orbital are read, and match the file).

- One flaky Playwright test, seen three times: `Export writes a file on this machine` failed in
  three runs that each took 1.9 minutes, all started in the same shell command as the dev server
  and a few seconds after it. Every time it has failed on the *second* Save click, the one that
  should raise `exists already`, and every time the same test has passed on its own straight
  afterwards and in the immediately following full run (50 s); giving the servers twenty seconds before starting is the first thing to have avoided it rather than survived it. The full suite takes ~50 s otherwise, and it passes there -- including
  a deliberate cold run with `node_modules/.vite` deleted, which finished in 53 s with all 37
  green, so it is machine load rather than a cold cache. Give the servers time to settle before
  running the suite; if it fails in a *fast* run, that is new and its timeouts are the place to
  look.

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
   ribbon rendering with DSSP, hydrogen bonds, isosurfaces coloured by a second grid, the
   residue/chain/secondary-structure colour schemes, and the dipole arrow.
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

   Today that prints **3 rows, all PARTIAL** -- no CRITICAL or HIGH row is NOT STARTED, which is
   not the same claim and an earlier version of this file got it wrong. They are two pieces of
   work, not three. AV-QM-003, the GAMESS-US dialog, closed at `77ac8c9` with all twelve of its
   tabs ported (`backends/qc_inputs/gamess.py`, one `Section` per tab in `qc_inputs/plugin.py`);
   the row's note records every departure from Avogadro's writers and why, with line numbers,
   which is where to start if a deck ever looks wrong.

   - **AV-SURF-006** -- the OpenQube reader family. fchk, Molden, GAMESS-US, ORCA output and
     Molpro output are read: every reader the Avogadro corpus can validate. MOPAC's `.aux` is
     Slater-type and needs a second `basis_values` in `gto.py` -- that one is a subsystem, and
     the row cannot reach IMPLEMENTED without it.
   - **AV-PLUG-001 / AV-PLUG-002** -- frontend plugin registration. The backend has a plugin
     contract and a registry; the frontend does not, and giving it one touches the renderer, the
     tool host and the dock. The biggest of the four, and the one to plan before starting.

   **The reader family is finished as far as the corpus can take it.** Molpro was the last file
   in it; GAMESS-UK and MOPAC have none, so neither could be validated the way the other five
   were, and writing an unvalidatable reader is how a silently wrong permutation gets shipped.
   The whole wavefunction inventory, checked file by file: `koffein_orca.{out,molden}` (both
   read, and read against each other), `benzene.{fchk,mold}`, `{d,f}-only.{fchk,gamess,g09}`,
   `c60.fchk.gz`, `CO-cc-6Z.fchk.gz`, `NH3.fchk`, `methane.FChk`, `methane.mpo` (**Molpro**, not
   MOPAC, despite sitting in the row's Test column next to a MOPAC reader) and three AIM `.wfn`
   files that no OpenQube reader ever read. To go further someone has to bring a file: a MOPAC
   `.aux`, a GAMESS-UK output, a generally contracted Molpro output (cc-pVDZ), a Molpro output
   run with point-group symmetry -- Molpro's default, and refused today because a symmetry-adapted
   basis function is a combination over equivalent centres rather than one function on one atom --
   or any Molpro output with a d shell -- `molpro.cpp:296` reorders d5 components,
   `methane.mpo` is 1s/2px/2py/2pz throughout, and so that path is ordered by the names Molpro
   prints with its phase convention untested.

   So: **the GAMESS-US Advanced tabs are next** if you want that row finished, and then plan the
   plugin rows deliberately rather than starting them late in a session. MOPAC's Slater basis is what keeps AV-SURF-006 PARTIAL
   either way.

   `chem/zmatrix.py` arrived with the Gaussian deck and is not Gaussian's: any generator that
   offers internal coordinates can use it, and AV-QM-007 (MOPAC) says "no Z-matrix output" for
   a reason that no longer holds.

   Run the same awk with `MEDIUM` for what is next there: today it lists 40 rows, 11 of them
   PARTIAL. The ones with a real workflow behind them are the conformer table (AV-MM-009), the
   per-engine opacity rows (AV-VIS-007/011), label font and offset (AV-VIS-017), orbital surface
   settings (AV-SURF-008) and the Project Tree dock (AV-UI-010).

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
