# Roadmap

Status legend: DONE / IN PROGRESS / PLANNED. Feature-level parity tracking is in
`docs/avogadro1-feature-parity.md`; this file tracks phases and integration milestones.
Session state, resume commands and known problems are in `docs/STATE.md`.

**Counts are derived, never typed from memory.** At `12a03ac`:
**235 IMPLEMENTED / 16 PARTIAL / 60 NOT STARTED / 1 BLOCKED of 312**, and the only row still open
at HIGH or CRITICAL is AV-SURF-006. Re-derive both before trusting either:

```bash
awk -F'|' 'NR>2 && NF>=13 {print $11}' docs/avogadro1-feature-parity.md | sort | uniq -c
awk -F'|' 'NR>51 && /^\|/ {gsub(/^ +| +$/,"",$2); gsub(/^ +| +$/,"",$7); gsub(/^ +| +$/,"",$11);
  if(($7=="CRITICAL"||$7=="HIGH") && $11!="IMPLEMENTED") print $2, $7, $11}' \
  docs/avogadro1-feature-parity.md
```

Every row ID named below was checked against that file when this was written. A "Remaining"
clause here is a row that really is NOT STARTED or PARTIAL, not one that drifted.

## Phase 0 — Investigation — DONE
Avogadro 1 inventory (312 rows), CP-PAW analysis with smoke tests, ASE/asecppaw analysis,
ADRs 0001-0004.

## Phase 1 — Foundation — DONE
Data model + units, ASE bridge, project store/format, IO registry (ASE/RDKit/Open Babel), schema
engine, JobManager, calculation service, REST/WebSocket API with generated TS types, Three.js
renderer, docks.

## Phase 2 — Molecular editor — DONE (core), IN PROGRESS (breadth)
Tools: navigate, select, draw, manipulate, bond-centric, measure, auto-optimize, auto-rotate;
properties panel with editable bond, angle and torsion tables; constraints dialog; display scope
(a display type per atom); per-atom colour overrides; Cartesian editor; undo/redo; SMILES;
clipboard copy/paste; import/export.
Remaining: Z-matrix tool and editor (AV-EDIT-024), align tool (AV-EDIT-030), the context menu's
per-atom radius and label overrides (AV-EDIT-034 — the colour half, AV-COLOR-010, is done), and
an MMFF94 pre-set for the draw tool's auto-geometry (AV-EDIT-011).

## Phase 3 — Scientific visualization — DONE
Isosurfaces (worker marching cubes, ± lobes, transparency, coloured by a second grid), grid API
and sidecars, trajectory playback, vector/unit-cell/axes/label/ribbon/H-bond layers, colour maps
per engine (element, residue in Jmol's three palettes, chain, secondary structure, index,
distance, partial charge, one colour), rendering quality and depth cueing, image and POV-Ray
export.
Remaining: ring and polygon engines (AV-VIS-021/022), QTAIM engine, per-engine opacity
(AV-VIS-007/011), clipping planes, GPU picking for very large systems, vector-graphics export
(AV-EXPORT-002) and VRML/glTF (AV-EXPORT-004).

