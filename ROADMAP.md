# Roadmap

Status legend: DONE / IN PROGRESS / PLANNED. Feature-level parity tracking is in
`docs/avogadro1-feature-parity.md`; this file tracks phases and integration milestones.

## Phase 0 — Investigation — DONE
Avogadro 1 inventory (312 rows), CP-PAW analysis with smoke tests, ASE/asecppaw analysis, ADRs 0001-0004.

## Phase 1 — Foundation — DONE
Data model + units, ASE bridge, project store/format, IO registry (ASE/RDKit/Open Babel), schema engine,
JobManager, calculation service, REST/WebSocket API with generated TS types, Three.js renderer, docks.

## Phase 2 — Molecular editor — DONE (core), IN PROGRESS (breadth)
Tools: navigate, select, draw, manipulate, bond-centric, measure, auto-optimize, auto-rotate; properties panel
with editable bond, angle and torsion tables; constraints dialog; display scope (a display type per atom);
Cartesian editor; undo/redo; SMILES; clipboard copy/paste; import/export. Remaining: Z-matrix tool and editor
(AV-EDIT-024), align tool (AV-EDIT-030), per-atom colour/radius/label overrides (AV-EDIT-034, AV-COLOR-010),
MMFF94 pre-set for the draw tool's auto-geometry (AV-EDIT-011).

## Phase 3 — Scientific visualization — DONE
Isosurfaces (worker marching cubes, ± lobes, transparency, coloured by a second grid), grid API and sidecars,
trajectory playback, vector/unit-cell/axes/label/ribbon/H-bond layers, colour maps per engine (element,
residue in Jmol's three palettes, chain, secondary structure, index, distance, partial charge, one colour),
rendering quality and depth cueing, image and POV-Ray export. Remaining: ring and polygon engines
(AV-VIS-021/022), QTAIM engine, per-engine opacity (AV-VIS-007/011), clipping planes, GPU picking for very
large systems, vector-graphics export (AV-EXPORT-002) and VRML/glTF (AV-EXPORT-004).

## Phase 4 — CP-PAW setup — DONE
Task-oriented schema with course presets, STRC/CNTL generation (validated against the manual), input preview.
Remaining: `!OCCUPATIONS!STATE` (antiferromagnets), inline `!AUGMENT` setups from `setups.rslv`, constraint scans,
raw-deck import with unknown-key validation against `manual-schema.json`.

## Phase 5 — CP-PAW execution — DONE
Driver with soft stop, staged runs, completion check, libgfortran work-around, failure diagnosis, fork/restart.
Remaining: MPI (`ppaw_fast.x`), wall-clock limits, remote/HPC runner.

## Phase 6 — CP-PAW analysis — DONE (core)
Energies, forces, geometry, trajectory, density/orbital cubes, eigenvalues/gaps, DOS/PDOS (`paw_dos.x`),
band structure (`paw_bands.x`), orbital browser with on-demand export, convergence plots. Remaining:
`mode: diagonalize` bands need a CP-PAW rebuild (see docs/STATE.md), and DOS/band results are not reloaded
when a project is reopened.

## Phase 7 — ASE workflows — DONE (core)
ASE built-in calculators, BFGS/L-BFGS/FIRE, Langevin MD, CP-PAW forces through `CppawCalculator` (verified),
vibrations by finite differences, the Open Babel calculator, and the constraint model round-tripping through
ASE (`FixAtoms`, `FixCartesian`, `FixBondLengths`, `FixInternals`). Remaining: NEB, MD in the interactive
auto-optimize tool (AV-MM-010, the backend has no MD minimizer).

## Phase 8 — Avogadro parity expansion — IN PROGRESS
Crystallography, molecular mechanics and builders, biomolecules (residues, ribbons, DSSP, peptide/DNA
builders), spectra (IR/UV/CD), vibrations, symmetry (point groups) and the file formats are merged.
**No CRITICAL or HIGH row is NOT STARTED**, and 5 HIGH rows are PARTIAL — each note says which
part is missing (the Gaussian and GAMESS option dialogs, the remaining wavefunction readers,
and the two frontend plugin-registration rows). Counts: 216 IMPLEMENTED, 22 PARTIAL, 73 NOT STARTED, 1 BLOCKED of 312 — re-derive
with the awk in `docs/STATE.md`, do not trust this number. The NOT STARTED work is MEDIUM and below:
Python scripting and the plugin manager, multi-document/multi-view, QTAIM.

## Phase 9 — Additional backends — IN PROGRESS
`qc_inputs` (ORCA, Gaussian, NWChem, GAMESS-US, MOPAC, Quantum ESPRESSO, ABINIT input generation) and the
Open Babel force fields are DONE. An ORCA output already loads its geometry, normal modes and IR
intensities through the Spectra panel (AV-QM-017 PARTIAL). Planned: ORCA/xTB execution adapters when
binaries exist, more output parsers (orbital energies and fragments from the same ORCA output, MOPAC
aux, GAMESS, Molpro), the input generators Avogadro does not have either
(PSI4, Q-Chem, Dalton, MOLPRO, LAMMPS).

## Phase 10 — Packaging and hardening — PLANNED
Desktop shell ADR (Electron vs Tauri vs pywebview), reproducible install script, performance profiling with
large systems, security review, tutorials and user documentation, CI.
