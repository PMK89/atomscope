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
- Fixed: band structures were drawn per k-point instead of per band; the electrostatic potential
  could allocate tens of gigabytes; JobConsole could loop forever on a fresh selector array.

- Phase 0 investigation: Avogadro 1 feature-parity matrix, CP-PAW analysis, ASE/asecppaw analysis.
- Scientific data model, units, ASE bridge, project store, IO registry (ASE/RDKit/Open Babel), bond perception.
- Schema-driven parameter engine, JobManager, calculation service, REST/WebSocket API with generated TS types.
- Backend plugins: ASE built-in calculators; CP-PAW (input generation, driver, parsing, cube export).
- Frontend: Three.js renderer, undoable structure store, menubar, project/calculation panels, job console.