## Phase 4 — CP-PAW setup — DONE
Task-oriented schema with course presets, STRC/CNTL generation (validated against the manual),
input preview. Working through the hands-on course exercise by exercise found three things the
schema could not say, all now implemented: `!ISOLATE` for a cell the structure brought (its own
help text admitted the gap), masses per element (`M=5.` on carbon and oxygen is a
Car-Parrinello trick, and only hydrogen's could be set), and `!ORBPOT` — which is what the
antiferromagnet exercise actually needs, not `!OCCUPATIONS!STATE` as this file used to say.
Remaining: inline `!AUGMENT` setups from `setups.rslv`, constraint scans, cell dynamics
(ch. 6.3.5), empty atoms (ch. 6.3.3), raw-deck import with unknown-key validation against
`manual-schema.json`.

## Phase 5 — CP-PAW execution — DONE
Driver with soft stop, staged runs, completion check, libgfortran work-around, failure diagnosis,
fork/restart. Verified against the local install: `pytest -m cppaw` runs the real binaries.
Remaining: MPI (`ppaw_fast.x`), wall-clock limits, remote/HPC runner.

## Phase 6 — CP-PAW analysis — DONE (core)
Energies, forces, geometry, trajectory, density/orbital cubes, eigenvalues/gaps, DOS/PDOS
(`paw_dos.x`), COOP and single-orbital weights in a local frame (`!COOP`, `!ORB` with `NNZ`),
band structure (`paw_bands.x`), orbital browser with on-demand export, convergence plots,
sweeps (`calculations/sweeps.py`, `/api/sweeps`, the Sweeps panel). Periodic grids are rolled onto
their structure, so a molecule at the cell origin is drawn around its atoms rather than at the
corners of the box. A DOS already computed is read back when a project is reopened.
Remaining: `mode: diagonalize` bands fail on the binaries installed here (2025-05-07) and need a
CP-PAW rebuild — the API reports that rather than serving the previous run's file; band results
are still not reloaded on reopening (the DOS now is); `paw_tra` mode extraction (ch. 5.10);
contour/slice plots (ch. 3.4).

## Phase 7 — ASE workflows — DONE (core)
ASE built-in calculators, BFGS/L-BFGS/FIRE, Langevin MD, CP-PAW forces through `CppawCalculator`
(verified), vibrations by finite differences, the Open Babel calculator, and the constraint model
round-tripping through ASE (`FixAtoms`, `FixCartesian`, `FixBondLengths`, `FixInternals`).
Remaining: NEB, and MD in the interactive auto-optimize tool (AV-MM-010 PARTIAL — the backend has
no MD minimizer behind that tool).

## Phase 8 — Avogadro parity expansion — IN PROGRESS
Crystallography, molecular mechanics and builders, biomolecules (residues, ribbons, DSSP,
peptide/DNA builders), spectra (IR/UV/CD), vibrations, symmetry (point groups), the file formats
and the plugin registry (tools, display types, panels, menu items and colour schemes are all
contributions now, with a Plugin manager) are merged.
**Nothing is open at CRITICAL, and one row is open at HIGH:** AV-SURF-006, the OpenQube
wavefunction readers, which stays PARTIAL until a MOPAC `.aux` fixture exists. Everything else
still NOT STARTED is MEDIUM or below — the largest coherent pieces left are Python scripting,
multi-document/multi-view, and QTAIM.

## Phase 9 — Additional backends — DONE (input generation), PLANNED (execution and parsing)
**Every quantum-chemistry input generator Avogadro 1 has is written from its own dialog's
source**, keyword table by keyword table: ORCA and Gaussian, GAMESS-US and GAMESS-UK, NWChem,
Q-Chem, Psi4, Molpro, Dalton, TeraChem, MOPAC, Quantum ESPRESSO and ABINIT. Each row's note names
where our deck departs from Avogadro's and why — every one of those dialogs had at least one box
that reached no keyword, one label that named something the deck did not ask for, or one deck the
program cannot read. The Open Babel force fields are DONE.

Remaining, in the order a next session would take them:

- **AV-QM-014 ABINIT (PARTIAL)** — ours goes through ASE's writer rather than
  `abinitinputdialog.cpp` (1104 lines of cpp / 905 of ui, no tabs). Same shape as the NWChem and
  ORCA rewrites; roughly one session.
- **AV-QM-015 LAMMPS (NOT STARTED)** — `lammpsinputdialog.cpp` is 878/1010, no tabs.
- **AV-QM-004 GAMESS EFP / QM selection (NOT STARTED)** — a selection dialog rather than a deck
  writer, so it belongs with the editor rather than here.
- **More output parsers**: orbital energies and fragments from the ORCA output that already
  yields geometry, normal modes and IR intensities (AV-QM-017 PARTIAL); MOPAC `.aux`, GAMESS and
  Molpro wavefunctions for AV-SURF-006.
- **Execution adapters (ORCA, xTB)** — gated on the binaries, and neither is installed here:
  `/usr/bin/orca` is the GNOME screen reader, and there is no `xtb` on PATH. Until one exists
  there is nothing to test an adapter against, so this stays planned rather than in progress.

## The CP-PAW hands-on course — IN PROGRESS
Chapters 2, 3, 8.2 and 8.5 run end to end and are visualized; 8.3 and 8.4/6.3.6 are running;
chapters 4, 6 and 7 are written and ready. `docs/course/inventory.md` is the map — every exercise,
what shows it, what is missing, and the findings, of which the sharpest are that chapter 2
reproduces the course's published geometry (0.9815 Å / 105.07° against 0.981 / 105.2) and that
chapter 8.5's curve at the course's own cutoff measures the basis set rather than the periodic
images. The document itself is not in this repository and must not be; the inventory says why.

## Phase 10 — Packaging and hardening — IN PROGRESS
Done: the user guide, three tutorials (`docs/tutorials/`), the developer guide, ADRs, the
performance harness (`make bench`, `docs/performance.md`) and the e2e suite.
Remaining: desktop shell ADR (Electron vs Tauri vs pywebview), a reproducible install script
beyond `scripts/bootstrap.sh`, a security review, and CI.
