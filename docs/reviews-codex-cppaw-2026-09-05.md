## Read-only review verdict

I found 10 confirmed defects plus one conditional hardening issue. No files or tests were executed/modified.

### High severity

1. **One-letter elements generate an invalid internal setup ID** — [strc.py:148](/home/pmk/Projects/atomscope/backend/src/atomscope/backends/cppaw/strc.py:148)

   `species_name("O")` is `O_`, then another `_` is added, producing `O__.75_6.0` (also `H__.75_6.0`). CP-PAW splits at the first underscore, so its setup type becomes `_.75_6.0`, not `.75_6.0`; only the latter is recognized. This makes default H/O-containing generated inputs fail setup resolution. The test currently codifies the bad value at [test_strc_cntl.py:42](/home/pmk/Projects/atomscope/backend/tests/backends/cppaw/test_strc_cntl.py:42).

   Evidence: `paw_setups.f90:1403-1405` splits `ID` at the first `_`; `:1437-1444` recognizes `.75_6.0` only. The valid Si fixture uses `SI_.75_6.0`.

   Fix: construct `ID` as `f"{species_name(sym)}{opts.setup_type}"`, without inserting another underscore. For the empty fallback at [strc.py:158](/home/pmk/Projects/atomscope/backend/src/atomscope/backends/cppaw/strc.py:158), use `H_.75_6.0`.

2. **“Restart from parent” copies a restart file but still generates `START=T` by default** — [service.py:156](/home/pmk/Projects/atomscope/backend/src/atomscope/calculations/service.py:156), [cntl.py:49](/home/pmk/Projects/atomscope/backend/src/atomscope/backends/cppaw/cntl.py:49)

   `fork(..., restart_from_parent=True)` copies `case.rstrt`, but it inherits the parent/default `"start": "scratch"` unless the caller separately supplies a restart value. `build_cntl()` therefore writes `START=T`, ignoring the copied restart.

   Evidence: CP-PAW manual `manual.tex:892-899` defines `START=T` as STRC/random and `START=F` as restart; `:984-990` defines `NEWSTRC`. This contradicts the project recommendation at `cppaw-analysis.md:1712-1714`.

   Fix: when `restart_from_parent=True`, default the child to `"start": "restart"` unless explicitly overridden; reject a restart fork if no copied restart exists, and test the generated CNTL.

3. **Cancellation defeats CP-PAW’s exit-file soft-stop protocol** — [manager.py:97](/home/pmk/Projects/atomscope/backend/src/atomscope/jobs/manager.py:97), [runner.py:52](/home/pmk/Projects/atomscope/backend/src/atomscope/backends/cppaw/runner.py:52)

   `JobManager.cancel()` sends SIGTERM to the whole process group. The runner and its `paw_fast.x` child share that group, so CP-PAW receives SIGTERM immediately while the runner’s signal handler is trying to create `case.exit`. The subsequent five-second manager grace period can also SIGKILL the group long before the runner’s 90-second soft-stop grace expires.

   Evidence: the runner’s child inherits its process group; CP-PAW polls the exit file (`paw_driver.f90:740-746`) and deletes a stale one only at run start (`:702-708`). The analysis explicitly requires touching the exit file after startup and waiting for `PROGRAM FINISHED` (`cppaw-analysis.md:1710-1713`).

   Fix: signal only the runner PID first; give it a job-specific soft-stop deadline longer than its CP-PAW grace. Escalate to process-group SIGTERM/SIGKILL only after that deadline.

