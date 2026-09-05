# Changelog

## Unreleased

- Phase 0 investigation: Avogadro 1 feature-parity matrix, CP-PAW analysis, ASE/asecppaw analysis.
- Scientific data model, units, ASE bridge, project store, IO registry (ASE/RDKit/Open Babel), bond perception.
- Schema-driven parameter engine, JobManager, calculation service, REST/WebSocket API with generated TS types.
- Backend plugins: ASE built-in calculators; CP-PAW (input generation, driver, parsing, cube export).
- Frontend: Three.js renderer, undoable structure store, menubar, project/calculation panels, job console.
- Performance harness (`backend/benchmarks/`, `frontend/e2e/perf.spec.ts`) and the fixes it found:
  bond perception no longer allocates an N^2 array for non-periodic structures, project JSON is
  serialised once, and placing an atom in a large document is no longer O(atoms x bonds).
  Measurements and remaining limits: docs/performance.md.
