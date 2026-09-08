# CP-PAW on this workstation: analysis for the Atomscope adapter

Status: investigation report, 2026-09-05. Everything below was derived from the installed distribution `~/cp-paw` (manual source `src/Docs/manual.tex`, Fortran sources, examples), the hands-on course decks under `$COURSE`
(written that way throughout: the course material sits on an external drive, and its location is
not part of the finding), the finished output set in `~/ase-cp-paw/calculations/h2o` (and `ch3cli`), the earlier web-workbench code and its audit, and smoke runs executed under `.scratch/cppaw/`. Manual line numbers refer to `~/cp-paw/src/Docs/manual.tex`; `file:line` refers to `~/cp-paw/src/`. Machine-readable schema: `.scratch/cppaw/cppaw-schema-draft.json` (147 blocks, 487 keys, each with manual line and deck-usage count). Supporting material: `.scratch/cppaw/schema/` (full tables), `.scratch/cppaw/outputs/output-formats.md` (source-cited format notes), `.scratch/cppaw/tutorial/used-keys.json`, `.scratch/cppaw/tools/usage/`.

## 0. Key findings

1. **How to run**: `cd <dir>; paw_fast.x case.cntl 1>case.out 2>&1` with `case.strc` next to it; monitor `case.prot`; stop with `touch case.exit`; restart with `START=F` (+ `NEWSTRC=T` to take a new geometry). Parallel: `mpirun -np N --oversubscribe ppaw_fast.x case.cntl` (`OMP_NUM_THREADS=1`).
2. **Setups**: no external setup files exist or are needed. `!SPECIES ID='<EL>_.75_6.0'` (and `_NDLSS_V0`, `_NDLSS_SC_V0`, `_HBS`, `_HBS_SC`) are built internally; the 2022 course decks inline `!AUGMENT` blocks from `setups.rslv` via `paw_resolve`. `PAWDIR` is not read by the binaries.
3. **The installed binaries do not start on this machine** (system libgfortran upgraded to GCC 16; `paw_trace.f90` has a malformed FORMAT). Work-around: `LD_LIBRARY_PATH=~/miniconda3/pkgs/libgfortran5-13.2.0-ha4646dd_0/lib`; permanent fix: one-character patch + rebuild (§7.1).
4. **Smoke tests passed with the work-around**: si2 12 s, E = −7.9050265 H; h2o 147 s, E = −17.3290129 H, gap 5.70 eV; `paw_wave.x`, `paw_dos.x`, `paw_bands.x` produce `.cub`, `.dos`, `bands.dat` from these outputs. Restart, exit-file stop, `NEWSTRC`, error exit all verified.
5. **Forces are printed in the protocol only when a `!RDYN` block exists** (`paw_atoms.f90:257`; verified: si2 without RDYN → no force column, si2 with RDYN → `( 0.01, 0.01, 0.01)` mH/a₀). Precision is 2 decimals in mH/a₀; use `_f.tra` for real work.
6. **Protocol, trajectory and constraint files are appended across runs**; `START=F` (the default) ignores the STRC geometry; `STOP=T` means zero initial velocity; the autopilot may end MD/relaxation runs early; unknown keys are reported under `UNUSED ELEMENTS` rather than rejected.
7. **Schema coverage**: all 147 documented blocks / 487 keys extracted with manual line numbers; every block used by the 691 real decks and by the h2o/si2 examples is tabulated in §3 with usage counts; 33 deck keys are not in the manual (§3.2).
8. **Units**: inputs mostly a.u. (Bohr, Hartree, τ₀) with bracketed exceptions (`[AA]`, `[EV]`, `[K]`, Ry for cutoffs); protocol mixes H, eV, Å, mH/a₀, ps, K (§5).

## 1. Installation facts

