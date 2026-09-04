# Architecture documentation

| Document | Content |
|---|---|
| overview.md | System overview, process model, directory layout |
| scientific-data-model.md | Structures, properties, grids, orbitals, trajectories, units, provenance |
| frontend.md | UI shell, state, renderer, workers, tools |
| renderer.md | Display layers, primitives, picking, volumetric pipeline |
| ase-integration.md | Conversion to/from ase.Atoms, calculators, optimizers, trajectories |
| cppaw-adapter.md | CP-PAW backend plugin: input generation, execution, parsing |
| calculation-schemas.md | Schema-driven parameter system for calculation forms |
| job-execution.md | Job manager, process control, streaming, status, cancellation |
| output-parsing.md | Parser architecture, golden tests, volumetric loaders |
| plugin-system.md | Backend and frontend plugin contracts |
| security-model.md | Filesystem, subprocess and network safety |
| project-format.md | On-disk project layout and versioning |