4. **Incomplete CP-PAW runs can be recorded as completed** — [runner.py:73](/home/pmk/Projects/atomscope/backend/src/atomscope/backends/cppaw/runner.py:73), [manager.py:159](/home/pmk/Projects/atomscope/backend/src/atomscope/jobs/manager.py:159), [service.py:46](/home/pmk/Projects/atomscope/backend/src/atomscope/calculations/service.py:46)

   The runner treats exit code zero as success without requiring `PROGRAM FINISHED`. On service reconciliation, any orphan with a parsable energy and `.strc_out` is marked completed, even if its last protocol run is incomplete. CP-PAW rewrites `.strc_out` during the run, so that is a realistic partial-output case.

   Evidence: the health-check correctly requires both code zero and `PROGRAM FINISHED` at [settings.py:146](/home/pmk/Projects/atomscope/backend/src/atomscope/backends/cppaw/settings.py:146); the analysis requires the same predicate at `cppaw-analysis.md:1706-1708`.

   Fix: make the runner return nonzero when the final protocol segment lacks `PROGRAM FINISHED`; preserve that explicit completion state and require it in reconciliation.

5. **Antiferromagnetic and state-controlled occupations are not representable** — [strc.py:131](/home/pmk/Projects/atomscope/backend/src/atomscope/backends/cppaw/strc.py:131), [strc.py:246](/home/pmk/Projects/atomscope/backend/src/atomscope/backends/cppaw/strc.py:246)

   The adapter retains only scalar charge/spin/NSPIN and cannot generate or retain `!OCCUPATIONS!STATE` blocks. A spin-polarized system with total spin zero therefore cannot encode AFM ordering; it may converge to a different magnetic state.

   Evidence: `manual.tex:3637-3651` documents total charge/spin, and `:3654+` documents state-specific occupation overrides. The analysis explicitly flags preserving `!OCCUPATIONS!STATE` as necessary (`cppaw-analysis.md:1673`).

   Fix: add first-class occupation-state data to the model/schema; round-trip it, or reject imported/state-controlled magnetic inputs rather than silently dropping it.

6. **The runtime fallback is implemented but not invoked for normal launches** — [settings.py:176](/home/pmk/Projects/atomscope/backend/src/atomscope/backends/cppaw/settings.py:176), [plugin.py:148](/home/pmk/Projects/atomscope/backend/src/atomscope/backends/cppaw/plugin.py:148)

   `ensure_runtime()` can detect the known libgfortran failure and select a compatible runtime, but `run_spec()` never calls it. A first normal calculation can therefore fail on this workstation despite the implemented remedy. The existing test expects the missing behavior at [test_plugin.py:102](/home/pmk/Projects/atomscope/backend/tests/backends/cppaw/test_plugin.py:102).

   Evidence: `cppaw-analysis.md:1691-1694` requires a real-run runtime check; `settings.py:8-12` documents the same trap.

   Fix: call `ensure_runtime()` before constructing a CP-PAW run spec, fail early with its diagnostic, and repair the currently inconsistent test/code pair.

### Medium severity

7. **Periodic cube view boxes corrupt non-orthogonal cell geometry** — [plugin.py:195](/home/pmk/Projects/atomscope/backend/src/atomscope/backends/cppaw/plugin.py:195), [cntl.py:183](/home/pmk/Projects/atomscope/backend/src/atomscope/backends/cppaw/cntl.py:183)

   For every periodic structure, `_view_box()` reduces the three lattice vectors to their norms, then `wcntl_text()` writes a diagonal box. For triclinic/primitive fcc cells this is not the simulated cell: its orientation and usually volume are wrong.

   Evidence: CP-PAW defines `VIEWBOX:T` as three edge vectors, not lengths (`manual.tex:5187-5215`). The analysis requires the cell itself as the periodic view box (`cppaw-analysis.md:1718-1720`). The real CP-PAW test uses a non-cubic Si primitive cell but only checks that a cube exists.

   Fix: pass a full 3×3 Bohr matrix through the runner and write it verbatim as `VIEWBOX:T`; retain the rectangular bounding box only for molecules.

8. **Deck parsing changes duplicate-key semantics** — [deck.py:119](/home/pmk/Projects/atomscope/backend/src/atomscope/backends/cppaw/deck.py:119)

   CP-PAW uses the first occurrence of a repeated non-multiple key/block. `parse_deck()` overwrites it with the last occurrence, and formatting then writes the altered deck. This can silently invert `START`, cutoffs, charge, or any imported raw-deck setting.

   Evidence: `manual.tex:426-432` says only the first occurrence is recognized; this is also a named known trap at `cppaw-analysis.md:1670`.

   Fix: preserve ordered duplicate entries, or retain the first value and emit a validation warning/error before serialization.