| Item | Value |
|---|---|
| Distribution root (`$PAWDIR`) | `~/cp-paw` (git clone of https://github.com/cp-paw/cp-paw.git, branch `main`, commit `aa467ef8739758bfe067e80a2ab61f5697ede009` of 2024-12-18; "development version") |
| Build date | 2025-05-07 20:03 CEST, built as root (`paw_fast.x --version`) |
| Serial binaries | `$PAWDIR/bin/fast/paw_*.x` (+ `paw_*` symlinks without `.x`, + shell scripts `paw_*.sh` with `paw_*` symlinks) |
| Parallel binaries | `$PAWDIR/bin/fast_parallel/ppaw_*.x` — present (`ppaw_fast.x`, 11.8 MB, and a `ppaw_*` copy of every tool). Launched via `doppaw.sh -n N ROOT`, which runs `export OMP_NUM_THREADS=1; $(which mpirun) -np N --oversubscribe $(which ppaw_fast.x) ROOT.cntl 1>out 2>&1` (`doppaw.sh:119-125`; it also creates a private `TMPDIR`); `mpirun` is `/usr/bin/mpirun` (Open MPI). Not exercised in this analysis. |
| Debug binaries | `$PAWDIR/bin/dbg/` |
| Build system | `paw_install` (top level) loops over `dbg fast fast_parallel` and calls `src/Buildtools/paw_build.sh -v -j10 -c <choice> [-z]`; `parmfile` (bash, sourced by paw_build.sh) picks the compiler (`gfortran` here, `mpif90` for parallel), libraries via `pkg-config` (openblas, fftw3, libxcf03) and sets `BINDIR=$(pwd)/bin/<choice>`, `BUILDDIR=$(pwd)/bin/Build_<choice>` (module files, `big.mk`), `DOCDIR=$(pwd)/doc` (manual built with latexmk unless `-z`). Preprocessor `paw_dollar_ok.sh` rewrites `$` in identifiers to `__`, so `MPE$STOPALL` appears as `MPE__STOPALL` in messages. |
| Compile parameters (`paw_fast.x --parmfile` writes `parms.in_use` into the cwd; identical to `bin/Build_fast/etc/parms.in_use`) | `FC=/usr/bin/gfortran`, `FCFLAGS=-I/usr/include/x86_64-linux-gnu/openblas-pthread/ -ftree-vectorize -funroll-loops -O3 -finline-functions -fwhole-program -flto=3 -march=native`, `LIBS=-L/usr/lib/x86_64-linux-gnu/openblas-pthread/ -lopenblas -lfftw3 -lxcf03`, `INCLUDES=/usr/include/fftw3.f03 /usr/include/xc_f03_lib_m.mod`, `CPPFLAGS=""`, `PARALLEL=false`, `SUFFIX=fast`. Note `-march=native`: the binary is tied to this CPU family. |
| Linked libraries (`ldd paw_fast.x`) | libopenblas.so.0, libfftw3.so.3, libxcf03.so.9 (LibXC 5.2.3), libgfortran.so.5, libmvec, libm, libc |
| Environment on this machine | `PAWDIR=~/cp-paw` is exported; `PATH` contains `bin/fast`, `bin/fast_parallel`, `bin/dbg`. The binaries themselves read **no** environment variable except `HOSTNAME` (`paw_trace.f90:75`); `PAWDIR` is only used by the shell scripts and by the documentation (`$PAWDIR/parameters/stp.cntl`, which does not exist here). |
| Runtime blocker | The current system `libgfortran5` (GCC 16 runtime, installed 2026-03-22) rejects a malformed run-time FORMAT in `paw_trace.f90` → every actual run of `paw_fast.x` (and of every tool that calls `TRACE$PUSH` before reading input: `paw_dos.x`, `paw_tra.x`, `paw_grab.x`, `paw_cleantra.x`) aborts within 0.2 s. `paw_fast.x --version|--help|--parmfile`, `paw_wave.x -h`, `paw_bands.x -h` still work because they exit before the first trace call — a health check must therefore run a real (tiny) deck. See section 7.1 for the evidence and the two remedies. All results in this document were obtained with `LD_LIBRARY_PATH=~/miniconda3/pkgs/libgfortran5-13.2.0-ha4646dd_0/lib`. |
| Manual | `~/cp-paw/src/Docs/manual.tex` (12,500 lines; rendered `~/cp-paw/doc/manual.pdf`). Block/keyword documentation is fully regular (`\block{}`, `\brules{}`, `\bdescr{}`, `\mbax{\key{} \vdescr{} \vformat{} \vrules{} \vdefault{}}`) — 147 active blocks, 487 keys. |
| Examples / tests | `src/Docs/Examples/si2.{cntl,strc}`; `tests/unittests`, `tests/fulltests/si2` (reference energy asserted by `analyse.sh`); `src/Tools/Preopt/case.{pcntl,strc}`. |

### 1.1 Tools (all in `bin/fast/`; `-h` output captured in `.scratch/cppaw/tools/usage/`)

| Tool | Purpose | Invocation | Inputs | Outputs | Manual |
|---|---|---|---|---|---|
| `paw_fast.x` | the simulation code | `paw_fast.x ROOT.cntl` (also `-h`, `--version`, `--parmfile`) | `ROOT.cntl`, `ROOT.strc`, optional `ROOT.rstrt`, setups | `.prot .strc_out .rstrt _r.tra .pdos .banddata _constr.report _stpforzZ.myxml`, optional `.wv` files | l.574-720 |
| `ppaw_fast.x` | MPI version | `doppaw.sh -n N ROOT` → `mpirun -np N --oversubscribe ppaw_fast.x ROOT.cntl` | same | same (only task 1 writes `.prot`) | l.626-640 |
| `paw_wave.x` | render `.wv` (wave function / density on grid) | `paw_wave.x ROOT.wcntl` | `.wcntl` (`!WCNTL`), `.wv`, `.strc_out` | `.cub` (Gaussian cube), `.dx` (OpenDX), `.wrl` (VRML), `_c.gnu`/`_r.gnu` (gnuplot), `.wprot` | l.5063-5555 |
| `paw_dos.x` | (projected) density of states, COOP | `paw_dos.x ROOT.dcntl` | `.dcntl` (`!DCNTL`), `.pdos` | `<prefix><ID>.dos` per `!WEIGHT`/`!COOP` set, `.dprot` | l.6398-7435 |
| `paw_dosplot.x` | xmgrace plot of `.dos` files | `paw_dosplot.x ROOT.dpcntl` | `.dpcntl` (`!DPCNTL`), `.dos` files | `.bat` (xmgrace batch), `.dpprot` | l.7436-7723 |
| `paw_bands.x` | band structure along k-lines, k-mesh PDOS | `paw_bands.x ROOT.bcntl` | `.bcntl` (`!BCNTL`), `.banddata` | `<FILE>.dat` (k, E₁..E_NB in eV), `.pdosout`, `.bprot` | l.7724-8314 |
| `paw_tra.x` | trajectory analysis (movies, bond lengths, T(t), correlation) | `paw_tra.x ROOT.tcntl` | `.tcntl` (`!TCNTL`), `_r.tra`, `.strc_out` | `.movie.xyz`/`.movie.dx`, `.tra.*` data, `.tprot` | l.5618-6397 |
| `paw_toxyz.x` | STRC → xyz | `paw_toxyz.x [-O] [-F] [-M mx my mz] [-C] [-D d] ROOT` | `.strc` (or `.strc_out` with `-O`) | `ROOT.xyz` (**Bohr**) | — |
| `paw_strc.x` | structure analysis / conversion | `paw_strc.x -m|-c|-cijk [-i] ROOT` | `.strc_out` (or `.strc` with `-i`) | `.sprot`, `.cml`, `.xyz`, `.cssr` | l.5026-5062 |
| `paw_tostrc.x` | xyz/cssr → STRC fragment | `paw_tostrc.x ROOT` | | STRC text | — |
| `paw_fromposcar.x` | VASP POSCAR → STRC | `paw_fromposcar.x IN.POSCAR [LUNIT_AA] > file` | POSCAR | STRC text | l.8717 |
| `paw_preopt.x` | force-field pre-optimisation (UFF) | `paw_preopt.x ROOT.pcntl` | `.pcntl` (`!PCNTL`), `.strc` | `.pprot`, optimised STRC | l.8440-8716 |
| `paw_grab.x` | reaction/formation energies from several projects | `paw_grab.x ROOT.gcntl` | `.gcntl` (`!GCNTL`), `.prot` files | report | l.4888-5025 |
| `paw_stpa.x` / `paw_stpreport.x` | analyse setup construction | `paw_stpa.x -s SELECTION [-o OUT] ROOT_stpforzNN.myxml` | `_stpforzNN.myxml` | tables / plots | l.8315-8439 |
| `paw_murnaghan.x` | Murnaghan EOS fit | `paw_murnaghan.x [-l|-v] [-eu] [-lu] < 2-column data` | (V or a, E) | fit parameters | l.9144 |
| `paw_1davpot.x`, `paw_cmcwave.x`, `paw_polyhedra.x`, `paw_converttra.x`, `paw_cleantra.x` | special-purpose (band offsets, CryMolCAD, octahedra, legacy trajectory conversion) | see usage files | | | l.5555-5617 |
| `paw_do.sh` | front end: `-F` run, `-K` touch `ROOT.exit`, `-Z` tail prot, `-D/-W/-T/-B/-S/-A` run the tools, `-P` parallel | `paw_do -F [-R ROOT]` | | | l.8798 |
| `paw_show.sh` | plot `!>` columns from `.prot` with xmgrace (`-e -c -f -t -a`, `-u ev`, `-o file`) | `paw_show -ce ROOT` | `.prot` | plot / data | l.8839 |
| `paw_get.sh` | extract `etot|gap|efermi|homo|lumo|volume|epw|epwrho|nkpt|kdiv` from `.prot` (`-u ev`, `-n`) | `paw_get -w gap -u ev -n ROOT` | `.prot` | number | l.8928 |
| `paw_collect.sh` | total energies of all projects below cwd (Hartree) | `paw_collect` | `.prot` | table | l.8915 |
| `paw_resolve.sh` | template expansion: `@id@` → value (`-r id=value`) or file contents (`-f id=file`, or `-p prefix`) | `paw_resolve -f SETUPS=setups.rslv -i x.strc_tmpl -o x.strc` | template | resolved file | l.8975 |
| `paw_scan.sh`, `paw_scanlat.sh` | parameter scans / lattice-constant scans (one directory per value), `paw_scanlat -u` collects `E(a)` for `paw_murnaghan` | `paw_scanlat -l "96 98 100 102" -e paw_fast.x -p ROOT` | `.cntl`, `.strc` | subdirectories, `.dat` | l.9013-9143 |
| `paw_copy.sh`, `paw_ext_copy.sh`, `paw_checkpoint.sh`, `paw_waittillempty.sh`, `paw_compare.sh`, `paw_requirements.sh`, `paw_getsrc.sh`, `paw_mpeg_encode.sh` | project housekeeping | | | | l.8875-9290 |

Exit codes observed: `paw_fast.x --version` / `-h` → 0 (prints `NORMAL STOP: CALLING MPE__STOPALL TO CLOSE DOWN`, stderr `STOP NORMAL STOP IN MPE__STOPALL`); normal run → 0; input error via `ERROR$STOP` → **1** (`ERROR STOP ERROR STOP IN MPE__STOPALL` on stderr); Fortran runtime error (missing file, format bug) → **2**. Several tools have no proper argument handling (`paw_dosplot.x -h`, `paw_preopt.x -h`, `paw_polyhedra.x -h` try to open a file named `-h` and stop with exit 1).

## 2. Calculation workflow as the manual and the tutorial teach it

### 2.1 Project layout (`$ROOT`)

All files of one calculation live in one directory and share a root name
(manual "The project data structure", l.539-572): `$ROOT.cntl`, `$ROOT.strc`,
`$ROOT.prot`, `$ROOT.rstrt`, `$ROOT.strc_out`, `$ROOT_r.tra`, ... The root is
derived from the control-file name by stripping `.cntl`
(`!CONTROL!FILES ROOT=` can override it, l.795). Any file can be renamed with
`!CONTROL!FILES!FILE ID=... NAME=... EXT=T/F` (l.804-885; `EXT=T` means NAME is
an extension appended to the root, `EXT=F` a full path; `NAME='stdout'` is
allowed). Standard IDs and default extensions:

| ID | default | role |
|---|---|---|
| `PROT` | `.prot` | protocol (the file to monitor) |
| `CNTL` | `.cntl` | control input |
| `STRC` | `.strc` | structure input |
| `STRC_OUT` | `.strc_out` | structure written at the end (not in the manual table; present in the FILE REPORT of every run) |
| `RESTART_IN` / `RESTART_OUT` | `.rstrt` | restart file read / written (same default name → in-place update) |
| `EXIT` | `.exit` | if this file exists the run stops after the current step |
| `PDOS` | `.pdos` | projections for paw_dos.x |
| `PDOSOUT` | `.pdosout` | written by paw_bands.x, read by paw_dos.x |
| `BANDDATA` | `.banddata` | Hamiltonian for paw_bands.x |
| `CONSTRAINTS` | `_constr.report` | constraint report |
| `POSITION_TRAJECTORY` | `_r.tra` | positions/velocities/forces trajectory (paw_tra.x) |
| `BANDS_TRAJECTORY` | `_r.tra` (sic, "not yet used") | |
| `PARMS_STP` | `$PAWDIR/parameters/stp.cntl` | setup parameter file (does not exist on this machine; not needed) |
| `AUGPARMS` | none | setup parameter file in the `!ACNTL!AUGMENT` format (alternative to inline `!AUGMENT`) |
| `STP_REPORT` | `_stpforz<Z>.myxml` | per-element setup report (seen in every run; not documented) |

### 2.2 What a run needs

1. `$ROOT.strc` — atoms, cell, species/setups, occupations, k-points, constraints.
2. `$ROOT.cntl` — what to do (number of steps, dynamics of wave functions and atoms, analysis).
3. Setups (augmentation parameters), via one of three channels (`paw_setups.f90:1318-1321`):
   * inline `!STRUCTURE!SPECIES!AUGMENT ... !END` (highest priority; used by the
     hands-on decks through `setups.rslv` + `paw_resolve`, and by the h2o example);
   * `!STRUCTURE!SPECIES ID='EL_TYPE'` with an internal type
     (`NDLSS_V0`, `NDLSS_SC_V0`, `HBS`, `HBS_SC`, `.75_6.0`; e.g. `SI_.75_6.0` in si2);
   * `!STRUCTURE!SPECIES ID=...` looked up in a file attached as
     `!CONTROL!FILES!FILE ID='AUGPARMS' NAME=... EXT=F` (format `!ACNTL !AUGMENT ID=... !END !END`).
   No `.stp` files, `setups.rslv`-style files or `$PAWDIR/parameters` exist on this
   workstation except `$COURSE/handson2022/setups.rslv` (the
   tutorial's inline definitions, see section 6). `PAWDIR` is **not read** by the
   binaries (the only `GET_ENVIRONMENT_VARIABLE('PAWDIR')` in
   `paw_ioroutines.f90:680` is commented out); it is a convention of the shell
   scripts only.
4. For `START=F`: `$ROOT.rstrt`.

### 2.3 Running

```bash
paw_fast.x $ROOT.cntl 1>$ROOT.err 2>&1 &        # manual l.606; stdout is developer noise + error text
tail -f $ROOT.prot                               # monitoring, l.674
```

The argument is the control file (relative or absolute). The code chdirs
nowhere: relative file names are resolved against the current working directory,
so launch with `cwd = project directory`. Parallel: `ppaw_fast.x` via MPI (see
section 1). `paw_fast.x --version|--help|--parmfile` print info and exit 0.

The order of events inside a run (all reported in `.prot`): banner + version →
"UNUSED ELEMENTS" check of CNTL → CNTL report → "UNUSED ELEMENTS" of STRC →
setup construction (per species; `_stpforz<Z>.myxml` written) → structure/atoms/
k-point/occupation reports → FILE REPORT → first-iteration timing → `!>` line
per time step, an "ENERGY REPORT / ATOMLIST REPORT / EIGENVALUES / gap" block
every `NWRITE` steps (and restart file update) → stop → final reports →
`FILE REPORT` (all files written) → RUN-TIME REPORT → `PROGRAM FINISHED`.

### 2.4 Stopping

| Mechanism | How | Effect |
|---|---|---|
| Regular end | `NSTEP` reached | final reports, `.rstrt`, `.strc_out`, exit code 0 |
| Autopilot convergence | `!PSIDYN!AUTO` (and/or `!RDYN!AUTO`) present: total energy within `ETOL` (default 1e-5 H) for `AUTOCONV` (default 20) steps | `.prot`: ` STOP SIGNAL FROM AUTOPILOT` then ` STOP SIGNAL RECEIVED`, one more step, regular end. **This fires during atomic dynamics too** (si2_rdyn probe stopped after 23/30 steps). |
| Exit file | `touch $ROOT.exit` (name via `!FILES!FILE ID='EXIT'`) | checked once per step (`paw_driver.f90:744`); ` STOP SIGNAL RECEIVED`, regular end; stale exit file is deleted at the start of the next run (`paw_driver.f90:707`) |
| Wall-clock limit | `!GENERIC RUNTIME=h m s` | same soft stop |
| Signal | `kill -30 PID` (manual l.700-711) | described as a soft stop after the next iteration, discouraged by the manual; **no signal handler exists in the current sources** (no `SIGNAL`/`SIGUSR` call anywhere in `src/*.f90`), so on this build a signal simply kills the process |
| Hard kill | SIGTERM/SIGKILL | no final reports; `.rstrt` is only as recent as the last `NWRITE` update |

`STOP=T` in `!PSIDYN` / `!RDYN` does **not** mean "stop when converged" — it
zeroes the initial velocities of wave functions / atoms (manual l.1242, l.1541).

### 2.5 Restarting and continuing

* `!CONTROL!GENERIC START=T`: random wave functions, positions from STRC.
* `START=F` (the default!): wave functions, positions **and unit cell** from
  `$ROOT.rstrt`; the STRC geometry is ignored unless `NEWSTRC=T` (l.983, verified
  in probe `si2_newstrc`). The iteration counter (NFI) continues from the restart
  file. Typical tutorial sequence: converge wave functions (`START=T`, no
  `!RDYN`) → relax (`START=F`, `!RDYN` with friction / `!AUTO`) → MD
  (`START=F`, `!RDYN FRIC=0` + `!THERMOSTAT`) — each stage a new CNTL, same
  root, same `.rstrt`.
* `RESTART_IN` and `RESTART_OUT` default to the same file; to keep a stage's
  result immutable, point `RESTART_OUT` elsewhere or copy `.rstrt` before the
  next stage. `NWRITE` controls how often `.rstrt` is refreshed during a run.
* `RSTRTTYPE='STATIC'` halves the restart file (only for non-dynamical continuation).
* Re-running an unchanged deck with `START=F` is the "resume" path; with
  `START=T` it is a "rerun from scratch". Occupations/charge/spin come from the
  restart file when `START=F` unless the `!OCCUPATIONS` block says otherwise
  (manual l.1783, 1882-1897).

## 3. The input schema (CNTL and STRC)

### 3.1 File syntax (manual "Syntax rules for the input data", l.371-462; verified against the LINKEDLIST reader behaviour in the smoke runs)

* A file is a tree of **blocks**. A block opens with `!NAME` and closes with `!END`; the last top-level block is followed by `!EOB` (end of buffer). Text after `!EOB` is ignored (a second mechanism for comments). Lines whose first non-blank character is `#` are ignored.
* Inside a block, **data** are `KEY=value [value ...]`; keys and values are separated by blanks or line breaks; indentation and ordering are arbitrary except where the manual says a block is "multiple" and order-dependent (e.g. `!ATOM`, `!SPECIES`, `!FILE`). The `=` is mandatory and must follow the key directly (`R= 0.25 0.25 0.25` and `R=0.25 0.25 0.25` are both fine).
* **Block names and keywords are case-insensitive** — verified: the si2 deck's `minfric=` was accepted (not listed as unused), the course `h2o.wcntl` is entirely lower case (`!wcntl`, `!files`, `id=`), and `paw_dos.x` accepted `prefix=`. Quoted string *values* are read verbatim; the code upper-cases setup IDs and file IDs before comparison (`ID='SI_.75_6.0'` and `id='wave'` both work), while atom/species names are used as given — keep them consistent in case (the decks use upper case).
* **Type inference** (l.436-447, in this order): contains `'` or `"` → character; contains `(` → complex; `T`, `F`, `.true.`, `.false.` → logical; contains `.` → real; otherwise integer. Integers given where reals are expected are converted; reals given where integers are expected are rounded silently. Repetition shorthand `3*0.` = `0. 0. 0.`.
* Arrays: elements separated by blanks; multi-dimensional arrays in Fortran order (first index fastest): `T= t1x t1y t1z  t2x t2y t2z  t3x t3y t3z`.
* Units are part of the keyword name: `CHARGE[E]`, `LUNIT[AA]`, `T[K]`, `FREQ[THZ]`, `EMIN[EV]`, `RANDOM[K]`, `RAD/RCOV`, `RC/RCOV` — a key without suffix is in atomic units.
* Any block can be disabled by appending `_OFF` (or in practice any suffix — `!RDYN_x`, `!AUTO_STRT`, `!THERMOSTAT_OFF`, `MODE_X=` are all used in the decks) — the block/key simply becomes unknown and is skipped.
* **Unknown or misplaced keys/blocks are not errors**; they are listed in the `.prot` under `UNUSED ELEMENTS FROM INPUT FILE` (one list for CONTROL, one for STRUCTURE). A key given twice: only the first occurrence is used (l.427-432).
* A block is a **container** if it has no keys of its own (`!CONTROL`, `!STRUCTURE`, `!CONTROL!FILES`, `!STRUCTURE!CONSTRAINTS`, ...). Empty blocks (`!FILES !END`, `!ISOLATE !END`) are legal and mean "use defaults".
* Cross references in the manual use `!BLOCK!SUBBLOCK:KEY`.
* The same syntax is used by all tool control files (`!WCNTL`, `!DCNTL`, `!DPCNTL`, `!BCNTL`, `!TCNTL`, `!PCNTL`, `!GCNTL`), by `setups.rslv`/`AUGPARMS` files (`!ACNTL!AUGMENT`), and by the outputs `.strc_out` and `_stpforzZ.myxml` (`LINKEDLIST$WRITE`: one value per line, list-directed).

Minimal complete decks (both run as-is, section 7):

```
# si2.cntl                                      # si2.strc
!CONTROL                                        !STRUCTURE
  !GENERIC NSTEP=200 START=T !END                 !GENERIC LUNIT=10.26 !END
  !DFT     TYPE=10 !END                           !KPOINTS R=10. !END
  !FOURIER EPWPSI=30 CDUAL=2 !END                 !OCCUPATIONS EMPTY=2  !END
  !PSIDYN  FRIC=0.005                             !LATTICE T= 0.0 0.5 0.5  0.5 0.0 0.5  0.5 0.5 0.0 !END
    !AUTO FRIC(-)=0.5 FACT(-)=0.95                !SPECIES NAME='SI' ID='SI_.75_6.0' NPRO=2 2 1 LRHOX=2 RAD/RCOV=1.4 !END
          FRIC(+)=1. FACT(+)=1. minfric=0.01 !END !ATOM NAME='SI1' R=0.00 0.00 0.00 !END
  !END                                            !ATOM NAME='SI2' R=0.25 0.25 0.25 !END
!END                                            !END
!EOB                                            !EOB
```

### 3.2 How the tables below were produced

`.scratch/cppaw/cppaw-schema-draft.json` was generated from `manual.tex` by `.scratch/cppaw/schema/build_schema.py` (wrapping the parser `tools/extract_manual_metadata.py` that ships with the distribution; 147 blocks, 487 keys; every entry carries `source_line`). Spot checks of 17 keys and 4 blocks against the manual by line number found no discrepancies; four manual typos were transcribed by hand and carry a `note`. Keys were then cross-referenced with **691 unique real decks** (1362 files) found under `$COURSE/{handson2022,hoc2w,Handson_2ndweek,paw_hoc,testset,projects,examples}` (`.scratch/cppaw/tutorial/used-keys.json`, produced by `.scratch/cppaw/tutorial/parse_decks.py`): the column **Used** gives the number of decks using the key (✓ = used, blank = not used in any deck). The full tables for all 147 blocks are in `.scratch/cppaw/schema/schema-tables.md`; below are the blocks that occur in the tutorial decks, the h2o/si2 examples, or are needed for restart/stop control. Long descriptions are truncated (`...`); `default` strings are verbatim from the manual.

Keys used by real decks that are **not in the manual** (Atomscope must tolerate them when importing decks; some are typos that CP-PAW silently ignores, some are newer than the manual): `!CONTROL!GENERIC AUTOCONF` (typo of `AUTOCONV`), `!CONTROL!PSIDYN SAVEORTHO` (typo of `SAFEORTHO`), `!CONTROL!PSIDYN M`, `!CONTROL!PSIDYN!THERMOSTAT T[K]` (documented for `!RDYN!THERMOSTAT` only), `!CONTROL!ANALYSE!WAVE DIAG`, `!CONTROL!DFT!NTBO HFWEIGHT`, `!STRUCTURE!SPECIES FILE|ZV|RAD/COV|XXPS<G2>|XXPS<G4>`, `!STRUCTURE!SPECIES!NTBO TAILLAMBDA|RTAIL/RCOV|RTAILCUT/RCOV`, `!DCNTL!GRID EMIN[EV]|EMAX[EV]`, `!DCNTL!WEIGHT!ORB` and `!DCNTL!COOP!ORB1/ORB2` keys (`ATOM NAME NNX NNZ TYPE Z` — documented under `!DCNTL!ORBITAL!ORB` and referenced), `!DPCNTL!GRAPH!SET FILLCOLOR`. Blocks in decks that are not in the manual: `!STRUCTURE!CONSTRAINTS!LINEAR_PHI|LINEAR_Q2|LINEAR_Q3` (+ `!ATOM`), `!DCNTL!OUTPUT`, `!TCNTL!MODEX` (disabled variant), `!SCNTL!SETUP...` (the *old* setup-file format, superseded by `!ACNTL!AUGMENT`, see `paw_setups.f90:1488-1490`), and nesting mistakes (`!STRUCTURE!SPECIES!SPECIES`, `!STRUCTURE!SPECIES!ATOM` — a missing `!END` swallows the following blocks silently; CP-PAW still runs).

### 3.3 Control file `!CONTROL` (ROOT.cntl)

#### `!CONTROL`  (manual l.783; optional)

defines the operations performed on the system; largely independent of the system

_(container block, no keys of its own)_

#### `!CONTROL!FILES`  (manual l.790; optional)

specifies the file names that deviate from the standard values

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `ROOT` | character |  | string preceding the '.cntl' ending of the cont... |  |  | rootname. Files defined as extension will have this name combined with the extension. All files connected as default are defined as extensions. |

#### `!CONTROL!FILES!FILE`  (manual l.804; optional, multiple)

Specifies one file

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `ID` | character |  | none | PROT, STRC, CNTL, PARMS_STP, RESTART_IN, RESTART_OUT, EXI... | ✓ 12 | identifier for the file; options are: 'PROT' protocol; extension:.prot monitors the simulation. 'STRC' structure input file; extension:.strc defines atoms, structure, ... |
| `NAME` | character |  | none |  | ✓ 12 | filename. Can be the relative file name or an extension to the PAW "root". Standard output can be specified by NAME='stdout' and EXT=.false. |
| `EXT` | logical |  | .false. | T, F | ✓ 11 | .true.: NAME specifies the extension only/ .false.: full name |

#### `!CONTROL!GENERIC`  (manual l.887; optional)

general data that do not fit into other blocks

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `START` | logical |  | F | T, F | ✓ 200 | T: start with random wave functions, and atomic positions from file "STRC" F: wave functions and atomic positions are taken from restart file, unless specified otherwise |
| `NSTEP` | integer |  | 100 |  | ✓ 200 | number of time steps |
| `DT` | real | a.u. | 5.0 |  | ✓ 175 | time step $\Delta$ in a.u. (1 a.u.$\approx$ 0.024 fs) |
| `NWRITE` | integer |  | 100 |  | ✓ 144 | Every "NWRITE" time steps, the program writes detailed information into the protocol file and it updates the restart file. Note that writing the restart file is time c... |
| `TRACE` | logical |  | .false. | T, F | ✓ 6 | provides trace information when entering or leaving subroutines under trace control. Used for debugging purposes. |
| `ENDIAN` | character |  | little | little, intel, big, ibm |  | defines whether unformatted files are written in little endian as typical on Intel computers or in big endian as on IBM computers. The value can be 'little','intel','b... |
| `RUNTIME` | integer |  | $\infty$ |  |  | A soft stop is initialized after the given time has elapsed since start of the code. Runtime is specified as a three element vector containing (hours,minutes,seconds).... |
| `AUTOCONV` | integer |  | 20 |  | ✓ 9 | The autopilot defines a strategy to vary the friction for various dynamical variables, to test the convergence and to terminate the optimization loop. The decision to ... |
| `ETOL` | real |  | $10^{-5}$~H |  |  | The autopilot defines a strategy to vary the friction for various dynamical variables, to test the convergence and to terminate the optimization loop. The decision to ... |
| `BREAKRETARD` | integer |  | 1 |  |  | The autopilot selects the upper friction value, if the energy increases for the past "BREAKRETARD" time steps |
| `RSTRTTYPE` | character |  | NONE |  | ✓ 1 | allows to cut down the information on the restart file. Option RSTRTTYPE='STATIC' only stores one set of wave functions. This reduces the amount of disk space by nearl... |
| `NEWSTRC` | logical |  | F | T, F | ✓ 13 | Unit cell and atomic positions from structure input file overwrite any structure information from restart file. |

_Keys used by decks but not documented for this block: `AUTOCONF`_

#### `!CONTROL!DFT`  (manual l.993; optional)

selects density functional parameterization; default is Perdew-Zunger parameterization of the Ceperly-Alder quantum Monte-Carlo calculation

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `TYPE` | integer |  | 10 (PBE functional) | 1, 2, 3, 4, 6, 7, 71, 8, 81, 9, 10, -10, 11 | ✓ 200 | density functional parameterization. possible values are: {(1)} Perdew-Zunger parameterization of Ceperley-Alder ; {(2)} Perdew-Wang 91 parameterization of Ceperley-Al... |
| `LIBXC` | character array |  | see TYPE |  |  | density functional parameterization through LibXC. array of functional id's. Typicaly there are one or two strings. See appendix sec:libxcids on p. sec:libxcids. |
| `VDW` | logical |  | F | T, F |  | Adds van der Waals Interactions. The van der Waals interaction is described by an interatomic pair potential that has a long-ranged $r^{-6}$ behavior and which is cut ... |
| `VDW-3BODY` | logical |  | F | T, F |  | adds three-body interactions to the pair-wise van der Waals interactions of Grimme et al. (As of March 2012, not yet recommended by Grimme) |

#### `!CONTROL!DFT!NTBO`  (manual l.1079; optional)

Experimental option. Do not use! Constructs wave function representation in natural tight-binding orbitals. Enables to add the additional terms for the hybrid functionals or the interface for a solver for the dynamical mean-field theory.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `MODUS` | character |  | 'HYBRID' | HYBRID, DMFT | ✓ 20 | switch between different energy contributions. May be 'HYBRID' or 'DMFT'. |
| `OFFSITE` | logical |  | false | T, F | ✓ 11 | Calculates off-site U-tensor. OFFSITE=T is only compatible with MODUS='HYBRID'. To be come active, the specific options NDDO, 31 and/or BONDX need to be selected for e... |
| `K2` | real |  | -0.25 |  | ✓ 12 | K2=2 Ekin[H] of the envelope function. The bare Hankel function decay faster with decreasing k2. |
| `SCREENL[AA]` | real | AA | $\infty$ |  | ✓ 2 | The Coulomb interaction in the Exchange term is replaced by a Yukawa potential with the specified screening length. Screening length $\lambda$ in {}: The Coulomb inter... |
| `SCALERCUT` | real |  | 2. |  | ✓ 12 | Atom pairs are included in the neighborlist for structure constants, if their distance is less than the sum of covalent radii multiplied with SCALERCUT. (The covalent ... |

_Keys used by decks but not documented for this block: `HFWEIGHT`_

#### `!CONTROL!FOURIER`  (manual l.1155; optional)

Plane wave cutoffs $E_{PW}=\frac{1}{2}G_{max}^2$ for wave functions and charge density. A cutoff of 30 Ry=15 H for the wave function and CDUAL=2 is sufficient for most applications. In order to account for all plane wave components in the density, the plane wave cutoff for the density should in principle be four times the cutoff for the wave function. (For low cutoffs, even CDUAL$>$4 may be req...

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `EPWPSI` | real | Rydberg | 30. |  | ✓ 200 | plane wave cutoff for the wave functions in Rydberg (1 Ry=0.5 a.u.). All plane waves up to a maximum kinetic energy equal to the plane wave cutoff are considered. Note... |
| `EPWRHO` | real | Rydberg | 4*EPWPSI |  |  | plane wave cutoff for the charge density in Rydberg (1 Ry=0.5 a.u.) |
| `CDUAL` | real |  | 4 |  | ✓ 200 | EPWRHO=CDUAL*EPWPSI; The default cdual=4 produces the correct result; cdual=2 is often a good choice. |
| `EPWBUCKET` | real |  | none |  |  | Used mostly for cell dynamics. See section sec:sawtooth for an explanation of the sawtooth behavior. The parameter $E_B$ in Ry is specified as follows: If specified, a... |
| `BUCKETPAR` | real |  | 0. |  |  | Parameter $c_B$ see also description of EPWBUCKET above. |

#### `!CONTROL!PSIDYN`  (manual l.1223; optional; default uses default values for the electron dynamics.)

Parameters used to control the dynamics of the wave functions. The wave function dynamics is governed by the equation $$m_\Psi \vert\ddot{\tilde\Psi}_n\rangle = - {{\partial E}\over{\partial\langle\tilde\Psi_n\vert}} - m_\Psi\vert\dot{\tilde\Psi}_n\rangle \alpha - \sum_m\vert\tilde\Psi_m\rangle\Lambda_{mn}, $$ where $\alpha$ can be tuned by a Nose thermostat or the parameters below. The equatio...

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `STOP` | logical |  | F | T, F | ✓ 173 | if STOP=true start with zero velocity of the wave functions |
| `MPSI` | real |  | 10 $\Delta^2$ (for $\Delta$ see "!CONTROL!GENER... |  | ✓ 26 | mass $m_\Psi^0$ for the wave function dynamics. The wave function mass is an operator of the form m_=_{G} \|G m_^0(1+c G^2)G\| The coefficient $c$ is set in MPSICG2. T... |
| `MPSICG2` | real |  | $\frac{1}{2}(\frac{10}{2\pi})^2\frac{\Delta^2}{... |  | ✓ 24 | high-G enhancement $c$ for the wavefunction mass. The fictitious electron mass for the wave function dynamics is G-dependent $m_\Psi(G)=m_\Psi(1+c G^2)$. A recommended... |
| `FRIC` | real |  | 0.0 |  | ✓ 185 | constant friction $c_\alpha$ for the wave function dynamics |
| `SAFEORTHO` | logical |  | T | T, F | ✓ 117 | chooses the way the orthogonality constraints for the wave functions is enforced. If SAFEORTHO=T is selected the traditional way is used, which results in a strictly e... |
| `STRAIGHTEN` | logical |  | F | T, F | ✓ 19 | Transform the wave functions onto energy eigenstates. A unitary transform among the wave function is performed. The transform is performed only in the first iteration.... |
| `SWAPSTATES` | logical |  | F | T, F |  | Experimental option! You are on your own! Only used with SAFEORTHO=F. For SWAPSTATES=F, the approximate eigenstates are ordered in increasing energy expectation values... |

_Keys used by decks but not documented for this block: `M`, `SAVEORTHO`_

#### `!CONTROL!PSIDYN!AUTO`  (manual l.1403; optional)

Automatic annealing procedure for wave function dynamics. (overwrites setting of !CONTROL!PSIDYN:FRIC.) For optimizing the electronic structure the default set has been proven very useful. The friction switches between a lower and an upper value depending on whether the energy decreases or increases. The upper and lower friction values are each scaled in each time step. With this option, the pr...

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `FRIC(-)` | real |  | 0.3 |  | ✓ 179 | start value for the friction factor $c_\alpha$ used for decreasing energy |
| `FACT(-)` | real |  | 0.97 |  | ✓ 179 | factor multiplied with the friction factor FRIC(-) in each step that reduces the energy |
| `FRIC(+)` | real |  | 0.3 |  | ✓ 179 | start value for the friction factor $c_\alpha$ used for increasing energy |
| `FACT(+)` | real |  | 1.0 |  | ✓ 179 | factor multiplied with the friction factor FRIC(+) in each step that reduces the energy |
| `MINFRIC` | real |  | 0. |  | ✓ 174 | minimum friction used |

#### `!CONTROL!PSIDYN!THERMOSTAT`  (manual l.1454; optional)

Thermostat for the wave functions. This thermostat shuffles energy from the wave functions to the atomic motion, when the wave-function kinetic energy former exceeds an estimated target value $\frac{1}{2}\sum_iK_i\dot{\vec{R}}_i^2$. A friction on the thermostat shall be used to avoid instabilities. The thermostat shall be used only if the atoms are moving. M_iR_i = F_i+K_iR_ix_ Q_x_= 2(x_) (_n ...

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `PERIOD` | real | a.u. | see !CONTROL!PSIDYN!THERMOSTAT:FREQ[THz] |  |  | Oscillation period of the Nose variable in a.u. |
| `FREQ[THZ]` | real | THZ | 100. |  | ✓ 5 | Frequency of the Nose variable in THz. |
| `FRIC` | real |  | 0. |  | ✓ 5 | Friction acting on the Nose variable. Can have values between zero and one. The largest value before overdamping is $\frac{4\pi}{period}$, where period is that of the ... |
| `STOP` | logical |  | F | T, F | ✓ 5 | set velocity for Nose variable to zero in the first iteration |

_Keys used by decks but not documented for this block: `T[K]`_

#### `!CONTROL!RDYN`  (manual l.1522; optional; default is fixed atomic positions)

parameters used to control the dynamics of the atomic positions. The atomic dynamics is governed by the equation $$M_R \ddot R = - {{\partial E}\over{\partial R}} - M_R\dot R \alpha, $$ where $\alpha$ can be tuned by a Nose thermostat or the parameters below. The friction parameter $\alpha$ is converted into a parameter $c_\alpha= \alpha\Delta/2$, which can range from 0 to 1. A value of $c_\alp...

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `STOP` | logical |  | F | T, F | ✓ 64 | start with zero velocity for the atomic positions |
| `START` | logical |  | F | T, F |  | Take initial structure from structure control file instead of the restart file. |
| `RANDOM[K]` | real | K | 0 |  | ✓ 8 | adds random velocities once at the beginning of the simulation; the velocity distribution corresponds to a temperature in Kelvin. Can be used to bring the system quick... |
| `FRIC` | real |  | 0.0 |  | ✓ 57 | constant friction $c_\alpha$ |
| `NONEGEFRIC` | logical |  | false | T, F |  | Experimental option! Avoids negative friction on the atoms. It is recommended for structure optimizations. It must not be used in connection with thermostats. The fric... |
| `USEOPTFRIC` | logical |  | false | T, F |  | Experimental option! Estimates the optimum friction for optimization of the atomic structure. as $$a_{opt}=\Delta\sqrt{\frac{\dot{\vec{R}}\dot{\vec{F}}} {\dot{\vec{R}}... |

#### `!CONTROL!RDYN!AUTO`  (manual l.1611; optional)

Automatic annealing procedure for atomic motion (overwrites setting of !CONTROL!RDYN:FRIC). See the description for !CONTROL!PSIDYN!AUTO. Note that frequent switching between the lower and upper friction indicates a problem that can even result in a heating up of the electrons. In this case, switch to constant friction.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `FRIC(-)` | real |  | 0.0 |  | ✓ 61 | start value for the friction factor $c_\alpha$ used for decreasing energy |
| `FACT(-)` | real |  | 1.0 |  | ✓ 61 | factor multiplied with the friction factor FRIC(-) in each step that reduces the energy |
| `FRIC(+)` | real |  | 0.01 |  | ✓ 61 | start value for the friction factor $c_\alpha$ used for increasing energy |
| `FACT(+)` | real |  | 1.0 |  | ✓ 61 | factor multiplied with the friction factor FRIC(+) in each step that reduces the energy |
| `MINFRIC` | real |  | 0. |  | ✓ 3 | minimum friction used |

#### `!CONTROL!RDYN!THERMOSTAT`  (manual l.1686; optional)

Nose thermostat for creating a constant temperature ensemble for the ions. When using this thermostat, the friction acting indirectly on the atoms, and that results from a friction on the wavefunctions, is corrected for by an opposing force $C_i\dot{R}_if_\Psi$ acting on the atoms. $f_\Psi$ is the friction acting on the wave functions, which is either fixed or dynamically tuned by a wave functi...

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `T[K]` | real | K | 293.15 (=room temperature=20$^o$C) |  | ✓ 5 | temperature of the ions in Kelvin |
| `<EKIN>` | real |  | see T[K] |  |  | average kinetic energy of the atoms |
| `PERIOD` | real | a.u. | see !CONTROL!RDYN!THERMOSTAT:FREQ[THz] |  |  | Oscillation period of the Nose variable in a.u. |
| `FREQ[THZ]` | real | THZ | 10. |  | ✓ 5 | frequency of the Nose variable in THz. |
| `FRIC` | real |  | 0 |  | ✓ 5 | friction on the Nose variable. Sensible values lie between 0 and 1; FRIC=0 will give the original Nose thermostat. Without friction, the thermostat tends to induce lar... |
| `STOP` | logical |  | F | T, F | ✓ 5 | velocity for Nose variable is set to zero in the first iteration |

#### `!CONTROL!MERMIN`  (manual l.1751; optional)

Describes the treatment of variable occupations of the one-electron energy levels. It allows to describe the occupations as dynamical variables in the framework of the Mermin functional, which includes finite temperature effects. The total energy in this case is the free energy and includes an entropic term $-TS$ for the partially occupied orbitals at finite temperatures. The occupations will c...

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `T[K]` | real | K | 1000 |  | ✓ 64 | Temperature of the electrons in Kelvin (enters the Fermi distribution function) |
| `M` | real |  | 300 |  |  | mass for the occupation dynamics. Should be larger than 200. |
| `ADIABATIC` | logical |  | .false. | T, F | ✓ 64 | if true, a quasi-adiabatic mode for occupations is chosen. New "floating" energy levels $\tilde{\epsilon}_n(t)$ are introduced that approach the "true" energy levels i... |
| `RETARD` | real |  | 0. |  | ✓ 64 | Time scale in units of the time step $\Delta$ for the retardation of the occupation dynamics selected by !CONTROL!MERMIN:ADIABATIC. If the true energy levels $\epsilon... |
| `TETRA+` | logical |  | .false. | T, F | ✓ 63 | if true, the Brillouin zone integration is performed with the improved version of the tetrahedron method. If false, the Brillouin zone integration is done by sampling ... |
| `STOP` | logical |  | F | T, F | ✓ 44 | set velocity for occupation dynamics to zero in the first iteration |
| `STARTTYPE` | character |  | 'N' |  | ✓ 31 | defines how the initial occupations are determined. ['X':] Occupations are read from restart file. ['E':] energies are read from restart file. Occupations are construc... |
| `START` | logical |  | F | T, F | ✓ 10 | Restart occupations, total spin and total charge from Lagrange multipliers for wave function orthogonalization, which approximate the one-particle energies. If start=.... |
| `MOVE` | logical |  | T | T, F | ✓ 2 | Propagate occupations. Otherwise the occupations are kept frozen. |
| `FRIC` | real |  | 0.0 |  |  | friction for the occupation dynamics |
| `FIXQ` | logical |  | .true. | T, F |  | conserve total charge |
| `FIXS` | logical |  | .false. | T, F |  | conserve total spin |
| `EFERMI[EV]` | real | EV | 0.0 |  |  | chemical potential of the electrons in eV; only used if fixq=.false. |
| `MAGFIELD[EV]` | real | EV | 0.0 |  |  | external magnetic field in eV; only used if fixs=.false. |

#### `!CONTROL!CELL`  (manual l.1972; optional; default is fixed unit cell, and no stress calculation)

This option invokes pressure calculation, and Parrinello-Rahman dynamics of the unit cell, if requested.// Warning: The implementation of the unit-cell dynamics is still incompatible with atom constraints, because the forces of constraint are not yet considered Some additional information on cell dynamics is found in section sec:celldynamics on p. sec:celldynamics.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `MOVE` | logical |  | T | T, F | ✓ 1 | Dynamical evolution of the unit cell. |
| `STOP` | logical |  | F | T, F | ✓ 1 | reset velocities to zero |
| `FRIC` | real |  | none |  | ✓ 4 | friction parameter |
| `M` | real |  | mass corresponding to a period of 50*dt for dia... |  |  | mass for unit cell dynamics |
| `P` | real |  | 0.0 |  |  | external pressure |
| `P[GPA]` | real | GPA | 0.0 |  |  | external pressure in units of Giga Pascal |
| `CONSTRAINTTYPE` | character |  | 'FREE' | ISOTROPIC, NOSHEAR, UNIAXIAL_Z, NOSTRESS | ✓ 4 | Constraints on the cell dynamics. Allowed values are the following: 'ISOTROPIC' only allows isotropic expansions and contractions. 'NOSHEAR' allows anisotropic expansi... |

#### `!CONTROL!ANALYSE`  (manual l.2509; optional)

Prepares special data for analysis

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `OPTIC` | logical |  | false | T, F |  | This option is currently disconnected. Writes data required for the optic package of M. Alouani. Attention! Many files are written starting with extension ".optics..."... |

#### `!CONTROL!ANALYSE!TRA`  (manual l.2525; optional)

select trajectories to be written.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `R` | logical |  | .true. | T, F | ✓ 1 | positions and point charges. (extension "_r.tra") |
| `FORCE` | logical |  | .false. | T, F | ✓ 1 | forces acting on the atoms. (extension "_f.tra") |
| `E` | logical |  | .false. | T, F | ✓ 1 | total energy contributions. (extension "_e.tra") |
| `BANDS` | logical |  | .false. | T, F |  | one-particle energies.(not yet implemented, extension "_b.tra") |
| `QMMM` | logical |  | .false. | T, F |  | atomic trajectory including the environment studied with QM-MM coupling.(not yet implemented, extension "_rqmmm.tra") |
| `NSKIP` | integer |  | 0 |  |  | number of time slices to be skipped between two written ones. |

#### `!CONTROL!ANALYSE!WAVE`  (manual l.2667; optional,multiple)

Writes a wave function. The file created can then be processed by the paw_wave tool to produce an input file for OPENDX

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `TITLE` | character |  | none |  | ✓ 4 | title of the image. Currently it is not used other than in the printout. |
| `FILE` | character |  | none |  | ✓ 7 | full file name of the file to be produced, which can be converted into a input file for OPENDX using the paw_wave tool. |
| `DR` | real |  | 0.4 |  |  | grid spacing for the output file. rounded to get an integer factor relative to the real-space grid used in the calculation. |
| `B` | integer |  | none |  | ✓ 7 | band index |
| `K` | integer |  | 1 |  | ✓ 3 | k-point index |
| `S` | integer |  | 1 |  | ✓ 3 | spin index |
| `IMAG` | logical |  | F | T, F | ✓ 2 | use imaginary part |

_Keys used by decks but not documented for this block: `DIAG`_

#### `!CONTROL!ANALYSE!DENSITY`  (manual l.2720; optional,multiple)

Writes a density. The file created can then be processed by the paw_wave tool to produce an input file for OPENDX.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `TITLE` | character |  | none |  | ✓ 4 | title of the image. Currently it is not used other than in the printout. |
| `FILE` | character |  | none |  | ✓ 5 | full file name of the file to be produced, which can be converted into a input file for OPENDX using the paw_wave tool. |
| `DR` | real |  | 0.4 |  |  | grid spacing for the output file. rounded to get an integer factor relative to the real-space grid used in the calculation. |
| `TYPE` | character |  | 'TOTAL' | TOTAL, SPIN, UP, DOWN | ✓ 4 | can be 'TOTAL', 'SPIN', 'UP' or 'DOWN'. Determines the weights of the states in the density plots. 'TOTAL' takes the actual occupations and k-point- or uniform weights... |
| `OCC` | logical |  | T | T, F | ✓ 1 | use actual occupations. With OCC=F, all selected states contribute independent of their occupations. |
| `DIAG` | logical |  | T | T, F | ✓ 1 | use eigenstates in the subspace of the dynamic wave functions. |
| `CORE` | logical |  | F | T, F | ✓ 3 | include core density. |
| `EMIN[EV]` | real | EV | -1$^{-10}$ |  | ✓ 1 | lowest eigenenergy to be included. |
| `EMAX[EV]` | real | EV | 1$^{-10}$ |  | ✓ 1 | highest eigenenergy to be included. |
| `BMIN` | integer |  | 1 |  |  | lowest band to be included. |
| `BMAX` | integer |  | 10000000 |  |  | highest band to be included. |

#### `!CONTROL!ANALYSE!POTENTIAL`  (manual l.2804; optional)

Writes the hartree potential. The file created can then be processed by the paw_wave tool to produce an input file for OPENDX.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `TITLE` | character |  | none |  |  | title of the image. Currently it is not used other than in the printout. |
| `FILE` | character |  | none |  |  | full file name of the file to be produced, which can be converted into a input file for OPENDX using the paw_wave tool. |
| `DR` | real |  | 0.4 |  |  | grid spacing for the output file. It is rounded to get an integer factor relative to the real-space grid used in the calculation. |

#### `!CONTROL!ANALYSE!1DPOT`  (manual l.2830; optional)

Writes the Hartree potential averaged over planes perpendicular to a specified axis. Finite values are obtained only if the axis is an integer multiple of the real space lattice vectors. Caution! At this point only the plane wave part is implemented. See also the paw_1davpot tool described in section sec:1davpottool.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `TITLE` | character |  | none |  | ✓ 2 | title of the image. Currently it is not used other than in the printout. |
| `FILE` | character |  | none |  | ✓ 2 | full file name of the file to be produced. |
| `IT` | integer(3) |  | none |  | ✓ 2 | Relative coordinates of the axis defining the planar averages. |


### 3.4 Structure file `!STRUCTURE` (ROOT.strc)

#### `!STRUCTURE`  (manual l.3047; mandatory)

Defines the system to be studied. Specifies geometry, atom types, electronic occupations, atomic masses. etc...

_(container block, no keys of its own)_

#### `!STRUCTURE!GENERIC`  (manual l.3053; optional)

data that do not fit into other blocks.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `LUNIT` | real | a.u. | 1.0 |  | ✓ 140 | specifies the length unit (in atomic units) for structural input in this file. All data are converted into atomic units (1 a.u.=0.529167$\times 10^{-10}~$m) by multipl... |
| `LUNIT[AA]` | real | AA | none |  | ✓ 141 | specifies the length unit in angstrom for structural input in this file. All data are converted into atomic units (1 a.u.=0.529167$\times 10^{-10}~$m) by multiplicatio... |
| `STPVERSION` | character |  | none |  | ✓ 1 | overwrites the required version of the setup parameters file (parameters/stp.cntl). Background: Since version 2.0.0 of the paw code there is an internal check in the r... |

#### `!STRUCTURE!LATTICE`  (manual l.3086; mandatory)

lattice translation vectors

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `T` | real(3,3) |  | none |  | ✓ 281 | Lattice vectors in the order; (x,y,z of first vector; x,y,z of second vector...) |

#### `!STRUCTURE!KPOINTS`  (manual l.3099; optional)

specifies the k-point grid. Default is $\Gamma$-point sampling.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `R` | real |  | 12. |  | ✓ 173 | defines the density of k-points for the automatic generation of k-points. $\Delta k= 2\pi/R$. The number $n_i$ of k-points along the reciprocal lattice vector $\vec{g}... |
| `DIV` | integer(3) |  | 2 2 2 |  | ✓ 11 | fractions of reciprocal lattice vectors defining the reciprocal sublattice for the k-points.If K is not specified, the k-points are equally spaced an set compatible wi... |
| `SHIFT` | integer(3) |  | 0 0 0 |  |  | shift is displaces the K-point grid such that the $\Gamma$-point is avoided. The three components of SHIFT specify the shift directions into the three lattice vectors.... |
| `K` | integer(3) |  | 0 0 0 |  |  | k-point coordinates $(i_1,i_2,i_3)$ in units of fractions of reciprocal lattice vectors: $k_i = 1/2\ \sum_j G_{ij}*i_j/n_j$, where $G_{ij}$ is defined by the real spac... |

#### `!STRUCTURE!SPECIES`  (manual l.3160; Mandatory, multiple. (Even if no atoms are present, at least one atom type (s...)

Specifies an atom type (Element).

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `NAME` | character |  | none |  | ✓ 243 | Name of the atom type. It is recommended to begin the name with the two-character element symbol, where a whitespace as second character can be replaced by an undersco... |
| `ID` | character |  | none |  | ✓ 47 | Identifier for the setup type. Allows to select the parameter set defining the augmentation (e.g. partial waves and projector functions). The ID must be one of the int... |
| `M` | real | u (atomic mass unit) | Atomic mass, as obtained from !STRUCTURE!SPECIE... |  | ✓ 117 | Atomic mass in mass units (u=1822.89 a.u.=$\frac{1}{12}m(^{12}$C$)\approx$m$_p$). |
| `NPRO` | integer array |  | None |  | ✓ 242 | Array which determines the maximum number of projector functions per angular momentum -- together with its all-electron and pseudo partial waves -- used in the calcula... |
| `LRHOX` | integer |  | 2 |  | ✓ 242 | One center expansion for the density is limited to a maximum angular momentum of lrhox. If the value of LRHOX is larger $2\ell_{max}$, where $\ell_{max}$ is the maximu... |
| `RAD` | real |  | R(ASA) from periodictable object. Equals $1.105... |  | ✓ 6 | Atomic radius in a$_0$ used to evaluate the integration volume for the projected density of states etc. |
| `RAD/RCOV` | real | ratio to covalent radius | R(ASA) from periodictable object. Equals $1.105... |  | ✓ 192 | Atomic radius in units of the covalent radius used to evaluate the integration volume for the projected density of states etc. This radius must be smaller than !STRUCT... |

_Keys used by decks but not documented for this block: `FILE`, `RAD/COV`, `XXPS<G2>`, `XXPS<G4>`, `ZV`_

#### `!STRUCTURE!SPECIES!AUGMENT`  (manual l.3236; optional, mandatory, if !STRUCTURE!SPECIES:ID is not present)

Defines the augmentation, (e.g. partial waves and projector functions).

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `ID` | character |  | 'NONAME' |  | ✓ 198 | Setup identifier. Will be reported in the protocol file. |
| `EL` | character |  | none |  | ✓ 193 | Element symbol. |
| `Z` | real |  | none |  | ✓ 58 | Atomic number |
| `CORE` | character |  | When CORE is not specified, but ZV is, the code... | 0, He, Ne, Ar, Kr, Xe, Rn, -s, -p, -d, -f, +s, +p, +d, +f |  | Specifies the angular momentum shell in the frozen core. The identifier consists of an optional noble-gas element symbol and a set of modifiers, which add or remove an... |
| `ZV` | real |  | none |  | ✓ 198 | Number of valence electrons. |
| `RCSM/RCOV` | real | ratio to covalent radius | 0.25 |  | ✓ 198 | Radius for the compensation charge in units of the covalent radius. |
| `TYPE` | character |  | none | NDLSS, HBS, KERKER | ✓ 198 | Augmentation method. Allowed values are 'NDLSS', 'HBS' and 'KERKER'. |
| `RCL/RCOV` | real array | ratio to covalent radius | none |  | ✓ 198 | Radius parameter array for the construction of pseudo partial waves in units of the covalent radius. |
| `LAMBDA` | real array |  | none |  | ✓ 2 | Second parameter array for the construction of pseudo partial waves. Currently used only for TYPE='HBS'. |
| `RBOX/RCOV` | real | ratio to covalent radius | none |  | ✓ 198 | ......to be completed................ |

#### `!STRUCTURE!SPECIES!AUGMENT!POT`  (manual l.3344; mandatory in !STRUCTURE!SPECIES!AUGMENT)

Defines auxiliary potential. The radial component of the potential $v(\|\vec{r}\|)Y_s(\vec{r})$ is given by v(r)= a +br^{}+cr^{+2} \text{for $r<r_c$} v(r) \text{for $r> r_c$} where $v(r)$ is the radial component of the true atomic potential.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `POW` | real |  | none |  | ✓ 198 | Power $\alpha$ in the Taylor expansion. A higher value leads to a flatter potential at the origin. |
| `RC/RCOV` | real | ratio to covalent radius | none |  | ✓ 198 | Matching radius $r_c$ in units of the covalent radius. |
| `VAL0` | real |  | none |  | ✓ 64 | Value of the auxiliary potential at the origin VAL0=$a Y_s$. If not specified, the parameter $c$ is set to zero and the value $a$ is obtained from the differentiabilit... |

#### `!STRUCTURE!SPECIES!AUGMENT!CORE`  (manual l.3381; mandatory in !STRUCTURE!SPECIES!AUGMENT)

Defines auxiliary core density. The radial component of the density $n^c(\|\vec{r}\|)Y_s(\vec{r})$ is given by n^c(r)= a +br^{}+cr^{+2} \text{for $r<r_c$} n^c(r) \text{for $r> r_c$} where $n^c(r)$ is the radial component of the true core density.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `POW` | real |  | none |  | ✓ 198 | Power $\alpha$ in the Taylor expansion. A higher value leads to a flatter density at the origin. |
| `RC/RCOV` | real | ratio to covalent radius | none |  | ✓ 198 | Matching radius $r_c$ in units of the covalent radius. |
| `VAL0` | real |  | none |  |  | Value of the auxiliary core density at the origin VAL0=$a Y_s$. If not specified, the parameter $c$ is set to zero and the value $a$ is obtained from the differentiabi... |

#### `!STRUCTURE!SPECIES!AUGMENT!GRID`  (manual l.3417; mandatory in !STRUCTURE!SPECIES!AUGMENT)

Defines the radial grid for the one center expansions. The radial grid is a shifted logarithmic grid r(x)=r_1(e^{(x-1)}-1) with $x=1,2,3,\ldots,N$.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `DMIN` | real |  | none |  | ✓ 198 | Smallest spacing (at the origin). |
| `DMAX` | real |  | none |  | ✓ 198 | Largest spacing (at the end of the grid). |
| `RMAX` | real |  | none |  | ✓ 198 | Outermost grid point. |

#### `!STRUCTURE!SPECIES!NTBO`  (manual l.3447; optional, atom contribution is scaled to zero if not specified.)

Defines a set of local orbitals, called natural tight-binding orbitals (NTBOs). The NTBOs exhibit only scattering character in the context of nodeless wave functions except for the head. NTBOs are represented as screened LMTO's. The screened envelope function is constructed atom-by-atom as a multicenter expansion of atom-centered Hankel functions on a cluster of atoms. Interaction matrix elemen...

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `NOFL` | integer array |  | values from !STRUCTURE!SPECIES:NPRO |  | ✓ 178 | Number of tight-binding orbitals per angular momentum. The number of tight-binding orbitals per angular momentum must not exceed the number of projector functions. The... |
| `RAUG/RCOV` | real | ratio to covalent radius | 1. |  | ✓ 178 | Augmentation radius in units of the covalent radius of the atom. The augmentation radius defines where the partial waves are matched to the envelope function. The radi... |
| `LHFWEIGHT` | real |  | none |  | ✓ 178 | "local Hartree-Fock weight": Factor for admixture of the screened exchange for this atom type. The four-center integrals are scaled by $\sqrt[4]{\prod_{j=1}^4\alpha_j}... |
| `FOCKSETUP` | logical |  | false | T, F | ✓ 1 | Partial waves and projector functions are obtained from an atom calculated by a hybrid functional |
| `CV` | logical |  | true | T, F | ✓ 178 | Switch for core-valence exchange |
| `NDDO` | logical |  | false | T, F | ✓ 8 | Exchange term where the density of two orbitals of one atom interacts with the density of two orbitals of a bond partner. (untested experimental option) |
| `31` | logical |  | false | T, F | ✓ 8 | Exchange term with three orbitals on one site and one on the opposite side of a bond. That is, the density of two orbitals of one atom interacts with the overlap densi... |
| `BONDX` | logical |  | false | T, F | ✓ 5 | Exchange term of between two overlap densities from the same bond. Each overlap density is made from two orbitals centered at different bond partners. (untested experi... |

_Keys used by decks but not documented for this block: `RTAIL/RCOV`, `RTAILCUT/RCOV`, `TAILLAMBDA`_

#### `!STRUCTURE!ATOM`  (manual l.3565; mandatory, multiple)

Specifies one atom.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `NAME` | character |  | None |  | ✓ 276 | Atom name. If the Keyword "SP" is not specified, the first two characters have to be identical with the "NAME" of the corresponding species. It is recommended that the... |
| `R` | real(3) |  | None |  | ✓ 276 | Atomic coordinates in Cartesian coordinates and units of "!STRUCTURE!GENERIC:LUNIT". Note that the coordinates need not be updated, because the instantaneous coordinat... |
| `M` | real |  | Value specified for the corresponding species |  |  | Mass of this atom. Overwrites value specified in block "SPECIES". |
| `SP` | character |  | First two letters of the atom name |  |  | Name of the atom type (species) to which this atom belongs. |

#### `!STRUCTURE!OCCUPATIONS`  (manual l.3603; optional)

defines number of bands and the initial occupations of the one-particle states. The default occupations are chosen according to the assumption of zero temperature and that energies of the states increase with band index and that spin directions and k-points are degenerate. These default occupations can be changed, first by specifying the occupation of each state in !STRUCTURE!OCCUPATIONS!STATE ...

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `NSPIN` | integer |  | 1 |  | ✓ 180 | Number of spin directions. (1 for spin-restricted calculations and 2 for spin-polarized calculations, 3 for noncollinear spins) |
| `NBAND` | integer |  | calculated from the number of valence electrons... |  | ✓ 2 | Number of bands. A band is the number of states per k-point, where a state can hold two electrons in a spin-restricted calculation and one electron otherwise. |
| `EMPTY` | integer |  | calculated from the number of valence electrons... |  | ✓ 280 | Number of unoccupied bands. (see also keyword "NBAND") |
| `CHARGE[E]` | real | E | 0 |  | ✓ 82 | Ionization state of the entire system. An electron has the charge CHARGE[E]=-1. May be overwritten by "!STRUCTURE!STATE" |
| `SPIN[HBAR]` | real | HBAR | 0 |  | ✓ 102 | Total spin in $\hbar$. A single electron has SPIN[HBAR]=0.5 $\hbar$. May be overwritten by "!STRUCTURE!STATE" |

#### `!STRUCTURE!OCCUPATIONS!STATE`  (manual l.3654; optional)

allows one to change the number of electrons for certain states from the standard occupation. Standard occupation: states are completely filled beginning with the first, until the system is neutral; the highest occupied state may be partially occupied; all k-points and spin directions are occupied equally. Note that the occupation must decrease monotonically with the band index, unless the opti...

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `K` | integer |  | all k-points are selected |  |  | selects a k-point. Number refers to the order in which the k-points appeared. |
| `S` | integer |  | all spin directions are selected |  | ✓ 1 | selects a spin (1 or 2). S=2 is allowed only for spin polarized calculations (see !STRUCTURE!GENERIC) |
| `B` | integer |  | none |  | ✓ 1 | selects band |
| `F` | real |  | none |  | ✓ 1 | occupation |

#### `!STRUCTURE!ISOLATE`  (manual l.3692; optional)

Decouples the system electrostatically from its periodic images . Recommended isolated molecules. Isolate is also required to calculate approximate point charges for the QM-MM coupling.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `NF` | integer |  | 3 |  | ✓ 2 | Number of Gaussians used to fit the charge density. Should contain at least two. |
| `RC` | real |  | 0.5 |  | ✓ 2 | Smallest decay constant for the Gaussians. |
| `RCFAC` | real |  | 1.5 |  | ✓ 2 | Scaling factors for the decay constants. $r_c(i)=r_c(1)*{\rm RCFAC}^{i-1}$. |
| `GMAX2` | real |  | 3. |  | ✓ 2 | Cutoff for the plane waves of the pseudo charge density contributing to the fit |
| `DECOUPLE` | logical |  | .true. (.false. if the block !STRUCTURE!ISOLATE... | T, F | ✓ 3 | switches electrostatic decoupling of periodic images on. |

#### `!STRUCTURE!QM-MM!ATOM`  (manual l.3794; mandatory, multiple)

Describes the quantum-mechanical molecular-mechanical coupling.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `NAME` | character |  | None |  | ✓ 1 | Atom name. The atom names in the QM-MM block can be chosen independently from the choice in !STRUCTURE!ATOM. |
| `FFTYPE` | character |  | None |  | ✓ 1 | Atom type name describing the setting of the parameters. The naming convention must be consistent with the force field chosen. |
| `QMATOM` | character |  | None |  | ✓ 1 | Links the atomic position of this atom to the QM atom with the specified name (the name refers to that specified in !STRUCTURE!ATOMS. No atomic positions, masses or ch... |
| `R` | real(3) |  | None |  | ✓ 1 | atomic position. |
| `Q` | real |  | 0.0 |  | ✓ 1 | charge in electron charges (i.e. a positive value indicates a negatively charged atom. |
| `M` | real |  | interprets the first two letters of FFTYPE (a u... |  |  | Mass in proton masses |
| `ONLY` | character |  | Atom is part of the MM environment |  |  | specifies whether an atom is only in the MM shadow of the QM part but not in the MM part including the environment (ONLY='SHADOW') |

#### `!STRUCTURE!QM-MM!BOND`  (manual l.3851; optional,multiple)

specifies a bond for the classical force field

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `ATOM1` | character |  | none |  | ✓ 1 | name of the first atom in the bond, corresponding to !STRUCTURE!QM-MM!ATOM |
| `ATOM2` | character |  | none |  | ✓ 1 | name of the second atom in the bond, corresponding to !STRUCTURE!QM-MM!ATOM |
| `BO` | real |  | 1. |  | ✓ 1 | Bond order of the bond. BO=1 for a single bond, BO=2 for a double bond. BO=3 for a triple bond. |

#### `!STRUCTURE!GROUP`  (manual l.4001; Optional, multiple)

Groups a number of atoms together and defines a name for the group. A few groups are predefined: The group "ALL" containing all atoms and one group for all atoms for a given atom type with the name equal to species name

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `NAME` | character |  | None |  | ✓ 14 | Group name |
| `ATOMS` | character array |  | None |  | ✓ 14 | Names of atoms in the group |

#### `!STRUCTURE!CONSTRAINTS`  (manual l.4057; Optional)

Lists all constraints acting on atomic positions. The constraints are enforced using the scheme proposed by Ryckaert, Cicotti and Berendsen , which conserves the total energy in a MD simulation. Constraints are used to search for transition states, to force a system adiabatically over a reaction barrier and, to calculate free energies of reaction at finite temperatures, or to map out the total ...

_(container block, no keys of its own)_

#### `!STRUCTURE!CONSTRAINTS!RIGID`  (manual l.4071; optional, multiple)

constrains a group of atoms as a rigid body. Should not be used for linear molecules.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `GROUP` | character |  | None |  |  | Name of the group to be kept rigid |

#### `!STRUCTURE!CONSTRAINTS!FREEZE`  (manual l.4084; optional, multiple)

Keeps the specified atom or group fixed in space.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `GROUP` | character |  | None |  | ✓ 7 | Name of the atom-group to be fixed in space. |
| `ATOM` | character |  | None |  | ✓ 39 | Name of the atom to be fixed in space. |

#### `!STRUCTURE!CONSTRAINTS!TRANSLATION`  (manual l.4102; optional, multiple)

suppresses a translational momentum of a group of atoms in a given direction.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `GROUP` | character |  | 'ALL' |  |  | Name of group to be fixed in space. |
| `DIR` | real(3) |  | Translation into all three space direction is s... |  |  | Name of group to be fixed in space. |

#### `!STRUCTURE!CONSTRAINTS!ROTATION`  (manual l.4121; optional,multiple)

Suppresses the angular momentum $\vec{L}$ of a group of atoms in a given direction $\vec{e}$ in the reference frame of the center of gravity $\vec{R}_C(t)$ of the specified group.Thus the constraint enforces eL=e_R M_R(R_R(t)-R_C(t)) (R_R-R_C) =0 Note, that this constraint cannot be represented as a hypersurface in phase space. It should not be used for phase space sampling or transition state ...

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `GROUP` | character |  | 'ALL' |  |  | Name of group to be fixed in space. |
| `AXIS` | real(3) |  | Angular momentum into all three space direction... |  |  | Axis for which the angular momentum shall be constrained. |

#### `!STRUCTURE!CONSTRAINTS!BOND`  (manual l.4172; optional, multiple)

Fixes the distance between two atoms.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `ATOM1` | character |  | none |  | ✓ 30 | Name of the first atom. (Extended notation, see section sec:extendedatomnotation on p. sec:extendedatomnotation) |
| `ATOM2` | character |  | none |  | ✓ 30 | Name of the second atom. (Extended notation, see section sec:extendedatomnotation on p. sec:extendedatomnotation) |
| `MOVE` | logical |  | .false. | T, F | ✓ 29 | Defines whether constrained value shall be moved to a new location or whether it should be given a specified constant velocity. The method uses a lowest order polynomi... |
| `NSTEP` | integer |  | none |  | ✓ 26 | number of time steps after which the new constraint values shall be satisfied |
| `VALUE` | real |  | current value of the constraint. |  | ✓ 29 | specified new value for the constraint. |
| `VELOC` | real |  | 0.0 |  |  | specified new value for the velocity of the constraint. |
| `SHOW` | logical |  | .FALSE. | T, F | ✓ 30 | print value and force of the constraint in the "CONSTRAINTS" file (standard extension: _constr.report) |
| `FLOAT` | logical |  | .false. | T, F |  | defines this constraint as floating constraint. |
| `M` | real | a.u. | 1.0=$m_e$ |  |  | Mass of the constraint in a.u. A negative value results in an energy maximizing evolution for saddle point determination. |
| `FRIC` | real |  | 0.0 |  |  | Friction coefficient for the constraint dynamics. |

#### `!STRUCTURE!CONSTRAINTS!COGSEP`  (manual l.4423; optional, multiple)

Fixes the distance between the center of gravities of two atom groups.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `GROUP1` | character |  | none |  | ✓ 5 | First group of atoms |
| `GROUP2` | character |  | none |  | ✓ 5 | second group of atoms. |
| `MOVE` | logical |  | .false. | T, F |  | Defines whether constrained value shall be moved to a new location or whether it should be given a specified constant velocity. The method uses a lowest order polynomi... |
| `NSTEP` | integer |  | none |  |  | number of time steps after which the new constraint values shall be satisfied |
| `VALUE` | real |  | current value of the constraint. |  |  | specified new value for the constraint. |
| `VELOC` | real |  | 0.0 |  |  | specified new value for the velocity of the constraint. |
| `SHOW` | logical |  | .FALSE. | T, F | ✓ 5 | print value and force of the constraint in the "CONSTRAINTS" file (standard extension: _constr.report) |
| `FLOAT` | logical |  | .false. | T, F |  | defines this constraint as floating constraint. |
| `M` | real | a.u. | 1.0=$m_e$ |  |  | Mass of the constraint in a.u. A negative value results in an energy maximizing evolution for sassle point determination. |
| `FRIC` | real |  | 0.0 |  |  | Friction coefficient for the constraint dynamics. |

#### `!STRUCTURE!CONSTRAINTS!LINEAR`  (manual l.4588; optional, multiple)

Specifies a linear constraints of the form $\sum_R c_R R_R=a$. This very flexible type of constraint can be used to represent a complex constraint approximately in the neighborhood of a given structure. Hereby the nonlinear constraint is expanded into a Taylor expansion, and the first two terms are retained.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `MOVE` | logical |  | .false. | T, F | ✓ 3 | Defines whether constrained value shall be moved to a new location or whether it should be given a specified constant velocity. The method uses a lowest order polynomi... |
| `NSTEP` | integer |  | none |  | ✓ 3 | number of time steps after which the new constraint values shall be satisfied |
| `VALUE` | real |  | current value of the constraint. |  | ✓ 3 | specified new value for the constraint. |
| `VELOC` | real |  | 0.0 |  |  | specified new value for the velocity of the constraint. |
| `SHOW` | logical |  | .FALSE. | T, F | ✓ 2 | print value and force of the constraint in the "CONSTRAINTS" file (standard extension: _constr.report) |
| `FLOAT` | logical |  | .false. | T, F |  | defines this constraint as floating constraint. |
| `M` | real | a.u. | 1.0=$m_e$ |  |  | Mass of the constraint in a.u. A negative value results in an energy maximizing evolution for sassle point determination. |
| `FRIC` | real |  | 0.0 |  |  | Friction coefficient for the constraint dynamics. |

#### `!STRUCTURE!CONSTRAINTS!LINEAR!ATOM`  (manual l.4656; mandatory, multiple)

Specifies the contribution of one atom to the constraint vector

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `NAME` | character |  | none |  | ✓ 5 | name of the atom. |
| `R` | real(3) |  | none |  | ✓ 5 | vector defining $c_R$ |

#### `!STRUCTURE!ORBPOT!POT`  (manual l.4821; optional, multiple)

describes external potentials acting on orbitals

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `ATOM` | character |  | none |  | ✓ 29 | atom name or species name of the atom on which the potential should act, referring to name of !STRUCTURE!ATOMS, if a species name is given the potential will be applie... |
| `TYPE` | character |  | none | S, P, D, ALL, PX, PY, PZ, DX2-Y2, DXZ, D3Z2-R2, DZ2, DYZ,... | ✓ 29 | orbital type, can be 'S', 'P', 'D', 'ALL' or the ID of any real spherical harmonics with $\ell\le3$. The allowed values for real spherical harmonics are provided in ta... |
| `VALUE` | real | Hartree | none |  | ✓ 29 | value $U$ of the external potential at the atomic site in Hartree as defined above in eq:orbpot. |
| `RC` | real |  | covalent radius |  | ✓ 28 | cutoff radius $r_c$ in units of bohr radii as defined above in eq:orbpot |
| `PWR` | real |  | 2.0 |  |  | exponent $q$ for the radial cutoff function as defined above in eq:orbpot. |
| `S` | integer |  | 0 |  | ✓ 2 | restricts the spin, on which the potential acts. If this parameter is omitted the potential acts on all electrons irrespective of their spin direction. For a collinear... |


### 3.5 Tool control files (`.wcntl`, `.dcntl`, `.bcntl`, `.tcntl`)

#### `!WCNTL`  (manual l.5118; mandatory)

defines the operations done on the system; largely independent of the system

_(container block, no keys of its own)_

#### `!WCNTL!FILES!FILE`  (manual l.5131; optional, multiple)

defines filenames.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `ID` | character |  | none | STRC, WAVE, WAVEDX, CUBE, WRL, GNUCONTOUR, GNURUBBERSHEET | ✓ 36 | Identifier of the file. Can be 'STRC', 'WAVE', 'WAVEDX', 'CUBE' (default extension '.cub') 'WRL' (default extension '.wrl') 'GNUCONTOUR' (default extension '_c.gnu') '... |
| `EXT` | logical |  | .false. | T, F | ✓ 35 | rootname flag: if true, the filename is interpreted as an extension of the rootname. The rootname is the filename of the wave-control file with out the last dot and th... |
| `NAME` | character |  | none |  | ✓ 36 | File name. The default extension is 'wv' for the WAVE' file, 'strc' for the 'STRC' file, 'dx' for the output file for the data explorer, 'cub' for the output file in t... |

#### `!WCNTL!VIEWBOX`  (manual l.5187; optional)

Sets the view box. Only the data within the view box are shown. The view box is defined by an origin $\vec{O}$ and three vectors $\vec{t}_1,\vec{t}_2,\vec{t}_3$. The eight corners of the view box are $\vec{O}, \vec{O}+\vec{t}_1, \vec{O}+\vec{t}_2, \vec{O}+\vec{t}_3, \vec{O}+\vec{t}_1+\vec{t}_2, \vec{O}+\vec{t}_2+\vec{t}_3, \vec{O}+\vec{t}_1+\vec{t}_3, \vec{O}+\vec{t}_1+\vec{t}_2+\vec{t}_3$

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `O` | real(3) | a.u. | 0. 0. 0. |  | ✓ 36 | Origin (lower left, forward point of the view box) in a.u. |
| `C` | real(3) | a.u. | none. See \texttt{!WCNTL!VIEWBOX:O}. |  |  | Center of the view box in a.u. |
| `T` | real(3,3) |  | lattice vectors of the calculation |  | ✓ 36 | vectors $\vec{t}_1, \vec{t}_2, vec{t}_3$ defining the edges of the view box in a.u. |

#### `!WCNTL!PLANE`  (manual l.5218; optional)

defines a plane for a rubbersheet plot. The plane is defined by an origin $\vec{O}$ and two vectors $\vec{t}_1,\vec{t}_2$.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `O` | real(3) | a.u. | 0. 0. 0. |  | ✓ 6 | Origin $\vec{O}$ (lower,forward point of the plane) in a.u. |
| `C` | real(3) | a.u. | none. See \texttt{!WCNTL!VIEWBOX:O}. |  |  | Center of the plane in a.u. |
| `T` | real(3,2) |  | first two lattice vectors of the calculation |  | ✓ 6 | vectors $\vec{t}_1, \vec{t}_2$ defining the edges of the plane in a.u. The second vector will be orthogonalized to the first vector. |

#### `!TCNTL!FILES!FILE`  (manual l.5707; optional, multiple)

define the file name: {PROT} protocol. Standard extension: '.tprot' {CNTL} control input file for the paw_tra tool. The name of this file is mandatory input and cannot be reset. {STRC} structure output file produced by the simulation and used as input. standard extension: '.strc_out' {TRA} trajectory file produced by the simulation and used as input. standard extension: '_r.tra'

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `ID` | character |  | none |  | ✓ 1 | Identifier of the file. |
| `EXT` | logical |  | .false. | T, F | ✓ 1 | rootname flag: if true, the filename is interpreted as an extension of the rootname. The rootname is the filename of the wavecontrol file without the last dot and the ... |
| `NAME` | character |  | none |  | ✓ 1 | File name |

#### `!TCNTL!SEQUENCE`  (manual l.5743; optional)

specifies the beginning and ending time and the sampling frequency of the sequence to be analyzed.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `T1[PS]` | real | PS | time of the first frame on the trajectory file |  |  | Beginning time of the sequence in picoseconds |
| `T2[PS]` | real | PS | time of the last frame on the trajectory file |  |  | ending time of the sequence in picoseconds |
| `DT[FS]` | real | FS | spacing on the trajectory file |  |  | sampling frequency in femtoseconds |

#### `!TCNTL!MOVIE`  (manual l.5768; optional)

writes a input file for OPENDX to show the moving atoms as a ball-stick model. Bonds are drawn for every pair of atoms that are closer than 1.2 times the sum of the covalent radii.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `FORMAT` | character |  | 'DX' | DX, XYZ | ✓ 3 | descriptor for the format of the movie file to be created. can be 'DX' (OPENDX), 'XYZ' (xyz format) |
| `SKIP` | integer |  | 0. |  | ✓ 3 | number of frames on the input trajectory files that are skipped between movie frames |

#### `!TCNTL!MOVIE!VIEWBOX`  (manual l.5791; optional)

Sets the view box. Only the data within the view box are shown. The view box is defined by an origin $o$ and three vectors $t_1,t_2,t_3$. The eight corners of the view box are $o,o+t_1,o+t_2,o+t_3,o+t_1+t_2,o+t_2+t_3,o+t_1+t_3,o+t_1+t_2+t_3$

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `O` | real | a.u. | 0. 0. 0. |  | ✓ 1 | Origin (lower left, forward point of the view box) in a.u. |
| `C` | real |  | see ``!TCNTL!MOVIE!VIEWBOX:O'' |  | ✓ 3 | Center of viewbox |
| `T` | real(3,3) |  | lattice vectors of the calculation |  | ✓ 4 | vectors defining the edges of the view box |

#### `!TCNTL!MOVIE!FILE`  (manual l.5818; optional)

specify the file where the movie plot is written. The file is then used with an appropriate visualizer.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `EXT` | logical |  | .false. | T, F | ✓ 3 | switch to the rootname appended by the extension provided, versus using the filename (including its path). |
| `NAME` | character |  | the rootname appended by ``.movie.dx'' for !TCN... |  | ✓ 3 | file name |

#### `!TCNTL!TEMPERATURE`  (manual l.6081; optional, multiple)

prints the average temperatures of the atoms and optionally a plot for the temperature versus time for individual atoms. Warning: The temperatures are obtained from the kinetic energy using $g=3N$ where $N$ is the number of atoms in the selected group. If translations and/or rotations are excluded, the temperature given here is underestimated and must be rescaled by a factor $3N/(3N-5)$ for dim...

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `RETARD[PS]` | real | PS | 0. |  | ✓ 1 | The values are averaged over previous values with exponential decay. $$x(t)=\frac{1}{t_0}\int_{-\infty}^{t} dt^\prime x(t^\prime) \exp(-\frac{t-t^\prime}{t_0})$$ This ... |

#### `!TCNTL!TEMPERATURE!SELECT`  (manual l.6103; optional)

specify the atoms to be used. Unless specified, all atoms are plotted.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `ATOMS` | character |  | none |  | ✓ 1 | atom names consistent with the "strc" file. An arbitrary number of atoms can be included |

#### `!TCNTL!TEMPERATURE!FILE`  (manual l.6117; mandatory)

specifies the file where the plot is written. The file is formatted and to be used with an x-y plotting tool. Each line containes the time in ps and the temperature in Kelvin

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `EXT` | logical |  | .false. | T, F | ✓ 1 | switch to the rootname appended by the extension provided, versus using the filename (including its path). |
| `NAME` | character |  | the rootname appended by ``.tra.temp'' |  | ✓ 1 | file name |

#### `!TCNTL!MODE`  (manual l.6194; optional)

defines a vibrational mode of the system such as a bond length, an angle etc. Note that all bond vectors that define bonds, angles or torsions are mapped onto the minimum image.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `ID` | character |  | none |  | ✓ 2 | Identifier of this mode to be used in further operations can be any string, but different from all other mode-identifiers. |

#### `!TCNTL!MODE!BOND`  (manual l.6208; optional)

adds a bond length as a contribution defining a mode. The bond is defined as the distance between two atoms $R_1,R_2$.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `SCALE` | real |  | none |  | ✓ 2 | Scales the parameter before adding it to the mode. (Used for example to define symmetric and antisymmetric bond stretch modes.) |
| `ATOM1` | character |  | none |  | ✓ 2 | Name of the first atom $R_1$ defining the bond. The name is chosen consistent with the structure input file of the simulation code. |
| `ATOM2` | character |  | none |  | ✓ 2 | Name of the second atom $R_2$ defining the bond. The name is chosen consistent with the structure input file of the simulation code. |

#### `!TCNTL!MODE!ANGLE`  (manual l.6237; optional)

adds a bond angle as a contribution defining a mode. The bond angle is the angle between the two bonds $(R_1,R_2)$ and $(R_2,R_3)$ The unit for angles is such that $2\pi$ is a full turn.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `SCALE` | real |  | none |  | ✓ 1 | Scales the parameter before adding it to the mode. |
| `ATOM1` | character |  | none |  | ✓ 1 | Name of the first terminal atom $R_1$ defining the bond angle. The name is chosen consistent with the structure input file of the simulation code. |
| `ATOM2` | character |  | none |  | ✓ 1 | Name of the central atom $R_2$ defining the bond angle. The name is chosen consistent with the structure input file of the simulation code. |
| `ATOM3` | character |  | none |  | ✓ 1 | Name of the second terminal atom $R_3$ defining the bond angle. The name is chosen consistent with the structure input file of the simulation code. |

#### `!TCNTL!MODE!MODE`  (manual l.6321; optional)

adds a predefined mode as a contribution defining a mode.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `SCALE` | real |  | none |  | ✓ 1 | Scales the parameter before adding it to the mode. |
| `ID` | character |  | none |  | ✓ 1 | ID of the mode to be included. |

#### `!TCNTL!OUTPUT`  (manual l.6339; optional, multiple)

writes the time dependence of a mode to file

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `ID` | character |  | none |  | ✓ 1 | identifier of the mode to be printed |
| `FILENAME` | character |  | none |  | ✓ 1 | file name of the file to which the result is written |
| `TYPE` | character |  | position |  | ✓ 1 | Defines the property to be written, default: the mode itself 'VELOCITY' the time derivative of the mode |

#### `!DCNTL`  (manual l.7013; optional)

defines the operations done on the system; largely independent of the system

_(container block, no keys of its own)_

#### `!DCNTL!GENERIC`  (manual l.7021; optional)

defines generic settings

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `MODE` | character |  | 'TETRA' |  |  | defines the mode for the calculation of the density of states: "SAMPLE" uses only the calculated energies on the diskrete k-point lattice. "TETRA" denotes the calculat... |
| `PREFIX` | character |  | '' |  | ✓ 72 | String will be prepended to the file names of density of states and number of states files |

#### `!DCNTL!GRID`  (manual l.7056; optional)

defines the energy grid and thermal energy broadening. The grid extends from the minimum energy value to the minimum energy of the highest band. Read section sec:thermalbroadening for the background of the thermal broadening. Large energy gaps are excluded from the grid.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `DE[EV]` | real | EV | 10$^{-2}$ |  | ✓ 5 | spacing of the grid points on the energy grid in eV. The value will be adjusted consistent with an integer number of grid points. |
| `BROADENING[EV]` | real | EV | 300 Kelvin/eV |  | ✓ 1 | Thermal broadening $k_BT$ of the density of states expressed in eV. |
| `BROADENING[K]` | real | K | 300. |  | ✓ 16 | Thermal broadening $k_BT$ of the density of states with $T$ expressed in Kelvin. |

_Keys used by decks but not documented for this block: `EMAX[EV]`, `EMIN[EV]`_

#### `!DCNTL!FILES!FILE`  (manual l.7113; optional, multiple)

Specifies one file

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `ID` | character |  | none | PROT, ERR, PDOS | ✓ 1 | identifier for the file; options are: ['PROT']protocol file Standard extension:'.dprot' ['ERR']error file Standard extension:'.derr' ['PDOS'] data file produced by the... |
| `NAME` | character |  | none |  | ✓ 1 | filename. Can be the relative file name or an extension to the PAW "root". Standard output can be specified by NAME='stdout' and EXT=.false. |
| `EXT` | logical |  | .false. | T, F |  | .true.: NAME specifies the extension only/ .false.: full name |

#### `!DCNTL!ORBITAL`  (manual l.7151; optional)

defines an orbital

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `NAME` | character |  | none |  | ✓ 10 | names the newly defined orbital !DCNTL!ORBITAL!ORB |

#### `!DCNTL!ORBITAL!ORB`  (manual l.7163; optional, multiple)

select an orbital (fragment) to be added to the current orbital An elementary unit of a general orbital is a contribution from a single site in a specific unit cell. This contribution can be specified by an angular momentum character or as hybrid orbital. The orbital can be chosen as one of basic types TYPE in a local coordinate system. An existing orbital can be selected using NAME. The orbita...

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `NAME` | character |  | none |  |  | specifies an orbital previously specified by another block !DCNTL!ORBITAL!ORB |
| `FAC` | complex |  | 1.0 |  | ✓ 5 | Orbital coefficient, with which it contributes to the orbital to be built. |
| `IT` | integer(3) |  | none |  |  | translations along the three real space lattice vectors. The entire orbital is shifted by $\sum_{j=1}^3\vec{T}_j IT_j$. |
| `ATOM` | character |  | none |  | ✓ 10 | atom name on which the orbital resides. (Extended notation, see section sec:extendedatomnotation on p. sec:extendedatomnotation) |
| `TYPE` | character |  | none | S, PX, PY, PZ, SP1, SP2, SP3, DXY, DZ2, D3Z2-R2, DXZ, DYZ... | ✓ 10 | orbital type. Can be one of the following: 'S', 'PX', 'PY', 'PZ', 'SP1', 'SP2', 'SP3', 'DXY', 'DZ2' or 'D3Z2-R2', 'DXZ', 'DYZ', 'DX2-Y2', 'FX(X2-3Y2)', 'FZ(X2-Y2)', 'F... |
| `Z` | real(3) |  | 0.0,0.0,1.0 |  |  | vector defining the new z-direction to which TYPE refers |
| `NNZ` | character |  | see Z |  | ✓ 9 | atom name of the atom to which the vector defining the new z-direction points. (Extended notation, see section sec:extendedatomnotation on p. sec:extendedatomnotation) |
| `X` | real(3) |  | 1.0,0.0,0.0 |  |  | vector defining the new xz-plane together with z to which TYPE refers |
| `NNX` | character |  | see X |  | ✓ 6 | atom name of the atom to which the vector defining the new x-direction points. (Extended notation, see section sec:extendedatomnotation on p. sec:extendedatomnotation) |

#### `!DCNTL!WEIGHT`  (manual l.7259; optional,multiple)

defines orbital weights; three ways to specify the weights are possible specify "TYPE"; rather unspecific selections such as total density of states. specify one or several sub-blocks "!ATOM"; selects contributions from different atoms. specify one or several sub-blocks "!ORB". Most specific version, identifying individual orbitals The selection type is not compatible with the other two possibi...

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `ID` | character |  | none |  | ✓ 72 | defines the name for this set of matrix elements. This ID defines the name of the output file as PREFIX//ID//'.dos', where PREFIX is defined in !DCNTL!GENERIC:PREFIX. ... |
| `LEGEND` | character |  | none |  |  | defines the legend used in the plot to annotate the dataset. |
| `TYPE` | character |  | none | ALL, EMPTY, TOTAL | ✓ 72 | specifies how the weights are defined; can be ["ALL"] sum over all projected density of states ["EMPTY"] weight of the wave function not considered in any projection [... |
| `SPIN` | character |  | '+Z' |  |  | specifies the axis $\vec{e}_S$ for the spin projection. The density of states is divided into contributions from eigenstates into spin eigenstates parallel and anti-pa... |

#### `!DCNTL!WEIGHT!ATOM`  (manual l.7329; optional)

select the angular momentum weights from a given atom.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `NAME` | character |  | none |  | ✓ 71 | atom name from which the contribution to this weight is selected |
| `TYPE` | character |  | none | ALL, S, P, D, F, SD | ✓ 71 | selects the weights from this atom. Can be ["ALL"] sum over all projected density of states on this atom ["S"] angular-momentum weight for $\ell=0$ ["P"] angular-momen... |

#### `!DCNTL!WEIGHT!ORB`  (manual l.7357; optional)

usage is same as !DCNTL!ORBITAL!ORB

_(container block, no keys of its own)_

#### `!DCNTL!COOP`  (manual l.7363; optional)

selects off-diagonal matrix elements of the density-of-states operator. The off-diagonal elements are defined by all pairs of orbitals specified in !DCNTL!COOP!ORB1 on the one hand and in !DCNTL!COOP!ORB2 on the other hand. While it is possible, it is not recommended to use more than one pair of orbitals. The result of multiple orbitals is the sum of all coops that can be built from orbitals al...

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `ID` | character |  | none |  | ✓ 12 | defines the name for this set of matrix elements. This ID defines the name of the output file as PREFIX//ID//'.dos', where PREFIX is defined in !DCNTL!GENERIC:PREFIX. ... |
| `LEGEND` | character |  | none |  |  | defines the legend used in the plot to annotate the dataset. |
| `SPIN` | character |  | '+Z' |  |  | specifies the axis $\vec{e}_S$ for the spin projection. The density of states is projected onto contributions from spin eigenstates parallel (not antiparallel) to this... |

#### `!DCNTL!COOP!ORB1`  (manual l.7418; optional, multiple)

selects the 'left' orbital of the density of states matrix element Usage is same as !DCNTL!ORBITAL!ORB

_(container block, no keys of its own)_

#### `!DCNTL!COOP!ORB2`  (manual l.7426; optional, multiple)

selects the 'right' orbital of the density of states matrix element Usage is same as !DCNTL!ORBITAL!ORB

_(container block, no keys of its own)_

#### `!DPCNTL`  (manual l.7520; mandatory)

containes directions on what the tool shall do

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `EZERO[EV]` | real | EV | 0. |  | ✓ 35 | shifts the energy axis of all graphs so the specified value (in eV) is the new energy zero. (Often this is chosen as the highest occupied state, respectively the Fermi... |
| `EMIN[EV]` | real | EV | none |  | ✓ 77 | lower bound (in eV) of the energy interval shown |
| `EMAX[EV]` | real | EV | none |  | ✓ 77 | upper bound (in eV) of the energy interval shown |
| `YMIN` | real |  | none |  | ✓ 77 | lower bound in 1/eV of the density-of-states interval shown. A negative value allows to also show the opposite spin direction. |
| `YMAX` | real |  | none |  | ✓ 77 | upper bound in 1/eV of the density-of-states interval shown. |

#### `!DPCNTL!GRAPH`  (manual l.7562; optional, multiple)

Defines a graph.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `PREFIX` | character |  | '' |  | ✓ 77 | Default for the prefix used in this graph. The name of the density of states data produced by paw_dos are constructed by appending the prefix specified here to the set... |
| `SCALE` | real |  | 1. |  | ✓ 14 | default value for the scale factor of the Density of States used in this graph |
| `EZERO[EV]` | real | EV | set by !DPCNTL:XZERO |  | ✓ 4 | shifts the energy axis of sets in this graph so the specified value (in eV) is the new energy zero. May be overwritten by EZERO in !SET. |
| `YMIN` | real |  | set by !DPCNTL:YMIN |  | ✓ 28 | lower bound in 1/eV of the density-of-states interval shown. A negative value allows to also show the opposite spin direction. |
| `YMAX` | real |  | set by !DPCNTL:YMAX |  | ✓ 30 | upper bound in 1/eV of the density-of-states interval shown. |

#### `!DPCNTL!GRAPH!SET`  (manual l.7607; optional, multiple)

Defines a set of density of states. A set contains the density of states (irrespective of their occupation) density of states weighted with occupation For collinear spin polarized calculation, the spin-up density is written first followed by the spin down density.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `ID` | character |  | none |  | ✓ 77 | identifier for set. The name of the density of states data produced by paw_dos are constructed by appending the prefix to the set-id, and by appending the extension '.... |
| `PREFIX` | character |  | is set by !DCNTL!GRAPH:PREFIX |  |  | Prefix used for this set. The name of the density of states data produced by paw_dos are constructed by appending the prefix specified here to the set-id, and by appen... |
| `SCALE` | real |  | set by !DCNTL!GRAPH:SCALE |  |  | scale factor of the Density of States used in this graph |
| `EZERO[EV]` | real | EV | set by !DPCNTL!GRAPH:XZERO |  |  | shifts the energy axis for this set so the specified value (in eV) is the new energy zero. |
| `STACK` | logical |  | F | T, F | ✓ 68 | If true, this set is added ontop of an existing stack. This redefines the new set and the stack. If STACK is non-existent or has the value .false. the stack is reset t... |
| `COLOR` | character |  | '' |  | ✓ 30 | Fills the density of states with color. The colors to the left of the following table may be used. The corresponding colors on the right will be used for the empty den... |
| `LEGEND` | logical |  | .false. | T, F | ✓ 70 | Switch to include a legend-block in the plot when true. |

_Keys used by decks but not documented for this block: `FILLCOLOR`_

#### `!BCNTL!INPUTFILE`  (manual l.7971; optional)

Defines banddata file.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `NAME` | character |  | Rootname of the project with extension '.banddata' |  |  | File name of banddata file from paw calculation. Usually the extension of the file name is '.banddata' and the main part is equal to the rootname of the calculation. |

#### `!BCNTL!BANDSTRUCTURE`  (manual l.7987; optional)

defines the bandstructure to be computed and plotted including fatbands

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `MODE` | character |  | 'LINEARINTERPOLATION' | LINEARINTERPOLATION, DIAG, DIAGONALISATION, DIAGONALIZATION | ✓ 2 | Mode of the calculation of the bandstructure. The two possible values are 'LINEARINTERPOLATION" and 'DIAG', which are described below. The value 'DIAG' may be replaced... |
| `METHOD_DIAG` | integer |  | 1 |  |  | Method used for the diagonalisation of the paw Hamiltonian (generalized eigenvalue problem). Currently the two Lapack-functions zhegvd (method_diag=1) and zhegv (metho... |
| `EPWPSI` | real | Rydberg | value from paw calculation (from banddata-file) |  |  | Planewave cutoff in Rydberg for the calculation of the eigenstates of the paw hamiltonian. The default is to use the same value as in the paw calculation, which is sto... |

#### `!BCNTL!BANDSTRUCTURE!LINE`  (manual l.8019; optional,multiple)

Line segment in k-space, i.e. a part of a bandstructure

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `XK1` | real(3) |  | none |  |  | First point of the line segment in relative coordinates of the reciprocal lattice vectors. The k-point in cartesian coordinates is $\vec{k}$. It is obtained from the r... |
| `KVEC1` | real(3) |  | none |  | ✓ 2 | First point of the line segment in cartesian coordinates. |
| `XK2` | real(3) |  | none |  |  | Last point of the line segment in relative coordinates of the reciprocal lattice vectors. See the description of variable $xk1$ for the relation of absolute and relati... |
| `KVEC2` | real(3) |  | none |  | ✓ 2 | Last point of the line segment in cartesian coordinates. |
| `KVECSCALE` | real |  | $2\pi$ |  | ✓ 2 | scale factor for kvec1 and kvec2 so that they can be given in common coordinates, i.e. $\vec k=\frac{2\pi}{kvecscale}\vec k_{input}$. |
| `SPIN` | integer |  | 1 |  |  | spin direction. In a spin-polarized collinear calculation the parameter can have the values 1 or 2. |
| `NK` | integer |  | 10 |  | ✓ 2 | number of grid points along the line segment. |
| `NKDIAG` | integer |  | NK |  |  | number of grid points along the line segment for diagonalisation. IF NKDIAG$<$NK the bands obtained from the diagonalisation of the paw hamiltonian will be interpolate... |
| `NB` | integer |  | 20 |  | ✓ 2 | number of bands |
| `XKPROJECT` | real(3) |  | (0.,0.,0.) |  |  | direction for the projection for 2-d band structures in relative coordinates of the reciprocal lattice vectors. Not yet implemented for METHOD=1. |
| `NPROJECT` | integer |  | 1 |  |  | number of displaced band line segments for the projection for 2-d band structures. Not yet implemented for METHOD=1. |
| `FILE` | character |  | none |  | ✓ 2 | Output file. |
| `TAPPEND` | logical |  | F | T, F | ✓ 2 | If TAPPEND is true, then the output data from the current line segment will be appended at the end of the file FILE. The default behaviour, i.e. when TAPPEND is false ... |

#### `!BCNTL!PDOS`  (manual l.8167; optional)

defines the calculation of energy eigenvalues and projections, i.e. the calculation of a new PDOS-file, which is compatible with the one produced from the main paw program.

| Key | Type | Unit | Default | Allowed | Used | Description |
|---|---|---|---|---|---|---|
| `NKDIV` | integer(3) |  |  |  |  | fractions of reciprocal lattice vectors defining the reciprocal sublattice for the k-points. See also !STRUCTURE!KPOINTS!DIV |
| `PDOSINFILE` | character |  | \$ROOT.pdos |  |  | filename of the PDOS-file to be read. |
| `PDOSOUTFILE` | character |  | \$ROOT.pdosout |  |  | filename of the new PDOS-file to be written. |
| `NB` | integer |  | 20 |  |  | number of bands. This parameter does not influence the computational complexity, because the full spectrum of the paw hamiltonian is calculated. It only determines the... |
| `METHOD_DIAG` | integer |  | 1 |  |  | see !BCNTL!BANDSTRUCTURE!method_diag |
| `EPWPSI` | real |  | value from paw calculation (from banddata-file) |  |  | see !BCNTL!BANDSTRUCTURE!EPWPSI |
| `SPACEGROUP` | integer |  | 1 |  |  | Symmetry of the crystal used for reducing the number of k-points that have to be calculated. Sequential number according to International Tables for Crystallography, V... |
| `TSHIFT` | logical |  | F | T, F |  | setting TSHIFT to true excludes the Gamma point from the set of k-points. |
| `ISHIFT` | integer(3) |  | (0,0,0) |  |  | defines a shift of the k-point grid. |


### 3.6 Remaining documented blocks (not used by any deck; see the JSON / `schema-tables.md`)

`!CONTROL!RDYN!WARMUP` (l.1655), `!CONTROL!MERMIN!DIAL` (l.1940), `!CONTROL!CELL!CONSTRAINT` (l.2045), `!CONTROL!QM-MM` (l.2084), `!CONTROL!QM-MM!AUTO` (l.2135), `!CONTROL!QM-MM!THERMOSTAT` (l.2176), `!CONTROL!COSMO` (l.2221), `!CONTROL!ANALYSE!HYPERFINE` (l.2568), `!CONTROL!ANALYSE!CORELEVELS` (l.2637), `!CONTROL!ANALYSE!EELS` (l.2858), `!STRUCTURE!CONFINE` (l.3734), `!STRUCTURE!QM-MM` (l.3768), `!STRUCTURE!QM-MM!LINK` (l.3876), `!STRUCTURE!COSMO` (l.3914), `!STRUCTURE!COSMO!ATOM` (l.3942), `!STRUCTURE!VEXT` (l.4021), `!STRUCTURE!VEXT!UNBIND` (l.4028), `!STRUCTURE!CONSTRAINTS!ORIENTATION` (l.4151), `!STRUCTURE!CONSTRAINTS!ANGLE` (l.4251), `!STRUCTURE!CONSTRAINTS!TORSION` (l.4333), `!STRUCTURE!CONSTRAINTS!MIDPLANE` (l.4498), `!STRUCTURE!ORBPOT` (l.4765), `!GCNTL` (l.4935), `!GCNTL!GENERIC` (l.4942), `!GCNTL!SUBSTANCE` (l.4955), `!GCNTL!REACTION` (l.4974), `!GCNTL!REACTION!FROM` (l.4987), `!GCNTL!REACTION!TO` (l.5006), `!WCNTL!FILES` (l.5125), `!WCNTL!GENERIC` (l.5169), `!TCNTL` (l.5686), `!TCNTL!FILES` (l.5693), `!TCNTL!MOVIE!SELECT` (l.5839), `!TCNTL!CORRELATION` (l.5853), `!TCNTL!CORRELATION!FILE` (l.5893), `!TCNTL!CORRELATION!CENTER` (l.5912), `!TCNTL!CORRELATION!CENTER!SELECT` (l.5918), `!TCNTL!CORRELATION!PARTNER` (l.5932), `!TCNTL!CORRELATION!PARTNER!SELECT` (l.5938), `!TCNTL!SNAPSHOT` (l.5952), `!TCNTL!SNAPSHOT!FILE` (l.5975), `!TCNTL!CELL` (l.6008), `!TCNTL!CELL!FILE` (l.6021), `!TCNTL!SPAGHETTI` (l.6040), `!TCNTL!SPAGHETTI!FILE` (l.6046), `!TCNTL!SPAGHETTI!SELECT` (l.6067), `!TCNTL!SOFT` (l.6138), `!TCNTL!SOFT!SELECT` (l.6150), `!TCNTL!SOFT!FILE` (l.6164), `!TCNTL!NEIGHBORS` (l.6186), `!TCNTL!MODE!TORSION` (l.6275), `!DCNTL!FILES` (l.7107), `!BCNTL` (l.7965), `!BCNTL!BANDSTRUCTURE!LINE!FATBAND` (l.8123), `!PCNTL` (l.8526), `!PCNTL!GENERIC` (l.8533), `!PCNTL!FILES` (l.8561), `!PCNTL!FILES!FILE` (l.8567), `!PCNTL!OUTPUT` (l.8601), `!PCNTL!FREEZEONLY` (l.8637), `!PCNTL!MOVEONLY` (l.8657), `!STRC!ATOM` (l.8687), `!STRC!BOND` (l.8708)

## 4. Output formats

Source-level evidence for this section is in `.scratch/cppaw/outputs/output-formats.md` (612 lines, file:line citations for every claim); this section condenses it and adds the tool runs performed on the smoke-test outputs. Conventions: every standard file is `ROOT` + extension, registered by `FILEHANDLER$SETFILE` in `STANDARDFILES` (`paw_ioroutines.f90:672-866`); binary files are gfortran sequential-unformatted (each record = int32 length, payload, int32 length; little-endian; no header records); all binary data are in atomic units.

### 4.1 `ROOT.prot` — the protocol (text, **opened in APPEND mode**)

Written by `paw_fast.x` (file ID `PROT`, `POSITION='APPEND'`, `paw_ioroutines.f90:707-718`): **every run in the same directory appends to the same file** — the reference `h2o/case.prot` contains 9 runs (`grep -c "PROGRAM STARTED"`). Only MPI task 1 writes. Order of a run: banner + version info → `PROGRAM STARTED on <date>` → `UNUSED ELEMENTS FROM INPUT FILE` (CONTROL) → `INFORMATION FROM CONTROL INPUT FILE` → `UNUSED ELEMENTS` (STRUCTURE) → reports (WAVE FUNCTIONS, DENSITY FUNCTIONAL, ATOMIC SETUP per species, ATOMS, ATOMLIST REPORT, UNIT CELL, AUTOMATIC MINIMIZER, K-POINTS, OCCUPATIONS, GROUPLIST, FILE REPORT, RUN-TIME REPORT of the initialisation) → first-step detailed block → `!>` lines → detailed block every `NWRITE` steps and on the last step → `FILE REPORT` → `RUN-TIME REPORT` → `PROGRAM FINISHED`.

Per-iteration line (`paw_driver.f90:1084-1086`, format `("!>",I6,1X,F9.5,1X,I5,1X,F10.6,1X,F13.6,1X,F13.6,1X,F7.4,1X,F7.4)`; header re-emitted after each detailed block):

```
    NFI  T[PSEC] T[K]   EKIN(PSI)        E(RHO)         ECONS   ANNEE   ANNER
!>   148   0.01790     0   0.000000    -17.329013    -17.329013  0.2000  0.0000
```

| col | meaning | unit |
|---|---|---|
| NFI | step counter (continues from the restart file) | – |
| T[PSEC] | simulated time NFI·DT | ps |
| T[K] | instantaneous ionic temperature (integer) | K |
| EKIN(PSI) | fictitious kinetic energy of the wave functions (minus BO correction) | H |
| E(RHO) | **total energy** | H |
| ECONS | conserved energy (E + fictitious + ionic kinetic + thermostats) | H |
| ANNEE / ANNER | current friction for wave functions / atoms | – |

Detailed block (h2o smoke run, final):

```
ENERGY REPORT                                        <- '(A40,":",F15.7," ",A10)' paw_lists.f90:219
=============
TOTAL ENERGY                            :    -17.3290129 H
AE  KINETIC                             :     17.2939661 H
...
IONIC KINETIC ENERGY                    :      0.0000000 H
IONIC TEMPERATURE                       :      0.0000000 H         <- k_B T in Hartree, not Kelvin
WAVEFUNCTION KINETIC ENERGY             :      0.0000000 H

ATOMLIST REPORT                                      <- paw_atoms.f90:212-264
===============
T1[ANGSTROM]= -4.579219  4.578144  5.330866
T2[ANGSTROM]=  3.954668  3.954360  5.198388
T3[ANGSTROM]= -0.503186  8.329380  0.001050
NAME          POSITION[ANGSTROM]            M[U]    MPSI_EFF[U] Q[E]           FORCE[MH/ABOHR]
O_1      (  0.00000,  0.00000,  0.11926)   15.9994    3.3263  -0.00000
H_2      (  0.00000,  0.76324, -0.47705)    2.0000    0.1139  -0.00000

EIGENVALUES [EV] FOR K-POINT    1 AND SPIN 1         <- paw_waves2.f90:2971-2980, rows of 10, '(I4,":",10F8.3)'
================================================================
  0: -25.343 -13.147  -9.289  -6.863  -1.444   1.083   1.573   3.612   5.210   5.831
 10:   6.882   9.032   9.522  10.856  12.280  13.124  14.149  16.858  17.843  20.614
BAND INDEX OF HOMO FOR SPIN 1..........................:          4
SMALLEST DIRECT GAP....................................:     5.7002 EV AT IK=    1 AND ISPIN=1
ABSOLUTE GAP...........................................:     5.7002 EV
          FROM BAND=    4 AT IK=    1 WITH ISPIN=1 TO BAND     5 AT IK=    1 WITH ISPIN=1
HOMO-ENERGY............................................:   -6.89616 EV
LUMO-ENERGY............................................:   -1.19596 EV
```

**Forces / ATOMLIST — the exact rule** (`paw_atoms.f90:257-259`):

```fortran
IF(ALLOCATED(FORCE).AND.TDYN.AND..NOT.TSTOP) THEN
  WRITE(STRING(73:100),FMT='("(",F7.2,",",F7.2,",",F7.2,")")')FORCE(:,IAT)*1.D+3
END IF
```

* `TDYN` is set from `ATOMS$SETL4('MOVE', <!CONTROL!RDYN block exists>)` (`paw_ioroutines.f90:1526-1530`): **forces are printed only when a `!RDYN` block is present** (`.prot` says `ATOMS ARE PROPAGATED`). Without it the header still shows `FORCE[MH/ABOHR]` but the column is empty (h2o above, si2 §7.2). This is the root cause of audit finding PARSE-1.
* `TSTOP` = `!RDYN STOP=T`; it is cleared after the first propagation step (`paw_atoms.f90:454-457`), so with `STOP=T` the *initial* ATOMLIST has no forces and all later ones do. Verified in `si2_rdyn` (§7.4): `SI1 (0.00000, 0.00000, 0.00000) 28.0855 0.5365 -0.00000 ( 0.01, 0.01, 0.01)`.
* Units: positions Å, masses u, `Q[E]` = −(Gaussian-fit point charge), forces **milli-Hartree/Bohr with 2 decimals** (resolution 0.01 mH/a₀ = 5e-4 eV/Å). There is no higher-precision force output in this build: `_f.tra` (`!ANALYSE!TRA FORCE=T`) is written but contains zeros (verified with and without `!RDYN`, §7.4). For tighter relaxations let CP-PAW relax (`!RDYN!AUTO`) rather than driving an external optimiser from protocol forces.
* Column layout is fixed: name 1-9, `(x, y, z)` 10-42, M 43-50, MPSI_EFF 53-60, Q 63-70, force 73-97. Regex: `^(\S{1,9})\s*\(\s*(-?\d+\.\d+),\s*(-?\d+\.\d+),\s*(-?\d+\.\d+)\)\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+\(\s*(-?\d+\.\d+),\s*(-?\d+\.\d+),\s*(-?\d+\.\d+)\))?\s*$`.

Where to find things in `.prot`:

| Quantity | Anchor | Unit | Notes |
|---|---|---|---|
| Run boundaries | `PROGRAM STARTED on `, `==...  PROGRAM FINISHED <date> ...==` (`paw.f90:73-76`) | | split the file on the banner; a run without `PROGRAM FINISHED` did not end normally |
| Code version | `hash=`, `branch=`, `committed on=` | | |
| Requested steps / DT / NWRITE | `NUMBER OF ITERATIONS...:`, `TIME STEP...: 5.00000 A.U.`, `DETAILED INFORMATION AFTER EACH...: 100 TIME STEPS` | | in `INFORMATION FROM CONTROL INPUT FILE` |
| Start mode | `START WITH RANDOM WAVE FUNCTIONS` or `START WITH WAVE FUNCTIONS FROM FILE...: RESTART_IN`; `INITIAL POSITIONS TAKEN FROM STRUCTURE FILE|RESTART FILE`; `INITIAL UNIT CELL FROM RESTART FILE` | | |
| Ions moved | `ATOMS ARE PROPAGATED` / `ATOMS ARE NOT PROPAGATED` | | |
| Total energy per step | column 5 of `!>` | H | |
| Total energy, decomposition | `TOTAL ENERGY`, `AE  KINETIC`, `AE  ELECTROSTATIC`, `AE  EXCHANGE-CORRELATION`, `PS  ...`, `IONIC KINETIC ENERGY`, `IONIC TEMPERATURE`, `WAVEFUNCTION KINETIC ENERGY` in `ENERGY REPORT` | H | fixed width: `line[:40]`, `line[41:56]` |
| Temperature | column 3 of `!>` (K); `IONIC TEMPERATURE` (H) | | |
| Forces & geometry | `ATOMLIST REPORT` (see above) | Å, mH/a₀ | last block after the last `!>` line = final state |
| Eigenvalues, HOMO/LUMO, gaps | `EIGENVALUES [EV] FOR K-POINT n [AND SPIN s]`, `BAND INDEX OF HOMO[ FOR SPIN s]`, `SMALLEST DIRECT GAP`, `ABSOLUTE GAP` (+ `FROM BAND=` line), `HOMO-ENERGY`, `LUMO-ENERGY`, `MATERIAL IS A METAL: USE VARIABLE OCCUPATIONS` | eV | with `!MERMIN` (variable occupations) the block is `OCCUPATIONS AND ENERGY EXPECTATION VALUES [EV]` with `EIG n:` / `OCC n:` rows and diagonal Hamiltonian elements instead of eigenvalues |
| Occupations | `OCC  n:` rows under `OCCUPATIONS` in the input report (fixed occupations: printed once) | e | include spin degeneracy (max 2 for NSPIN=1, 1 for NSPIN=2), exclude k-weights |
| Convergence / stop | ` STOP SIGNAL FROM AUTOPILOT`, ` STOP SIGNAL RECEIVED` (leading blank, list-directed) | | running out of NSTEP prints nothing; criterion in `AUTOMATIC MINIMIZER`: `ENERGY TOLERANCE FOR TERMINATION`, `#STEPS BEFORE TERMINATION IS CONSIDERED` |
| Steps done, timing | second `RUN-TIME REPORT`: `NUMBER OF ITERATIONS..........:`, `ELAPSED WALLCLOCK TIME........:  0H 0M10.5S`, `TOTAL CPU TIME` | | omitted when only 1 iteration |
| Files written | `FILE REPORT` table `IDENTIFIER FILENAME` | | |
| Input problems | lines between `START LIST OF UNUSED ELEMENTS` and `END LIST OF UNUSED ELEMENTS` (`~!CONTROL!RDYN_X!STOP`) | | |
| Error | message lines then `STOP IN <ROUTINE>` (`paw_error.f90:260`), no `PROGRAM FINISHED` | | routine names have `$`→`__` |
| Not in .prot | `CONSTANT ENERGY <ECONS> <drift>` and `READING:/WRITING :` restart log go to **stdout** | | |

### 4.2 stdout / stderr

The manual recommends `1>ROOT.err 2>&1`. Content: `TRACE-PUSH/POP/MEM` lines, setup-construction SCF log, `LIB_FFTW: CREATE PLAN...`, restart I/O log (`READING: WAVES`, `WRITING : ENDOFFILE`), ` CONSTANT ENERGY  <ECONS>  <ECONS-drift>` at the end, `NORMAL STOP: CALLING MPE__STOPALL TO CLOSE DOWN` (stdout) and `STOP NORMAL STOP IN MPE__STOPALL` (stderr, from the Fortran STOP). Errors: `ERROR STOP ERROR STOP IN MPE__STOPALL` (stderr) + the message lines; gfortran `Fortran runtime error:` for crashes. Success test = exit code 0 **and** `PROGRAM FINISHED` in `.prot`.

### 4.3 `ROOT.strc_out` (text, rewritten after **every** time step, `STATUS='REPLACE'`)

`STRCOUT` (`paw_ioroutines.f90:7142-7256`) dumps the in-memory STRC tree with the current lattice (`!LATTICE T=`) and positions (`!ATOM R=`, plus `Q=` point charge and `INDEX=`) in units of `LUNIT`; missing blocks get their resolved defaults (`M=`, `!KPOINTS DIV=`, `!CONSTRAINTS`). Format is `LINKEDLIST$WRITE`: one token per line, list-directed reals:

```
!STRUCTURE
!GENERIC
LUNIT=
   1.8897261000000001
!END
...
!ATOM
NAME=
 'O_1'
R=
   0.0000000000000000
   0.0000000000000000
  0.11926200000000001
SP=
 'O_'
Q=
  -0.0000000000000000
INDEX=
           1
!END
```

It is a valid STRC input and is what `paw_wave.x`/`paw_tra.x`/`paw_strc.x` read. Parse: `^!(\S+)$` opens/closes blocks (`!END`, `!EOB`), `^([A-Z0-9_/\[\]()+\-.<>]+)=$` starts a key whose values follow one per line. Note the h2o `.strc_out` reproduces the misplaced empty `!ISOLATE` sub-blocks of the input verbatim.

### 4.4 `ROOT.rstrt` (binary, 9.8 MB for h2o)

Written when `TLAST .OR. (TPRINT .AND. .NOT.TFIRST)` (`paw_driver.f90:120`) i.e. every `NWRITE` steps and at the end; read when `START=F`. Sequence of 388-byte separator records (`NREC, ID(32), NAME(32), VERSION(64), NOTES(256)`; IDs `HEADER, TIMESTEP, ATOMS, CELL, OCCUPATIONS, WAVES, ENDOFFILE`, `paw_report.f90:108-119`) each followed by data records. Not meant for external parsing; treat as opaque. Atomscope only needs to know: it holds wave functions **and** positions **and** cell; `RSTRTTYPE='STATIC'` halves it; `RESTART_OUT=/dev/null` disables it (then NFI does not advance between runs).

### 4.5 `ROOT_r.tra` (binary trajectory, on by default) and `_e.tra`, `_f.tra`

`TRAJECTORYIO` (`paw_iotra.f90:392-394`): one record per step, `WRITE(NFIL) ISTEP(int32), TIME(real64, a.u.), NSIZE(int32), ARRAY(NSIZE real64)`; on disk `4 + 16 + 8·NSIZE + 4` bytes; **APPEND** mode (re-runs append; the reference h2o file holds 3 × 222 steps each restarting at ISTEP=1), buffered 100 records, flushed at every `NWRITE`/last step. Controlled by `!CONTROL!ANALYSE!TRA R= E= FORCE=` (`R` defaults **T**, `paw_ioroutines.f90:2694`).

| file | NSIZE | layout (a.u.) |
|---|---|---|
| `_r.tra` | 9+8·NAT | lattice `T` (9, column-major), positions `R` (3·NAT), point charges `Q` (NAT), `(q,mx,my,mz)` per atom (4·NAT) |
| `_e.tra` | 8 | T[K], EKINC, EKINP, ETOT, ECONS, ENOSEE, ENOSEP, HEAT |
| `_f.tra` | 4·NAT | intended: forces (3·NAT, H/a₀) + NAT zeros; **observed: all zeros in this build**, with and without `!RDYN` |

```python
import struct
def read_tra(path):
    with open(path,'rb') as f:
        while (m := f.read(4)):
            n, = struct.unpack('<i', m); rec = f.read(n); f.read(4)
            istep, time, nsize = struct.unpack_from('<idi', rec, 0)
            yield istep, time, struct.unpack_from(f'<{nsize}d', rec, 16)
```

h2o first record decoded: `ISTEP=1, TIME=5.1, NSIZE=33`, doubles 1-9 = lattice in Bohr (= `.strc` × 1.8897261), 10-18 = positions in Bohr. Converters: `paw_tra.x ROOT.tcntl` (needs `ROOT.strc_out`; `!TCNTL!MOVIE FORMAT='XYZ'|'DX' SKIP=n` → `movie.xyz` extended-xyz with `Lattice="..." Properties=species:S:1:pos:R:3 Iter= Time=` in Å; `!TEMPERATURE`, `!MODE!BOND/ANGLE/TORSION`, `!CORRELATION`, `!SNAPSHOT` write `.tra.*` text files); `paw_toxyz.x -O ROOT` converts only the *final* structure (`.strc_out`) to `ROOT.xyz` **in Bohr**; `paw_converttra.x infile outfile dt` and `paw_cleantra.x` handle a *legacy* `ISTEP,NAT,R` layout and are stale with respect to the current writer — do not use them. The reader in `paw_tra.f90` also mis-orders the charge/moment block (positions/cell are fine).

### 4.6 `ROOT_constr.report` (text, APPEND, every step)

`==================== TIMESTEP: <NFI> ====================` per step (`paw_driver.f90:1231-1236`); for each constraint with `SHOW=T`: `!>` + index + `(value, -force)` pairs in `ES10.4E1` (a.u.). Without constraints only headers appear (h2o, si2). Note `^!>` therefore also occurs in this file.

### 4.7 `ROOT.pdos` (binary) → `paw_dos.x` → `<prefix><ID>.dos` (text)

`.pdos` is written at every detailed step (`WAVES$WRITEPDOS`, overwritten, `paw_driver.f90:1178`); layout per manual l.9350-9392: `NAT,NSP,NKPT,NSPIN,NDIM,NPRO,LNXX`, `LNX,LOX,ISPECIES`, `RBAS,R0`, per species `IZ,RAD,VAL,DER,OV`, per k-point/spin `XK,NB` and per band `EIG, PROJ(NDIM,NPRO)` (complex projections ⟨p̃|Ψ̃⟩). Recent files start with a flag record (`FLAG OF PDOS FILE=181213` in the `.dprot`).

`paw_dos.x ROOT.dcntl` (run on the h2o smoke output with the course's `h2o.dcntl`, 1 s):

```
!DCNTL
  !GENERIC  PREFIX='dos_' !END                    # MODE='TETRA' default (SAMPLE disabled)
  !GRID  BROADENING[K]=2000. !END                 # or BROADENING[EV], DE[EV], EMIN[EV], EMAX[EV]
  !WEIGHT ID='total' TYPE='TOTAL' !END
  !WEIGHT ID='os'  !ATOM NAME='O_1' TYPE='S' !END !END      # TYPE = ALL|S|P|D|F
  !WEIGHT ID='h'   !ATOM NAME='H_2' TYPE='ALL' !END  !ATOM NAME='H_3' TYPE='ALL' !END !END
  !COOP ID='o-h'   !ORB1 ATOM='O_1' TYPE='SP3' NNZ='H_2' !END  !ORB2 ATOM='H_2' TYPE='S' NNZ='O_1' !END !END
!END
!EOB
```

Outputs: `dos_total.dos dos_os.dos dos_op.dos dos_h.dos dos_o-h.dos` and `case.dprot` (contains `PROJECTED CHARGE ANALYSIS` / `PROJECTED SPIN ANALYSIS` tables per atom and `FERMI LEVEL....: -6.86665 EV`). Each `.dos` file (`PUTONGRID_*`, `paw_dos.f90`, format `(F14.8,2F20.8)`): `E[eV]  DOS_maxocc  DOS_actualocc` in states/eV; for NSPIN=2 the spin-down curve follows with **negative sign** (`SIG=-1`); each spin block starts with a line `EMIN 0 0`:

```
  -25.48088931          0.00000000          0.00000000
  -25.48088931          0.02091892          0.02091892
  -25.47088837          0.02204217          0.02204217
```

`paw_dosplot.x ROOT.dpcntl` turns `.dos` files into an xmgrace batch (`ROOT.bat`), optional.

### 4.8 `ROOT.banddata` (binary) → `paw_bands.x` → `<FILE>.dat`

`.banddata` (2.5 MB for h2o) holds the PAW Hamiltonian/overlap in the plane-wave basis for non-self-consistent diagonalisation at arbitrary k (`BANDDATA$WRITEFILE`, overwritten at every detailed step). Run on the si2 smoke output (10 s):

```
!BCNTL
  !INPUTFILE NAME='si2.banddata' !END
  !BANDSTRUCTURE MODE='DIAGONALISATION'
    !LINE FILE='si2_bands.dat' NK=10 NB=8 KVEC1=0. 0. 0. KVEC2=1. 0. 0. KVECSCALE=10.26 !END
    !LINE FILE='si2_bands.dat' NK=10 NB=8 TAPPEND=T KVEC1=1. 0. 0. KVEC2=.5 .5 .5 KVECSCALE=10.26 !END
  !END
!END
!EOB
```

`si2_bands.dat`: per `!LINE` a header (`#DATA FOR LINE BLOCK n`, `#NUMBER OF K-POINTS`, `#FIRST/LAST K-POINT IN ABSOLUTE/RELATIVE COORDINATES`) then `NK` rows `x  E1 ... E_NB` (`F10.5`, x = fractional position along the segment 0..1, energies in **eV**, absolute scale — no Fermi-level shift; k-vectors are in units of 2π/KVECSCALE):

```
   0.00000  -4.33750   7.70464   7.70479   7.70506  10.17349  10.17361  10.17365  11.25135
   0.11111  -4.28334   7.37154   7.47471   7.47483  10.04905  10.47146  10.47155  11.57002
```

`!BCNTL!PDOS NKDIV= NB=` instead produces a `.pdosout` on a dense k-mesh for `paw_dos.x`. Protocol: `ROOT.bprot`.

### 4.9 `.wv` (binary waveplot) → `paw_wave.x` → `.cub`, `.dx`, `.wrl`, `_c.gnu`, `_r.gnu`, `.wprot`

Produced by `!CONTROL!ANALYSE!WAVE` / `!DENSITY` / `!POTENTIAL` blocks in the CNTL, written only in the **last** step (`GRAPHICS$SETL4('WAKE',TPRINT.AND.TLAST)`, `paw_driver.f90:114`). Layout (manual l.9306-9348): `'WAVEPLOT',LEN(TITLE)`; `TITLE`; `RBAS(3,3),NAT`; `NR1,NR2,NR3`; `NAME(NAT)`; `Z(NAT)`; `POS(3,NAT)`; `Q(NAT)`; `WAVE(NR1,NR2,NR3)`; `'END OF FILE'`. Grid point (i1,i2,i3) sits at Σ RBAS(:,j)·(i_j−1)/NR_j. Selection in the CNTL:

| Block | Keys | Meaning |
|---|---|---|
| `!ANALYSE!WAVE` | `FILE`, `TITLE`, `B` (band index), `K` (k-point index, default 1), `S` (spin 1/2, default 1), `IMAG` (T: imaginary part), `DR` (grid spacing, a₀; default 0.4), `DIAG` | one Kohn-Sham orbital; several `!WAVE` blocks allowed |
| `!ANALYSE!DENSITY` | `FILE`, `TITLE`, `TYPE='TOTAL'|'SPIN'|'UP'|'DOWN'`, `OCC` (weight by occupations), `CORE`, `DIAG`, `EMIN[EV]`/`EMAX[EV]` (energy window), `DR` | total / spin / partial density |
| `!ANALYSE!POTENTIAL` | `FILE`, `DR` | effective potential |

`paw_wave.x ROOT.wcntl` (h2o run, 2 s):

```
!WCNTL
  !FILES
    !FILE ID='STRC' EXT=F NAME='case.strc_out' !END       # atoms/cell for the picture (default ROOT.strc_out)
    !FILE ID='WAVE' EXT=F NAME='case_total_density.wv' !END
    !FILE ID='CUBE' EXT=F NAME='case_total_density.cub' !END   # also WAVEDX (.dx), VRML (.wrl), GNUCONTOUR, GNURUBBERSHEET
  !END
  !VIEWBOX O=-9.4486306 -10.890945 -10.350124 T=18.897261 0 0  0 21.78189 0  0 0 20.024124 !END   # a.u.; atoms inside the box incl. periodic images
  !PLANE O=... T=... !END                                  # optional 2-D cut for gnuplot
!END
!EOB
```

The **root of the `.wcntl` file** determines the default output names (`case_total_density.wcntl` → `case_total_density.dx/.cub/.wrl/.wprot`). Cube file: line 1 `CP-PAW CUBE FILE`, line 2 comment, line 3 `NAT ox oy oz` (Bohr), lines 4-6 `NRi  dx dy dz` (Bohr), then `NAT` lines `Z  charge  x y z` (Bohr) — 27 atoms for h2o because the 3×3×3 periodic images that fall into the view box are included — then the values in Gaussian-cube order (`MAKECUBE`, `paw_wave.f90:366`). The `.dx` file is the OpenDX general array format (23 MB for 80³ points); `.wrl` an isosurface scene. Atomscope should generate the cube only: `!FILE ID='WAVEDX' EXT=F NAME='/dev/null' !END` (and likewise `VRML`) works — verified, the `.wprot` FILE REPORT then shows `WAVEDX /dev/null` and no `.dx` is written.

### 4.10 Other files

* `ROOT_stpforz<Z>.myxml` (one per element, 0.6-1.3 MB): setup report (partial waves, projectors, potentials on the radial grid) in LINKEDLIST syntax (`!SETUPREPORT !AUGMENTATION LNX= ...`); consumed by `paw_stpa.x -s scattering|nb|nc|atom.l|atom.e|atom.f|npro ...`. Ignore for energies/forces.
* `psphi.dat`: debug dump (r, ψ̃) written into the cwd during setup construction; ignore.
* `ROOT.exit`: **input** — create to stop; deleted by the code at the *start* of the next run.
* `ROOT.err`, `ROOT.info`: registered, normally absent (errors go to stderr and `.prot`).
* Tool protocols: `.wprot`, `.dprot`, `.dpprot`, `.bprot`, `.tprot`, `.sprot`, `.pprot` — same banner/`UNUSED ELEMENTS`/`FILE REPORT` structure as `.prot`, ending with `PAW_<TOOL> TOOL FINISHED` or `PROGRAM FINISHED`.

## 5. Units and conversions

CP-PAW works internally in Hartree atomic units (manual "Units and constants",
l.9470-9596: ħ = e = mₑ = 4πε₀ = 1). The CONSTANTS object values printed in the
manual (CODATA) are the ones the code uses; Atomscope must use the *same*
factors when round-tripping so that regenerated inputs reproduce the original
numbers:

| Quantity | CP-PAW internal | Factor used by CP-PAW | ASE unit | Conversion Atomscope applies |
|---|---|---|---|---|
| Length | Bohr (a₀) | 1 Å = 1.889726 a₀; 1 a₀ = 0.529177 Å | Å | Å = a₀ × 0.529177 |
| Energy | Hartree (H) | 1 H = 27.211396 eV; 1 Ry = 0.5 H; 1 H = 2625.500 kJ/mol = 627.5096 kcal/mol | eV | eV = H × 27.211396 |
| Force | H/a₀ | protocol prints **mH/a₀** (milli-Hartree per Bohr) | eV/Å | eV/Å = (mH/a₀) × 1e-3 × 27.211396 / 0.529177 = (mH/a₀) × 0.0514220 |
| Time | τ₀ (a.u.) | 1 τ₀ = 2.418884e-17 s = 0.02418884 fs; 1 ps = 41341.37 τ₀ | fs (ASE `units.fs`) | fs = τ₀ × 0.02418884 |
| Mass | mₑ | 1 u = 1822.889 mₑ | u | inputs (`!SPECIES M=`) are in u already |
| Temperature | Hartree (kB·T) | kB = 3.166679e-6 H/K | K | protocol prints T[K] directly in the `!>` lines; `IONIC TEMPERATURE` in the energy report is in H |
| Charge | e | — | e | none |
| Spin | ħ | `SPIN[HBAR]` = total spin S in ħ; one unpaired electron = 0.5, so S = ½·(N↑−N↓) (manual l.3645) | ASE `initial_magnetic_moments` sum μ = N↑−N↓ | SPIN[HBAR] = μ / 2 |
| Dipole | e·a₀ | 1 Debye = 0.393430 e·a₀ | Debye | — |
| Plane-wave cutoff | Ry | `!FOURIER EPWPSI` and `EPWRHO` are in **Rydberg** | eV | eV = Ry × 13.605698 |
| Angles | radian | — | degrees | — |

Where units appear in the inputs and outputs:

| File / place | Unit |
|---|---|
| `!STRUCTURE!GENERIC LUNIT` (or `LUNIT[AA]`) | multiplies every length in the STRC file (lattice `T=`, `!ATOM R=`); `LUNIT=1.8897261` means "coordinates in Å" (h2o deck); `LUNIT=10.26` means lattice-constant units (si2 deck: Si a = 10.26 a₀ and fractional-looking coordinates). Default 1.0 = Bohr. |
| `!CONTROL!GENERIC DT` | a.u. of time (default 5.0 ≈ 0.12 fs) |
| `!CONTROL!GENERIC ETOL` | Hartree |
| `!CONTROL!FOURIER EPWPSI`, `EPWRHO` | Rydberg |
| `!STRUCTURE!OCCUPATIONS CHARGE[E]`, `SPIN[HBAR]` | e, ħ (bracket suffix is part of the keyword) |
| `!STRUCTURE!KPOINTS R` | a₀ (real-space distance used to pick the k-mesh) |
| thermostat `T[K]`, `FREQ[THZ]`, `RANDOM[K]` | K, THz, K |
| `.prot` `!>` lines | `T[PSEC]` ps, `T[K]` K, `EKIN(PSI)`, `E(RHO)`, `ECONS` in **Hartree** |
| `.prot` ENERGY REPORT | Hartree (`H`) |
| `.prot` ATOMLIST REPORT | `T1[ANGSTROM]`, `POSITION[ANGSTROM]`, `M[U]`, `Q[E]`, `FORCE[MH/ABOHR]` |
| `.prot` eigenvalues, gaps, HOMO/LUMO | eV (`EIGENVALUES [EV]`, `ABSOLUTE GAP ... EV`) |
| `.strc_out` | same units as input (`LUNIT` is written back; values printed in Fortran free format, one number per line) |
| `_r.tra` | atomic units (Bohr, Hartree, τ₀) — see section 4 |
| `.cub` (paw_wave.x) | Bohr for origin/axes/atoms, density in e/a₀³ (standard Gaussian cube convention) |
| `.pdos`, `.banddata` | Hartree (binary); `paw_dos.x` `.dos` files and `paw_bands.x` `.dat` files are always written in **eV** (`E/EV` in `paw_dos.f90`, `EBI` in eV in `paw_bands.f90`); grid/window keys of `.dcntl` carry `[EV]`/`[K]` suffixes |

## 6. Tutorial deck families (candidate integration-test fixtures)

The tutorial ("CP-PAW Hands-On Course — Tutorial", Blöchl/Schade/ten Brink, 2019 edition, PDF in `~/Documents`) has the chapters: 1 Preparation (shell, compiling CP-PAW, `paw_install`, `PAWDIR`, project layout) · 2 Structure of the water molecule (input format, STRC, CNTL, 2.7 optimising the wave functions, 2.8 optimising the atomic positions) · 3 Molecular wave functions of a water molecule (3.3 plotting MOs with `!ANALYSE!WAVE` + `paw_wave.x`, 3.4 contour plots, 3.5 DOS and COOPs with `paw_dos.x`/`paw_dosplot.x`) · 4 Malonaldehyde (4.4 build structure, 4.5 optimise electrons, 4.6 relax atoms, 4.7 analyse: MOs/DOS/COOP, 4.8 presentation) · 5 Ab-initio MD of malonaldehyde (Nosé thermostats for atoms and wave functions, constraints, equilibration, `paw_tra.x` mode analysis, movies) · 6 Solids (silicon: k-points, band structure with `paw_bands.x`; 6.4 aluminium metal with `!MERMIN`) · 7 Magnetism (7.2 ferromagnetic iron; NiO antiferromagnet in the second-week projects) · 8 Convergence tests (8.2 `EPWPSI`, 8.3 `EPWRHO`/`CDUAL`, 8.4 k-points, 8.5 cell size for molecules). The 2022 second-week projects add Graphene, H in Pd (Jahn-Teller), Ruby, Schottky barrier, Si surface reconstruction, Si phase diagram and the SN2 reaction.

Commands the tutorial has students run (verbatim from the decks' scripts and `paw_do`): `paw_fast.x ROOT.cntl 1>out 2>&1 &`, `tail -f ROOT.prot`, `paw_show -ce ROOT` / `paw_show -e -u ev -o e.png ROOT`, `touch ROOT.exit`, `paw_wave.x ROOT.wcntl`, `paw_dos.x ROOT.dcntl` then `paw_get -w efermi -u ev -n ROOT` + `paw_resolve -r EFERMI=... -i ROOT.dpcntl` + `paw_dosplot.x ROOT.dpcntl` + `xmgrace -batch ROOT.bat`, `paw_bands.x ROOT.bcntl` + `xmgrace -nxy bands.dat`, `paw_tra.x ROOT.tcntl`, `paw_strc.x -m ROOT`, `paw_resolve -f SETUPS=setups.rslv -f KPOINTS=... -i src/x.strc -o work/x.strc`, `paw_scanlat -l "86 88 ... 102" -e paw_fast.x -p ROOT` + `paw_murnaghan.x -l < E.dat`, `paw_collect`, `doppaw -n 6 ROOT`.

| Family | Chapter | Real decks (read-only) | Computes | CNTL features | STRC features | Setups | Post-processing present | Run time | Outputs |
|---|---|---|---|---|---|---|---|---|---|
| Water, wave-function optimisation | 2.7, 3 | `$COURSE/projects/hoc/h2o/h2o.{cntl,strc,wcntl,dpcntl}`, `.../zip/h2o.dcntl`; reference outputs in the same dir | single point, MOs, DOS/COOP | `START=T NSTEP=200`, `!PSIDYN FRIC=0.01 + !AUTO` | isolated molecule in a box, `LUNIT`, `ID='O_.75_6.0'`/`'H_.75_6.0'` with `M=5./2.` (heavy masses for faster dynamics) | internal `.75_6.0` | `h2o.wcntl` (band 3 MO → cube), `h2o.dcntl` (O s/p, H, O-H COOP), `.dpcntl` | ~1 min (est., EPWPSI=30) | `.prot .rstrt .strc_out _r.tra .pdos .banddata`, `h2o_b3.wv/.cub` |
| Water, relaxation | 2.8 | `projects/hoc/h2o/h2o_after_atomic_opt/` (results), CNTL pattern = `!RDYN` + `!RDYN!AUTO` | geometry optimisation | `START=F`, `!RDYN FRIC=... !AUTO` | as above | | | minutes | forces in ATOMLIST |
| Malonaldehyde (C₃O₂H₄) | 4, 5 | `projects/hoc/c3o2h4/c3o2h4.{cntl,strc,dcntl,dpcntl}`, `hoc/zip/c3o2h4.*`, `c3o2h4_after_wft_opt/`, `c3o2h4_after_atom_opt/` | electron optimisation → relaxation → MD (proton transfer) | `START=F NSTEP=2000`, `!PSIDYN FRIC=0.0 STOP=T`, `!RDYN FRIC=0.0 STOP=T` (`!AUTO_X` disabled → free MD), thermostats (`!THERMOSTAT T[K]= FREQ[THZ]=`) in ch.5 | molecule, `!ISOLATE`, `!CONSTRAINTS` for translations/rotations | internal `.75_6.0`, `M=5.` C/O, `M=2.` H | `.dcntl/.dpcntl`, `paw_tra.x` mode analysis | 10-30 min (est.) | `_r.tra` trajectory, `_e.tra` |
| Silicon | 6 | `projects/hoc/Si/si.{cntl,strc,bcntl,dcntl,dpcntl}` (+ outputs), `src/Docs/Examples/si2.*`, `Si0/` | periodic single point, DOS, band structure | `NSTEP=1000 START=T`, `!AUTO` | fcc 2-atom cell `LUNIT[AA]=5.431`, `!KPOINTS R=30.`, `EMPTY=5` | internal `SI_.75_6.0` | `si.bcntl` (6 k-lines to `Dos/bands.dat`), `si.dcntl` | 12 s (si2, R=10) – few min (R=30) | `.banddata`, `bands.dat` |
| Aluminium (metal) | 6.4 | `projects/hoc/Al/al.{cntl,strc,bcntl,dcntl,dpcntl}` + outputs | metal with variable occupations | `!MERMIN START=T T[K]=0. ADIABATIC=T TETRA+=T RETARD=10.`, `SAFEORTHO=F`, `NSTEP=2000` | fcc `LUNIT[AA]=4.05`, `EMPTY=8`, `R=30.` | `AL_.75_6.0` | bands, DOS | minutes | `OCCUPATIONS AND ENERGY EXPECTATION VALUES` blocks in .prot |
| Iron (ferromagnet) | 7.2 | `projects/hoc/Fe/fe.{cntl,strc,dcntl,dpcntl}` + outputs, `hoc/zip/fe.*` | spin-polarised metal, moment | `!MERMIN ADIABATIC=T RETARD=10. TETRA+=T T[K]=0.`, `SAFEORTHO=F` | bcc `LUNIT[AA]=2.87`, `NSPIN=2 SPIN[HBAR]=2. EMPTY=10`, `R=30.` | `FE_.75_6.0` | spin-resolved DOS | minutes | |
| NiO (antiferromagnet) | 7 / 2nd week | `projects/hoc/NiO/nio.*`, `projects/NiO/{NiO_wfo,NiO_aso,NiO_hybrid_wfo}/nio.cntl`, `nio.wcntl` | AFM oxide, spin density | `NSTEP=2000 START=F`, `!ANALYSE!DENSITY TYPE='TOTAL'|'SPIN'` (disabled `_x` in one deck), hybrid-functional variant (`!DFT!NTBO`) | `LUNIT[AA]=4.17`, `NSPIN=2 SPIN[HBAR]=0.`, `!OCCUPATIONS!STATE` for AFM order, `R=20.` | `NI_.75_6.0`, `O_.75_6.0` | `nio_density.wv/.cub` | 10+ min | |
| Convergence tests | 8 | `projects/hoc/convergence/{al,fe,h2o}` | EPWPSI / CDUAL / k-point / cell-size scans | `paw_scan`-style directory per value | | | | | E vs parameter |
| SN2 reaction (CH₃Cl + I⁻, CH₃Cl + Br⁻, SN1 variants) | 2022 project | `handson2022/sn2/src/*.strc` (23), `sn2/src/{sample.cntl_strt,sample.cntl_rlx,sample.cntl_tsscan,md.cntl,md.tcntl}`, `*.dcntl/*.dpcntl`, `setups.rslv`; also `~/ase-cp-paw/calculations/ch3cli/cppaw0..8` (a finished 9-point scan) | reactant/product relaxation, transition-state scan along a bond-length constraint, MD | staged CNTLs (start → relax → scan), `!RDYN STOP=T FRIC=0.0` | charged molecule `CHARGE[E]=-1.0`, `LUNIT=1.889726124`, `!ISOLATE`, `!CONSTRAINTS!BOND ATOM1='C_1' ATOM2='I_1' MOVE=T SHOW=T VALUE=@VAL@ NSTEP=100` | inline `!AUGMENT` (`MY_NDLSS_*`, `TYPE='NDLSS'`) via `@` placeholders + `paw_resolve` | `.dcntl`, `md.tcntl` (movie.xyz) | 5-15 min per point (est.) | `_constr.report` with `!>` constraint values/forces |
| Graphene | 2nd week | `handson2022/Handson_Projects/Graphene/src/*.strc` (6), `*.dcntl`, `sample.wcntl`, `g3x3wp.wcntl` | supercells with N/B doping, DOS, MO plots | | 2-D periodic slab | resolve | yes | | |
| H in Pd / Jahn-Teller | 2nd week | `Handson_Projects/HinPd/src/pd*.strc`, `hoc2w/Jahn-Teller/src/*` (+ `doc/diffusion.pdf`) | H diffusion in Pd (octahedral vs tetrahedral sites) | | 32-atom Pd supercell | resolve | `.dcntl` | | |
| Ruby (Cr:Al₂O₃) | 2nd week | `Handson_Projects/Ruby/src/*.strc`, `ruby*.dcntl`, `ruby.wcntl`, `hoc2w/Ruby/doc/forstudents.pdf` | d-level splitting, spin states | | corundum cell, `NSPIN=2`, `!OCCUPATIONS!STATE` | resolve | DOS per Cr d-orbital, MO plots | | |
| Schottky barrier, Si surface reconstruction, Si phase diagram | 2nd week | `Handson_Projects/{Schottkybarrier,Surfacereconstruction,Phasediagram}/src/` (`cell.cntl`, `scan1.cntl`, `start.cntl`, `doall.sh`) | slabs, interfaces, E(V) of Si phases with `paw_scanlat` + `paw_murnaghan.x`, `!CONTROL!CELL` dynamics | `!CELL MOVE= FRIC= STOP=`, `!ANALYSE!1DPOT` | | resolve | `doall.sh` shows the full pipeline incl. `paw_get -w efermi`, `paw_resolve -f KPOINTS=` | | |
| Misc. | — | `$COURSE/examples/{c9m0ar,surface,t-hooo,pcmo_ce}.*`, `testset/` (G2, W4-11 benchmark sets), `projects/{cyclo18carbon,haems,munchnone,PrCeO2,qcorral,Thien_Surface}` | | | | | | | |

Setup-resolution mechanism used by the 2022 decks: STRC templates contain `@SETUPS@` (or `@SPECIES_X@`, `@KPOINTS@`, `@VAL@` for scan values); `paw_resolve -f SETUPS=$SRC/setups.rslv -r VAL=2.3 -i template.strc -o work/case.strc` replaces the line with the file contents / the value. `setups.rslv` is a plain list of `!SPECIES ... !AUGMENT ... !END !END` blocks (CL, H_, C_, BR, I_, ...) with `TYPE='NDLSS'` augmentation and `!NTBO` parameters. The older hoc decks (2019) use the internal `<EL>_.75_6.0` IDs and need nothing external. No deck uses `!FILES!FILE ID='AUGPARMS'`.

Deck oddities observed: `AUTOCONF` (typo), `SAVEORTHO` (typo), `!RDYN_x`/`!AUTO_X`/`!ANALYSE_x` (disabled blocks left in place), `!ISOLATE` misplaced inside sub-blocks (ase-cp-paw h2o), `RAD/COV` (typo of `RAD/RCOV`), missing `!END` producing nested `!SPECIES!SPECIES` — all accepted silently by CP-PAW.

Run times above marked "est." are extrapolated from the smoke tests (si2: 0.07 s/step at EPWPSI=30, 8 k-points; h2o: 1.0 s/step at EPWPSI=50, spin-polarised, 20 bands) on this workstation; the tutorial itself gives no timings beyond "a few minutes" for the water example.

## 7. Smoke tests (executed 2026-09-04 under `.scratch/cppaw/`)

### 7.1 First attempt: the installed binary does not start on this machine

Command (as the manual prescribes, section "Execute the simulation code", manual.tex ~l.606):

```bash
cd .scratch/cppaw/si2
$PAWDIR/bin/fast/paw_fast.x si2.cntl 1>si2.err 2>&1     # exit code 2 after 0.15 s
```

`si2.err`:

```
At line 162 of file paw_trace.f90 (unit = 6, file = 'stdout')
Fortran runtime error: Missing comma between descriptors
("TRACE-MEM(",I3,"): MAXMEM[MBYTE]=",F10.5" TIME",A8," ",A10)
                                                            ^
Error termination. Backtrace: ...
TRACE-PUSH(  1): LEVEL=    1 INTO MAIN
```

Root cause: `src/paw_trace.f90` builds the run-time format string
`FMT_MEM='("TRACE-MEM(",I3,"): MAXMEM[MBYTE]=",F10.5' // '," TIME",A8," ",A10)'`
(lines 146-147 and 200-201) — there is no comma between `F10.5` and `" TIME"`.
The binary (built 2025-05-07 with the gfortran of that time) tolerated this; the system
`libgfortran5` has since been upgraded to the GCC 16 runtime
(`libgfortran5 16-20260322-1ubuntu1`, `/usr/lib/x86_64-linux-gnu/libgfortran.so.5.0.0`,
installed 2026-03-22) which rejects the format at run time. Every real run is affected because `TRACE$PUSH('MAIN')` is called before
reading any input; `--version`/`--help`/`--parmfile` exit earlier and still work, so they
cannot be used as a health check (the `out` file of the May-2025 h2o run shows the same
TRACE-MEM lines printing fine back then).

Work-around used for all runs below (no files outside the scratch dir touched):
an older `libgfortran.so.5` (GCC 13.2) that happens to be present in a conda
package cache:

```bash
export LD_LIBRARY_PATH=~/miniconda3/pkgs/libgfortran5-13.2.0-ha4646dd_0/lib
```

Permanent fixes (what would be needed): (1) add the missing comma in
`paw_trace.f90` (both occurrences) and rebuild with
`cd $PAWDIR && src/Buildtools/paw_build.sh -j10 -c fast -z` (all build
prerequisites are present: gfortran 15.2, libfftw3-dev, libopenblas-dev,
libxc-dev 5.2.3 with `xc_f03_lib_m.mod`, gmake, latexmk) — a patched copy of the
source tree is prepared in `.scratch/cppaw/build/cp-paw/` but the build was not
run because the sandbox refused to execute the build script; or (2) ship the
older runtime with Atomscope's launcher (as done here). Atomscope should
detect this failure signature ("Fortran runtime error: Missing comma between
descriptors" in the captured stdout/stderr within the first second) and show
the explanation.

### 7.2 si2 example (`src/Docs/Examples/si2.{cntl,strc}`, unmodified)

```bash
cd .scratch/cppaw/si2
LD_LIBRARY_PATH=~/miniconda3/pkgs/libgfortran5-13.2.0-ha4646dd_0/lib \
  timeout 600 $PAWDIR/bin/fast/paw_fast.x si2.cntl 1>si2.err 2>&1
```

* Setup resolution: `!SPECIES ID='SI_.75_6.0'` — the suffix after the first
  underscore (`.75_6.0`) is one of the five internal setup families
  (`paw_setups.f90:1390-1436`: `NDLSS_V0`, `NDLSS_SC_V0`, `HBS`, `HBS_SC`,
  `.75_6.0`), so no setup file and no environment variable is needed. No `.stp`
  file, no `$PAWDIR/parameters/stp.cntl` exists on this machine; `PAWDIR` is not
  needed by the binary.
* Result: exit code 0, **12.2 s wall**, 26 MB RSS, 144 iterations, stopped by the
  autopilot ("STOP SIGNAL FROM AUTOPILOT" at NFI 142, "STOP SIGNAL RECEIVED").
* Final energy: `TOTAL ENERGY : -7.9050265 H` (stderr/stdout tail:
  `CONSTANT ENERGY -7.9050264159688171  5.5243563867934337E-008`, then
  `NORMAL STOP: CALLING MPE__STOPALL TO CLOSE DOWN`).
* Files produced: `si2.prot si2.strc_out si2.rstrt si2_r.tra si2.pdos
  si2.banddata si2_constr.report si2_stpforz14.myxml` (+ `si2.err` = redirected
  stdout).
* Band structure summary in .prot: `BAND INDEX OF HOMO 4`, `SMALLEST DIRECT GAP
  2.4686 EV AT IK=1`, `ABSOLUTE GAP 0.6530 EV`.

First 40 lines of `si2.prot`:

```
(blank)
********************************************************************************
**************                CP-PAW                     ***********************
**************     FIRST PRINCIPLES MOLECULAR DYNAMICS      ********************
**************   WITH THE PROJECTOR AUGMENTED WAVE METHOD   ********************
********************************************************************************
         P.E. BLOECHL, (C) CLAUSTHAL UNIVERSITY OF TECHNOLOGY (CUT)
         DISTRIBUTED UNDER THE GNU PUBLIC LICENSE V3
************************  CPPAW VERSION INFO  ************************************
this is a development version
compiled by  root  ON Mi 7. Mai 20:03:11 CEST 2025
hash=        aa467ef8739758bfe067e80a2ab61f5697ede009
branch=      main
remote=      https://github.com/cp-paw/cp-paw.git
committed on=Wed Dec 18 16:40:29 2024 +0100
committed by=lksrmp <64144957+lksrmp@users.noreply.github.com>
no changes since last commit
**********************************************************************************
PROGRAM STARTED on FRI 04 SEP 2026 22:56 (27.557S)

UNUSED ELEMENTS FROM INPUT FILE
================================
NAME OF CURRENT LIST: CONTROL
UNUSED ELEMENTS COULD INDICATE MISSPELLED OR INCORRECTLY PLACED DATA OR LISTS
---------START LIST OF UNUSED ELEMENTS------------------------------------------
---------END LIST OF UNUSED ELEMENTS--------------------------------------------

INFORMATION FROM CONTROL INPUT FILE
===================================
START WITH RANDOM WAVE FUNCTIONS
NUMBER OF ITERATIONS...................................:        200
TIME STEP..............................................:    5.00000 A.U.
DETAILED INFORMATION AFTER EACH........................:        100 TIME STEPS

UNUSED ELEMENTS FROM INPUT FILE
================================
NAME OF CURRENT LIST: STRUCTURE
UNUSED ELEMENTS COULD INDICATE MISSPELLED OR INCORRECTLY PLACED DATA OR LISTS
---------START LIST OF UNUSED ELEMENTS------------------------------------------
---------END LIST OF UNUSED ELEMENTS--------------------------------------------
```

Per-iteration lines and the final report (excerpt):

```
    NFI  T[PSEC] T[K]   EKIN(PSI)        E(RHO)         ECONS   ANNEE   ANNER
!>   142   0.01717     0   0.000001     -7.905026     -7.905026  1.0000  0.0000
 STOP SIGNAL FROM AUTOPILOT
!>   143   0.01730     0   0.000000     -7.905026     -7.905026  0.0100  0.0000
 STOP SIGNAL RECEIVED
!>   144   0.01742     0   0.000000     -7.905026     -7.905026  0.0100  0.0000
ENERGY REPORT
=============
TOTAL ENERGY                            :     -7.9050265 H
...
ATOMLIST REPORT
===============
T1[ANGSTROM]=  0.000000  2.714679  2.714679
...
NAME          POSITION[ANGSTROM]            M[U]    MPSI_EFF[U] Q[E]           FORCE[MH/ABOHR]
SI1      (  0.00000,  0.00000,  0.00000)   28.0855    0.5365  -0.00000
SI2      (  1.35734,  1.35734,  1.35734)   28.0855    0.5365  -0.00000
```

Note: the header announces a `FORCE[MH/ABOHR]` column but **no force vector is
printed** because atoms were not propagated (`ATOMS ARE NOT PROPAGATED`).

### 7.3 h2o example (`~/ase-cp-paw/calculations/h2o/case.{cntl,strc}`)

Modifications: `START=F` -> `START=T` (no restart file in a fresh directory),
`NSTEP=1` -> `NSTEP=300`, removed the `!FILE ID='RESTART_OUT' NAME='/dev/null'`
line so a restart file is produced. The STRC file (inline `!AUGMENT` setups for
O and H, isolated-molecule cell, `NSPIN=2`, `EMPTY=15`) is unmodified.

* Result: exit code 0, **147 s wall**, 86 MB RSS, 149 iterations
  (autopilot stop), `TOTAL ENERGY : -17.3290129 H`, `ABSOLUTE GAP 5.7002 EV`,
  `HOMO-ENERGY -6.89616 EV`, `LUMO-ENERGY -1.19596 EV`.
* Files produced: `case.prot case.strc_out case.rstrt (9.8 MB) case_r.tra
  case.pdos case.banddata (2.5 MB) case_constr.report case_total_density.wv
  (1.2 MB, from !ANALYSE!DENSITY) case_stpforz1.myxml case_stpforz8.myxml
  psphi.dat`.
* The `.prot` "UNUSED ELEMENTS" list flags the mistyped block of the original
  deck — proof that CP-PAW *does* report unrecognised input (the manual l.427
  says it does not):

```
---------START LIST OF UNUSED ELEMENTS------------------------------------------
~!CONTROL!RDYN_X!STOP
~!CONTROL!RDYN_X!FRIC
~!CONTROL!RDYN_X!AUTO!FRIC(-)
...
```

* Post-processing verified: `paw_wave.x case_total_density.wcntl` (the
  `.wcntl` from the reference directory, 2.2 s) produced
  `case_total_density.cub` (6.7 MB, Gaussian cube, header `CP-PAW CUBE FILE`,
  80x80x80 grid, 27 atoms = 3x3x3 periodic images inside the view box),
  `.dx` (23 MB), `.wrl`, `.wprot`.

### 7.4 Restart, forces, exit file, NEWSTRC, error exit (all verified)

| Probe | Dir | Setup | Observation |
|---|---|---|---|
| Restart | `h2o_restart/` | copy `case.rstrt`, `START=F NSTEP=5` | 7 s; `.prot`: `START WITH WAVE FUNCTIONS FROM FILE: RESTART_IN`, `INITIAL POSITIONS TAKEN FROM RESTART FILE`, `INITIAL UNIT CELL FROM RESTART FILE`; iteration counter **continues** (NFI 149..153). |
| Atomic dynamics / forces | `si2_rdyn/` | si2 `START=F` from `si2.rstrt`, `!RDYN FRIC=0.1 STOP=F !END`, `NSTEP=30 NWRITE=10` | `.prot`: `ATOMS ARE PROPAGATED`; ATOMLIST now carries the force vector: `SI1 ( 0.00000, 0.00000, 0.00000) 28.0855 0.5365 -0.00000 ( 0.01, 0.01, 0.01)` (mH/Bohr, 2 decimals). Run stopped after 23 of 30 steps by the **PSIDYN autopilot** (energy constant) even though atoms were moving. |
| Geometry from STRC on restart | `si2_newstrc/` | as above + `NEWSTRC=T`, Si2 moved to (0.27,0.25,0.25) | Without NEWSTRC the edited STRC geometry was **silently ignored** (`INITIAL POSITIONS TAKEN FROM RESTART FILE`); with `NEWSTRC=T`: `INITIAL POSITIONS TAKEN FROM STRUCTURE FILE`, Si2 at (1.46593, 1.35734, 1.35734) Å. |
| Exit file | `si2_exit/` | `NSTEP=5000`, `!AUTO_OFF`; `touch si2.exit` after 4 s | ` STOP SIGNAL RECEIVED` at NFI 29, normal `PROGRAM FINISHED`, exit code 0, `si2.rstrt` written, `si2.exit` left in place (it is deleted only at the *start* of the next run, `paw_driver.f90:707`). |
| Force trajectory | `si2_ftra/` (single point + `!ANALYSE !TRA FORCE=T E=T !END !END`, 60 steps) and `si2_force/` (`!RDYN FRIC=1.0 STOP=T`, `NEWSTRC=T`, `NWRITE=1`, 5 steps) | | `si2_f.tra`/`si2_e.tra` are written (59 records, NSIZE 8); `_e.tra` holds `[T, EKINC, EKINP, ETOT, ECONS, ...]` = `[0, 0.0716, 0, -7.8689, -7.7973, ...]`; **`_f.tra` is all zeros in both runs** although the ATOMLIST of `si2_force` shows `(-189.17, -0.02, -0.03)` mH/a₀. With `FRIC=1.0` the displaced Si atom moved 1.46593 → 1.46584 Å in 5 steps. |
| Input error | `si2_broken/` | STRC without `!SPECIES` | exit code **1**; stdout: `ERROR STOP ERROR STOP IN MPE__STOPALL` + gfortran backtrace, then the message; `.prot` ends with `NO ATOM TYPES !STRUCTURE!SPECIES SPECIFIED. ... STOP IN STRCIN_SPECIES` and has no `PROGRAM FINISHED` line. |

### 7.6 The container image, measured against the host installation (2026-09-09)

The project ships a dockerised CP-PAW (`cp-paw/docker-compose.yml`, images `cp-paw-backend`,
`cp-paw-worker`, `cp-paw-frontend`). The compose stack was **not** started: it publishes ports
8000 and 8080, i.e. binds `0.0.0.0`, and an externally reachable service needs explicit
permission. The existing `cp-paw-backend:latest` image was run directly instead, with only a bind
mount of a scratch directory, `--network none`, and `--user $(id -u):$(id -g)` so the files it
writes belong to the user rather than to root.

The tools live at `/app/bin/fast/`, the full set, linked against the image's own
`libgfortran.so.5`. Three measurements, each against the same input as the host run:

| Tool | Host | Container | Verdict |
| --- | --- | --- | --- |
| `paw_fast.x` (water, `START=T`) | `TOTAL ENERGY: -17.2996974 H` | `-17.2996974 H` | identical |
| `paw_dos.x` (water-orbitals `case.pdos`) | `FERMI LEVEL: -7.14823 EV` | `-7.14823 EV` | identical |
| `paw_wave.x` (`case_density.wv` → cube) | `case_density.cub` | byte-identical | identical |

An earlier comparison appeared to show a 52 meV Fermi-level difference. It did not: the two runs
had different inputs (`START=F` plus a `!DENSITY` request against `START=T` from scratch). Feeding
*the same* `.pdos` to both gives the same number to the last digit.

The container is in one respect **better** than the host installation: §7.1's start-up abort
cannot happen there. `paw_dos.x` runs cleanly in the container while the same tool on this
workstation dies with `Missing comma between descriptors` unless `health_check` has already found
an older runtime. The image ships a matching libgfortran, so there is nothing to hunt for.

The whole `-m cppaw` suite passes through the container: 6 passed, 1 skipped, the skip being the
parallel test guarding on `ppaw_fast.x`/mpirun. Container mode is deliberately serial — the
parallel binary would need mpirun *inside* the image, which is a different problem.

Atomscope uses it by setting `ATOMSCOPE_CPPAW_IMAGE=cp-paw-backend:latest`. Rather than teach
every call site about containers, `CppawSettings.find` hands out one generated `sh` wrapper per
tool (see `backends/cppaw/settings.py`, `ContainerRuntime`); each `exec`s `docker run` with the
caller's working directory as the only visible path and passes arguments through `"$@"`, so no
argument is re-parsed by a shell and `shell=False` still holds everywhere. A configured container
is never silently replaced by the host installation: that would run a different CP-PAW than was
asked for, and the difference would surface as an unexplained energy.

### 7.7 `!WCNTL !PLANE`: `C=` is broken upstream, use `O=`

`paw_wave.x` writes `_c.gnu` (contour) and `_r.gnu` (rubbersheet) whenever its `.wcntl` carries a
`!PLANE` block — both at once, from `MAKEGNU` (`src/Tools/Wave/paw_wave.f90:1493`). The plane
takes `T=` (two spanning 3-vectors, the second automatically orthogonalised against the first)
and either `O=` (corner) or `C=` (nominally centre).

**`C=` does not centre the plane.** At `paw_wave.f90:353` the value is read into `PLANER0` and the
centring correction is then applied to `BOXR0` — the *viewbox* origin — instead of to `PLANER0`.
So `C` behaves as a corner, and it perturbs the cube's box as a side effect. Measured on the
water density: with `!PLANE C=0 0 0` the oxygen core (the field maximum) lands at the plane's
corner, at label `(-3.00, -3.00) Å`, and the plane through the molecule reads as near-vacuum.

With `!PLANE O=` set to `-(v1+v2)/2` — computed by the caller — the same cut is correct: oxygen
5.378 e/Bohr³ at the plane centre, both hydrogens 0.2453 e/Bohr³ (equal, as the symmetry of the
relaxed molecule requires), vacuum 4.3e-6. Atomscope therefore always writes `O=` and never `C=`.

The file format, read off the writer rather than inferred: a header of lowercase `key= value`
assignments (`xmin`…`zmax`, plus the suggested view `rot_x`, `rot_z`, `scale`, `scale_z` — the
contour gets `0,0` and the rubbersheet `30,20`), then `# DATA SECTION` and `N1*N2` rows of
`x y z` with x in the outer loop. The grid is fixed at 60×60 (`N1`/`N2` parameters). Lengths are
Bohr. An earlier header line reads `DATA SECTION TO BE CHANGED BY THE USER` and is *not* the
data — the marker must exclude it. The two files' numbers are byte-identical, so reading one of
each pair suffices.

## 8. Known traps

Sources: the third-party audit of the earlier web workbench (`~/cp-paw/docs/third_party_audit_report.md`), the workbench code (`~/cp-paw/backend/app/protocol.py`, `restarts.py`, ...), the manual, the Fortran sources and the probes of section 7. Status: **VERIFIED** = reproduced here or read in the source at the cited line; **MANUAL** = stated by the manual; **AUDIT** = reported by the audit, consistent with the source.

1. **Forces appear in the protocol only when `!CONTROL!RDYN` exists** (`paw_atoms.f90:257`, `TDYN`), and with `STOP=T` not in the first ATOMLIST. A single-point deck therefore yields no forces; the workbench's ASE calculator read `[0,0,0]` and BFGS "converged" at step 0 (audit PARSE-1). VERIFIED (§7.2 vs §7.4). Remedy: force evaluation = `!RDYN FRIC=1.0 STOP=T !END` (friction 1 = steepest descent) with a small `NSTEP` and `NWRITE=1`, then read the ATOMLIST of the last step. Verified (`si2_force/`, Si2 displaced by 0.02 lattice units, `NEWSTRC=T`, 5 steps): forces appear from the first propagated step on (`(-189.17, -0.02, -0.03)` → `(-141.40, 0.13, -0.41)` mH/a₀ as the wave functions re-converge for the new geometry), the atom moved only 1.46593 → 1.46584 Å. Forces are only meaningful once the electrons are converged for the *current* geometry, so run enough steps for `EKIN(PSI)` to drop. **Do not use `_f.tra` as the force source: in this build it contains only zeros**, both without `!RDYN` (`si2_ftra/`: 59 records, all 0.0) and with `!RDYN` (`si2_force/`: records 144-147 all 0.0 while the ATOMLIST shows −189 mH/a₀).
2. **Protocol forces have 2 decimals in mH/a₀** (`F7.2`); resolution 5·10⁻⁴ eV/Å — too coarse for tight relaxations; `Q[E]` overflows to `********` for |Q|≥100 in early unconverged steps (seen in ch3cli). VERIFIED.
3. **`.prot`, `_r.tra`, `_constr.report` are opened in APPEND mode** — re-running in the same directory concatenates runs; `NFI` is not unique across runs (and does not advance at all if `RESTART_OUT=/dev/null`). Always split on `PROGRAM STARTED` and use the last run, or run each job in a fresh directory. VERIFIED (h2o reference: 9 runs in one file).
4. **`START=F` is the default** and silently ignores the geometry and cell in `.strc` (positions, cell, occupations come from `.rstrt`) unless `NEWSTRC=T`. A "changed geometry, re-run" workflow that forgets `NEWSTRC=T` or `START=T` computes the old structure. VERIFIED (§7.4). Conversely `START=T` discards converged wave functions.
5. **`STOP=T` means "zero initial velocity", not "stop at convergence"** (manual l.1242, l.1541). Convergence stopping is the autopilot (`!AUTO` sub-blocks + `!GENERIC ETOL/AUTOCONV`). MANUAL, VERIFIED.
6. **The autopilot stops MD/relaxation runs early**: the energy-window criterion fires whenever the total energy is flat for AUTOCONV steps, also while atoms are still moving slowly (si2_rdyn: 23 of 30 steps). For MD, omit `!PSIDYN!AUTO`/`!RDYN!AUTO` or use a fixed friction; for relaxations, check `STOP SIGNAL FROM AUTOPILOT` and the last forces. VERIFIED.
7. **Misspelled/misplaced blocks are silently ignored** (manual l.427), but the protocol *does* list them under `UNUSED ELEMENTS FROM INPUT FILE` — parse that list and surface it. The h2o reference deck has `!RDYN_x` (disabled by suffix) and `!ISOLATE` nested inside `!GENERIC`/`!LATTICE`/`!OCCUPATIONS` instead of directly under `!STRUCTURE`; the latter are *not* reported (empty blocks have no data to report) and the electrostatic decoupling was never active. VERIFIED (no `ISOLATE ENERGY` line in any h2o protocol).
8. **Duplicate keys: first wins, no warning** (manual l.429). MANUAL.
9. **Installed binaries crash on the current libgfortran** (`paw_trace.f90:146/200` malformed FORMAT): every real run of `paw_fast.x` and every tool run (`paw_wave.x`, `paw_dos.x`, `paw_bands.x`, `paw_tra.x`, `paw_grab.x`, ...) dies at the first `TRACE$PUSH`, while `--version`/`--help`/`--parmfile` still succeed — so a version probe is **not** a health check. Failure signature: exit code 2 and `Fortran runtime error: Missing comma between descriptors` within the first second. VERIFIED (§7.1). The workbench's Docker image (Ubuntu with an older runtime) masked this.
10. **The reference energy of `tests/fulltests/si2/analyse.sh` is stale** relative to the corrected-PBE binary (audit SCOPE-3: −7.4076060 vs main's −7.3657485); our si2 run gives −7.9050265 H with `EPWPSI=30`, `R=10` k-mesh — different deck, do not compare. AUDIT.
11. **Charge and spin are easy to drop when regenerating STRC from an ASE `Atoms`** (`CHARGE[E]`, `SPIN[HBAR]`, `NSPIN`, `!OCCUPATIONS!STATE`) — audit ARCH-1. Keep them as first-class fields of the Atomscope model, not derived from ASE. AUDIT.
12. **Editing generated decks vs. raw decks**: the workbench let a raw deck override GUI edits silently (audit FE-1). Atomscope must have one source of truth (either structured model → generated deck, or raw text) and show a diff. AUDIT.
13. **`paw_toxyz.x` writes Bohr**, not Å (`paw_toxyz.f90:264-280`); `paw_tra.x` reads `.strc_out`, not `.strc`; `paw_converttra.x`/`paw_cleantra.x` assume an obsolete `_r.tra` layout. VERIFIED in source.
14. **`_r.tra` trailing block is interleaved `(q,mx,my,mz)` per atom** in the writer but read as `Q(NAT)` then `SPIN(3,NAT)` by `paw_tra.x` — positions/cell/point charges are safe, magnetic moments from `paw_tra.x` are scrambled. VERIFIED in source.
15. **`EPWPSI`/`EPWRHO` are in Rydberg**, `DT` in a.u. of time (5 a.u. = 0.12 fs), `T[PSEC]` in ps, `IONIC TEMPERATURE` in the ENERGY REPORT is in Hartree while `T[K]` in the `!>` line is Kelvin. MANUAL/VERIFIED.
16. **`LUNIT` scales every length in the STRC**; the si2 deck uses `LUNIT=10.26` (Bohr lattice constant) with "fractional-looking" coordinates that are actually Cartesian in units of the lattice constant, the hoc Si deck uses `LUNIT[AA]=5.431`. A generic importer must multiply by LUNIT (and by 1.8897261 for `LUNIT[AA]`). VERIFIED.
17. **Atom names must be unique and should start with the element symbol** (`O_1`, `H_2`, `SI1`, `CL1`); a second character `_` pads one-letter symbols. Species `NAME` likewise (`O_`, `H_`, `SI`); `!ATOM` refers to species by the first two characters of its NAME (`SP=` is added in `.strc_out`). MANUAL l.464-504 (+ `paw_strc.x` "requires atomnames to start with the element symbol").
18. **Even a structure with no atoms needs one `!SPECIES`** (error `NO ATOM TYPES !STRUCTURE!SPECIES SPECIFIED`, exit 1). VERIFIED (§7.4).
19. **Exit-file semantics**: `ROOT.exit` is deleted at the start of a run, then polled every step; leaving it behind is harmless for the next run but a launcher that pre-creates it to "abort immediately" will find it deleted and the run continuing — create it *after* the run has started. VERIFIED.
20. **`!ANALYSE!DENSITY/!WAVE` files are written only at the last step**, so a run killed by `timeout`/SIGKILL yields no `.wv`; a soft stop (exit file) does. VERIFIED in source (`paw_driver.f90:114`).
21. **`.rstrt` is refreshed only every `NWRITE` steps** (default 100); a hard kill loses up to NWRITE steps. For long MD runs Atomscope should set `NWRITE` explicitly. MANUAL l.912-916.
22. **Setup IDs**: `ID='EL_TYPE'` splits at the *first* underscore (`paw_setups.f90:1400-1402`), so element symbols with `_` padding work (`O_.75_6.0` → EL=`O_`, type `.75_6.0`). Unknown type → `SETUP TYPE NOT RECOGNIZED ... NO SETUP FILE HAS BEEN READ`, exit 1. The hands-on decks avoid IDs and inline `!AUGMENT` blocks via `paw_resolve -f SETUPS=setups.rslv`. VERIFIED.
23. **`paw_wave.x` output names derive from the `.wcntl` root**, not from the `.wv` name, and by default it writes the large `.dx` (23 MB for 80³) and `.wrl` alongside the `.cub`; suppress them with `!FILE ID='WAVEDX' EXT=F NAME='/dev/null' !END` (verified) — the same `/dev/null` trick works for `RESTART_OUT` in the CNTL (used by the ase-cp-paw deck). VERIFIED (§7.3).
24. **Eigenvalues/gaps in `.prot` use the fixed-occupation path**; with `!MERMIN` the printed numbers are diagonal Hamiltonian elements (manual l.9293-9304) and the band gap lines change. MANUAL.
25. The old workbench regexes worth keeping: timestamp `:\s*([A-Z]{3})\s+(\d{2})\s+([A-Z]{3})\s+(\d{4})\s+(\d{2}):(\d{2})\s+\(([-+0-9.]+)S\)` (matches `PROGRAM STARTED on FRI 04 SEP 2026 22:56 (27.557S)`), ATOMLIST row `^\s*(\S+)\s+\(\s*([-+0-9.Ee]+),\s*([-+0-9.Ee]+),\s*([-+0-9.Ee]+)\)`; the one to fix: forces must be taken from the optional 4th parenthesised triple **and** their absence must be reported as "no forces", never as zeros.

## 9. Recommendations for the Atomscope CP-PAW adapter

**Runtime**

* Locate binaries via `PAWDIR` (`$PAWDIR/bin/fast`, `$PAWDIR/bin/fast_parallel`) or an explicit setting; verify with `paw_fast.x --version` (exit 0, parse `hash=`) **and** a 12-second si2 run at configuration time — `--version` succeeds even when real runs crash. Detect the libgfortran incompatibility from the `Fortran runtime error: Missing comma between descriptors` signature of that test run and offer the `LD_LIBRARY_PATH` remedy / rebuild instructions (§7.1). Do not depend on `PAWDIR` inside CP-PAW itself — it does not read it.
* Run each calculation in its **own directory** with a fixed root (`case`), `cwd` = that directory, command `paw_fast.x case.cntl`, stdout+stderr captured to `case.out`. Parallel: `mpirun -np N --oversubscribe ppaw_fast.x case.cntl` with `OMP_NUM_THREADS=1` (as `doppaw.sh` does).
* Never reuse a directory for a second run without either (a) deleting `case.prot`, `case_r.tra`, `case_constr.report` (append mode) or (b) parsing "last run only". Prefer (a) plus copying `.rstrt` in for restarts.

**Files to generate**

* `case.strc` from the Atomscope structure model: `!GENERIC LUNIT[AA]=1.0` (write Å directly), `!LATTICE T=`, `!SPECIES` per element (name = symbol padded with `_`, `NPRO`/`LRHOX` from a per-element table; setups either as internal `ID='<EL>_NDLSS_V0'`/`'.75_6.0'` or inline `!AUGMENT` copied from `setups.rslv`), `!ATOM NAME='<sym><n>' R=`, `!OCCUPATIONS NSPIN= CHARGE[E]= SPIN[HBAR]= EMPTY=`, optional `!KPOINTS DIV=|R=`, `!ISOLATE` directly under `!STRUCTURE` for molecules, `!CONSTRAINTS` (`!FREEZE`, `!BOND` for scans).
* `case.cntl` from a small task model: single point (`START=T`, `!PSIDYN!AUTO`, no `!RDYN`), forces (`+ !RDYN FRIC=1.0 STOP=T NWRITE=1`, a few steps, `NEWSTRC=T` when continuing from a restart file; read the last ATOMLIST), relaxation (`!RDYN` + `!RDYN!AUTO`), MD (`!RDYN FRIC=0` + `!THERMOSTAT`, no `!AUTO`, explicit `NWRITE`), continuation (`START=F`, optional `NEWSTRC=T`), analysis (`!ANALYSE!DENSITY/!WAVE`, `!ANALYSE!TRA E=T` for the energy trajectory; `FORCE=T` yields zeros in this build). Always write `!FILES !FILE ID='EXIT' ...` only if a non-default name is needed; keep `!DFT TYPE=10`, `!FOURIER EPWPSI CDUAL` explicit.
* Tool control files on demand: `.wcntl` (cube export), `.dcntl` (DOS), `.bcntl` (bands), `.tcntl` (movie/xyz). Use `.strc_out` as their structure input.
* Validate generated and imported decks against the schema JSON (unknown keys → warning; mandatory keys `!SPECIES NPRO`, `!LATTICE T`, `!ATOM NAME/R`), and after a run compare with the protocol's `UNUSED ELEMENTS` list.

**Monitoring (stream `case.prot`)**

* Tail the protocol; state machine: `PROGRAM STARTED` → header parsed (`NUMBER OF ITERATIONS`, `TIME STEP`, unused-elements list, `ATOMS ARE (NOT) PROPAGATED`, `NUMBER OF BANDS/K-POINTS/SPINS`) → per `!>` line emit (NFI, t_ps, T_K, E_H, Econs_H, frictions) → on each detailed block emit energy decomposition, ATOMLIST (positions Å, forces mH/a₀ if present), eigenvalues/gap → `STOP SIGNAL ...` → `PROGRAM FINISHED`.
* Completion = process exit 0 **and** `PROGRAM FINISHED` present. Failure = `STOP IN <ROUTINE>` in `.prot` (message lines above it), or exit code ≠0, or `Fortran runtime error` in `case.out`. Timeout = no new `!>` line for N × expected step time (si2: 0.07 s/step; h2o at EPWPSI=50: 1 s/step).
* Progress = last NFI − first NFI of this run over `NSTEP`; the autopilot may end earlier (`STOP SIGNAL FROM AUTOPILOT`).

**Stopping / restarting**

* Soft stop: `touch case.exit` (after the run has started); wait for `PROGRAM FINISHED`; the `.rstrt` is then current. Hard stop: SIGTERM after a grace period; then `.rstrt` is only as recent as the last `NWRITE` block.
* Restart/continue: same directory, new `case.cntl` with `START=F` (+ `NEWSTRC=T` when the user edited the structure), move the previous `.prot` aside (or rename it `case.prot.<n>`), run again. For "rerun from scratch": `START=T` and delete `.rstrt`.
* Multi-stage workflows (tutorial pattern): wf-optimisation → relaxation → MD, each a separate CNTL in the same directory with `START=F`; scans via one directory per value (like `paw_scan`/`paw_scanlat` and the ch3cli/cppaw0..8 layout).

**Parsing / post-processing**

* Final energy: last `TOTAL ENERGY` of the last run (H → eV ×27.211396). Forces: last ATOMLIST with a force triple (mH/a₀ → eV/Å ×0.0514220675); `_f.tra` is unusable (zeros). Geometry: `.strc_out` (× LUNIT → Bohr → Å) or ATOMLIST (Å). Gap/HOMO/LUMO: `ABSOLUTE GAP`, `HOMO-ENERGY`, `LUMO-ENERGY` (eV). Trajectory: `_r.tra` reader above (positions in Bohr, time in a.u.). Temperature/energies vs time: `!>` columns or `_e.tra`.
* Volumetric data: run `paw_wave.x` on the `.wv` with a generated `.wcntl` (view box = cell for periodic systems, molecule bounding box + margin for isolated ones) and load the `.cub` (Bohr; atom list may include periodic images — use the structure model for atoms, the cube only for the grid).
* DOS/bands: `paw_dos.x` (`.dos` = E[eV], DOS, DOS·occ; spin-down negative), `paw_bands.x` (`x, E1..ENB` eV; k-path from `!LINE KVEC1/KVEC2/KVECSCALE`). Fermi level from the `.dprot` (`FERMI LEVEL`) or HOMO from `.prot`.
* Keep the tool protocols (`.wprot`, `.dprot`, `.bprot`) and check their `UNUSED ELEMENTS` too.

**Fixtures for integration tests**: `si2` (12 s, internal setup, periodic, 8 k-points), `h2o` (2.5 min, inline setups, spin-polarised molecule, `.wv` density), `si2 + !RDYN` (forces), `h2o START=F` (restart), `si2.exit` probe, `si2_broken` (error path); all under `.scratch/cppaw/` with their inputs and outputs. Larger candidates: hoc `Si`, `h2o`, `c3o2h4`, `Fe`, `NiO`, `Al` and the SN2 decks (§6).
