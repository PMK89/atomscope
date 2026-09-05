# CP-PAW adapter

Package: `atomscope.backends.cppaw`. Evidence base: `docs/cppaw-analysis.md`.

| Module | Role |
|---|---|
| `deck.py` | CP-PAW input syntax (`!BLOCK key=value !END`, `!EOB`): parser and deterministic writer; Fortran-friendly numbers (`1.0E-05`, never `1e-05`) |
| `schema.py` | Task-oriented `ParameterSchema` (task, start mode, steps, XC, cutoffs, spin, occupations, dynamics, k-points, setups, analysis outputs) and course-derived presets; every key carries its `backend_path` |
| `strc.py` | `Structure` -> `!STRUCTURE` (Å via `LUNIT[AA]=1.0`, species/atom naming, internal setup IDs, box + `!ISOLATE` for molecules, occupations incl. `CHARGE[E]`/`SPIN[HBAR]`, constraints) and the reverse reader for `.strc`/`.strc_out` honoring `LUNIT` |
| `cntl.py` | values -> `!CONTROL` per task (single point, forces, relaxation, MD, Mermin) plus `!ANALYSE` density/orbital requests; `.wcntl` generator for `paw_wave.x` |
| `runner.py` | driver process: runs `paw_fast.x`, turns SIGTERM into a soft stop (`ROOT.exit`), converts requested `.wv` files to cubes with `paw_wave.x` |
| `protocol.py` | `.prot` parser: `!>` step rows, energy reports, ATOMLIST (forces only when present), eigenvalues, gaps, error lines |
| `tra.py` | `_r.tra` binary trajectory reader (Bohr, a.u. time; last run only) |
| `results.py` | work directory -> `ResultBundle` (eV/Å conversion happens here) |
| `settings.py` | executable discovery (`ATOMSCOPE_CPPAW_DIR`, `PAWDIR`, `~/cp-paw`, PATH), version probe, real-deck health check with libgfortran fallback |
| `plugin.py` | the `BackendPlugin` implementation |

Run layout inside a project: `calculations/<id>/input/{case.cntl,case.strc,structure.json,values.json}`,
`calculations/<id>/work/` (raw CP-PAW files, `driver.log`, `case.out`), `calculations/<id>/results/results.json`.

Traps handled (from the analysis): forces are only read from ATOMLIST rows that have a force
column and their absence is reported; `START=F` vs `NEWSTRC=T` are explicit choices; protocols are
split at the last `PROGRAM STARTED`; `STOP=T` is documented as "zero initial velocity"; the
libgfortran incompatibility of the installed binaries is detected and worked around via
`LD_LIBRARY_PATH` in the job environment.

Also implemented: two-stage force evaluation (`task=forces`: converge electrons, then a few damped
atomic steps; forces reported at the input geometry, electronic convergence checked), MPI runs
(`Resources.cores > 1` -> `mpirun -np N --oversubscribe ppaw_fast.x`, `OMP_NUM_THREADS=1`),
explicit `!OCCUPATIONS!STATE` blocks (antiferromagnets, excited configurations), fork/restart of
calculations (parent `.rstrt` copied, `START=F`), and the ASE calculator
`atomscope.ase_bridge.cppaw_calculator.CppawCalculator` (used by the ASE workflow plugin).

Post-processing is implemented: `paw_dos.x` (total and projected DOS), `paw_bands.x` (band
structure along a k-path, interpolated or by diagonalization) and on-demand orbital cube export
through `paw_wave.x`, each run as a separate analysis job on a completed calculation.

Not yet implemented: inline `!AUGMENT` setups from `setups.rslv`, constraint scans, wall-clock
limits, remote runners. `MODE=DIAG` band runs need a paw_bands.x newer than the installed
binaries (2025-05-07); the adapter now refuses to serve a band file left over from an earlier
request rather than presenting it as the result of the failed one.