9. **Trajectory “last run only” detection fails for normal restart continuations** — [tra.py:58](/home/pmk/Projects/atomscope/backend/src/atomscope/backends/cppaw/tra.py:58)

   The parser starts a new run only when `ISTEP` decreases. CP-PAW writes the current `NFI` into each trajectory record, and a `START=F` continuation can keep increasing it. Appended restart trajectories can therefore be merged into one result.

   Evidence: `paw_driver.f90:96-106` continues `NFI`; `:1389-1395` passes it to the trajectory writer. The trajectory files are append-mode (`paw_iotra.f90:98-108`), while the manual says `START=F` uses the restart state (`manual.tex:892-899`).

   Fix: use an explicit run manifest/start offset, or require a fresh work directory for every run. Do not infer CP-PAW run boundaries from monotonic step numbers alone.

10. **The default force task runs 305 damped ionic steps, not the advertised five** — [cntl.py:59](/home/pmk/Projects/atomscope/backend/src/atomscope/backends/cppaw/cntl.py:59)

   For forces, `NSTEP` is `nstep + force_steps`; defaults therefore become `300 + 5`. It also enables RDYN from scratch, so nuclei move before the electronic state is necessarily converged. The test explicitly expects this at [test_strc_cntl.py:85](/home/pmk/Projects/atomscope/backend/tests/backends/cppaw/test_strc_cntl.py:85).

   Evidence: CP-PAW warns not to use RDYN before wave functions are optimized (`manual.tex:1537-1539`); the analysis recommends only a few force steps and requires checking electronic convergence (`cppaw-analysis.md:1663`, `:1700`).

   Fix: use `force_steps` as the force-task `NSTEP`, not an increment; preferably implement a converged-electrons stage followed by a short force stage, and report that the returned force is at the final displaced geometry.

### Low severity / hardening

11. **Root and cube arguments are treated as filesystem paths without local validation** — [runner.py:41](/home/pmk/Projects/atomscope/backend/src/atomscope/backends/cppaw/runner.py:41)

   A root containing path separators can escape `work` through `f"{root}.exit"`/`.out`; `--cube` accepts a relative wave-file path. Current `CalculationService` fixes the root to `case`, so I do not see a confirmed remote exploit in the present in-process plugin trust model. It is nevertheless unsafe if future plugins/API code expose these arguments.

   Fix: permit only a conservative root-name regex; reject absolute paths and `..` components; resolve every generated path and verify it remains under `work`.

12. **A molecular explicit k-point grid is silently ignored** — [plugin.py:86](/home/pmk/Projects/atomscope/backend/src/atomscope/backends/cppaw/plugin.py:86), [strc.py:120](/home/pmk/Projects/atomscope/backend/src/atomscope/backends/cppaw/strc.py:120)

   Validation emits only a warning for a non-periodic `grid`; generation writes no `!KPOINTS`, changing the user request to CP-PAW’s default Γ point. Γ is reasonable for isolated molecules, but silently substituting it is not.

   Fix: make this an error or normalize the parameter to Γ before generation and surface that transformation.

### Done well

- `LUNIT[AA]=1` generation and LUNIT-aware STRC parsing are conceptually correct.
- Charge sign and total-spin conversion match the manual’s conventions.
- Protocol force absence is represented as `None`, not fabricated zero force; the mH/Bohr → eV/Å conversion is correct.
- The current `_r.tra` lattice/position layout is decoded correctly.
- Subprocess execution uses argv arrays, `shell=False`, a minimal environment, and a dedicated process session. I found no confirmed shell-injection issue in the current trusted-plugin flow.

The main test gaps are the invalid H/O setup ID, restart-fork CNTL semantics, CP-PAW cancellation, incomplete-protocol reconciliation, appended restart trajectories, and non-orthogonal cube axes.

