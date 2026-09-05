# Changelog

## Unreleased

- Wavefunction surfaces: Gaussian fchk and Molden readers, molecular orbital / electron density /
  spin density / electrostatic potential / van der Waals fields on a grid, and a Create surfaces
  panel that shows the grid cost before the request.
- Vibrations and spectra: normal modes from any ASE calculator, IR intensities, Gaussian/Lorentzian
  broadening, Gaussian/ORCA/Q-Chem output and TSV/JCAMP-DX/Turbomole spectrum readers, a Spectra
  dock panel with mode animation.
- Molecular point groups (detection, group order and Symmetrize with Loose/Normal/Tight tolerance)
  and SMARTS selection, both reachable from the UI.
- Crystallography (cells, spglib symmetry, builders, library), molecular mechanics (Open Babel force
  fields, hydrogens, pH, properties) and CP-PAW analysis (DOS, band structure, orbital export).
- Frontend review pass: periodic bond perception, a bounded marching-cubes budget, ARIA menus and
  dock tabs, undo during a preview gesture, throttled picking.
- Documentation: user guide, three tutorials, developer guide and a rewritten README.
- Performance harness (`backend/benchmarks/`, `frontend/e2e/perf.spec.ts`) and the fixes it found:
  bond perception no longer allocates an N^2 array for non-periodic structures, project JSON is
  serialised once, and placing an atom in a large document is no longer O(atoms x bonds).
  Measurements and remaining limits: docs/performance.md.
- Renderer: the sphere and cylinder tessellation is chosen from the atom count, which is what makes
  a large structure orbit at all.
- Cut, copy, paste and clear (Edit menu, Ctrl+X/C/V, Ctrl+Backspace). A fragment copied inside
  Atomscope keeps its bond orders; XYZ goes to the system clipboard for other programs, and text
  pasted from elsewhere (XYZ, CIF, PDB, molfile, CML, SMILES) is read by `POST /api/io/import/text`.
- Labels: atom and bond labels (index, symbol, name, formal and partial charge, residue, custom;
  bond order, length) as billboarded sprites, with colour, size and offset.
- A Display tab in the right dock collects every display layer -- structure style, atom and bond
  radius, hydrogens, labels, vectors, unit cell repeat and axes -- in one place, and can give the
  selected atoms a display type of their own (Avogadro's per-primitive engine restriction).
- Chemistry and building reach the UI: an Extensions menu for hydrogens, pH, bond perception,
  MMFF94 optimization (honouring the document's constraints), partial charges, Copy as SMILES/InChI,
  chirality and H to methyl; Build > Insert dialogs for the fragment library, peptides, nucleic
  acids and nanotubes; NMR, UV-Vis and CD spectra.
- Fixed: band structures were drawn per k-point instead of per band; cancelling a CP-PAW run
  waited the full 90 s soft-stop grace because the signal handler could not observe the child
  exit; a stale band file could be served as the result of a failed run; `orbital_bands` silently
  dropped ranges like "1-4"; the electrostatic potential could allocate tens of gigabytes;
  JobConsole could loop forever on a fresh selector array.

- Phase 0 investigation: Avogadro 1 feature-parity matrix, CP-PAW analysis, ASE/asecppaw analysis.
- Scientific data model, units, ASE bridge, project store, IO registry (ASE/RDKit/Open Babel), bond perception.
- Schema-driven parameter engine, JobManager, calculation service, REST/WebSocket API with generated TS types.
- Backend plugins: ASE built-in calculators; CP-PAW (input generation, driver, parsing, cube export).
- Frontend: Three.js renderer, undoable structure store, menubar, project/calculation panels, job console.
