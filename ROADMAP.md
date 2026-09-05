# Roadmap

Status legend: DONE / IN PROGRESS / PLANNED. Feature-level parity tracking is in
`docs/avogadro1-feature-parity.md`; this file tracks phases and integration milestones.

## Phase 0 — Investigation — DONE
Avogadro 1 inventory (312 rows), CP-PAW analysis with smoke tests, ASE/asecppaw analysis, ADRs 0001-0004.

## Phase 1 — Foundation — DONE
Data model + units, ASE bridge, project store/format, IO registry (ASE/RDKit/Open Babel), schema engine,
JobManager, calculation service, REST/WebSocket API with generated TS types, Three.js renderer, docks.

## Phase 2 — Molecular editor — DONE (core), IN PROGRESS (breadth)
Tools: navigate, select, draw, manipulate, bond-centric, measure, auto-rotate; properties panel; Cartesian
editor; undo/redo; SMILES; import/export. Remaining: bond-angle adjustment, Z-matrix editor, clipboard
copy/paste of structures, custom atom colors/radii, label rendering.

## Phase 3 — Scientific visualization — DONE (core)
Isosurfaces (worker marching cubes, ± lobes, transparency), grid API and sidecars, trajectory playback,
vector/unit-cell/axes layers. Remaining: labels layer, ribbons/cartoons, H-bond layer, color-by-property,
screenshot/POV-Ray export, clipping planes, GPU picking for very large systems.

## Phase 4 — CP-PAW setup — DONE
Task-oriented schema with course presets, STRC/CNTL generation (validated against the manual), input preview.
Remaining: `!OCCUPATIONS!STATE` (antiferromagnets), inline `!AUGMENT` setups from `setups.rslv`, constraint scans,
raw-deck import with unknown-key validation against `manual-schema.json`.

## Phase 5 — CP-PAW execution — DONE
Driver with soft stop, staged runs, completion check, libgfortran work-around, failure diagnosis, fork/restart.
Remaining: MPI (`ppaw_fast.x`), wall-clock limits, remote/HPC runner.

## Phase 6 — CP-PAW analysis — IN PROGRESS (feat/cppaw-analysis)
Energies, forces, geometry, trajectory, density/orbital cubes, eigenvalues/gaps DONE. DOS/PDOS (`paw_dos.x`),
band structure (`paw_bands.x`), orbital browser with on-demand export, convergence plots IN PROGRESS.

## Phase 7 — ASE workflows — DONE (core)
ASE built-in calculators, BFGS/L-BFGS/FIRE, Langevin MD, CP-PAW forces through `CppawCalculator` (verified).
Remaining: NEB, constraints in ASE runs, vibrations (finite differences), Open Babel calculator (feat/molecular-mechanics).

## Phase 8 — Avogadro parity expansion — IN PROGRESS
Crystallography (feat/crystallography), molecular mechanics + builders (feat/molecular-mechanics), then
biomolecules (residues, ribbons, peptide/DNA builders), spectra (IR/DOS/UV plots), vibrations (modes from
CP-PAW/ORCA outputs), symmetry (point groups), QTAIM-style analysis, remaining file formats.

## Phase 9 — Additional backends — IN PROGRESS
`qc_inputs` (ORCA, Gaussian, NWChem, GAMESS-US, Quantum ESPRESSO, ABINIT input generation) DONE;
Open Babel force fields IN PROGRESS. Planned: ORCA/xTB execution adapters when binaries exist, output parsers
(ORCA/Gaussian via ASE + cclib-style readers).

## Phase 10 — Packaging and hardening — PLANNED
Desktop shell ADR (Electron vs Tauri vs pywebview), reproducible install script, performance profiling with
large systems, security review, tutorials and user documentation, CI.
