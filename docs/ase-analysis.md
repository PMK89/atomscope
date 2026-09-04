# ASE integration analysis for Atomscope

Scope: (a) the installed ASE 3.25.0 API surface Atomscope should build on, (b) the historical
`asecppaw` package (`/home/pmk/ase-cp-paw`, author Patrick M. Kaiser, 2020-2025), and (c) the prior
web-workbench ASE code (`/home/pmk/cp-paw/backend/app/`). Everything below was verified against the
files on disk and by running read-only introspection with `/home/pmk/miniconda3/envs/asecppaw/bin/python`
(ASE 3.25.0). Scratch outputs live in `/home/pmk/Projects/atomscope/.scratch/ase/`.

Licensing note: `/home/pmk/ase-cp-paw/setup.cfg:9` says `license = MIT` and `pyproject.toml:12` says
`license = { file = "LICENSE" }`, but **no LICENSE file exists in the repository** (`ls LICENSE*` is empty;
the README links to a non-existent `LICENSE`). Since the author is the project owner, this is fixable by
adding the file; until then the package has no effective license grant and nothing should be vendored
from it into a distributed product without the owner adding one.

---

## 1. `asecppaw` architecture

### 1.1 Module map (`/home/pmk/ase-cp-paw/src/asecppaw/`, 14 986 lines total)

| Module | Lines | Responsibility | Third-party deps |
|---|---|---|---|
| `calculator.py` | 1959 | `cppaw(FileIOCalculator)`: instruction list runner, job submission (`paw_fast.x`/`ppaw_fast.x`/`sbatch`), protocol tailing, restart/backup, result reading. Also `dir2Dict()` directory scanner. | ase, numpy |
| `input_files.py` | 2123 | Schema-driven object model of CP-PAW input files (`!CONTROL`, `!STRUCTURE`, `!DCNTL`, `!WCNTL`, ...): parse -> tree -> serialise; `strcInputFile(Atoms)`; helper generators for dcntl/wcntl; `readDir`, `readCube`. Loads `data/db/*.json` (schema extracted from the CP-PAW manual) at import time. | ase, numpy |
| `prot.py` | 755 | `cppawReport` state-machine parser for the `ENERGY REPORT` / `ATOMLIST REPORT` / eigenvalue blocks; `cppawProtocol` collects `!>` iteration rows into a pandas DataFrame and plots them. | ase, numpy, pandas, matplotlib |
| `globals.py` | 53 | Default parameters, cluster command templates (`cpPawCmds`), batch/analyse/plot defaults. | - |
| `script.py` | 315 | Generates a bash driver script from snippets in `tools/script/*.sh` (mainscript, checkprot, checkold, checkrunning, dostuff, wavescript). | - |
| `db.py` / `batch_db.py` / `batch.py` | 1842 / 387 / 535 | Batch-calculation layer over `ase.db` (sqlite): test-set management, submission, result harvesting. | ase.db, pandas |
| `analyse.py` / `statistics.py` | 733 / 347 | Post-processing of test sets (G2 atomisation energies, dipoles vs CCCBDB, RMSE/AVG stats). | pandas, matplotlib |
| `visualize.py` / `visualize_new.py` / `visualize_legacy.py` / `viewer.py` / `dos_plot.py` / `colors.py` | 869 / 671 / 272 / 345 / 596 / 237 | Structure and density/DOS plotting (matplotlib, x3d, povray via ase), NEB-image distance plots, element colour tables. | matplotlib, ase.visualize, x3d/ipyvolume (optional) |
| `manual_converter.py` | 309 | Converts the CP-PAW LaTeX manual (`\block{}`, `\vformat{}` ... macros) into `data/db/*.json` and `data/db/sequentialdb.csv`. | pandas |
| `openbabel_integration.py` | 432 | Open Babel conversions/force-field helpers. | openbabel |
| `jupyter.py`, `jobs.py` | 177, 13 | Notebook widgets; job-list stub. | ipywidgets |
| `tools/base.py` | 586 | `run_command()` (**`shell=True`**), `paw_toxyz.x`/`paw_strc.x` wrappers, `.dprot`/`.sprot`/DOS/gnuplot file readers. | ase.data |
| `tools/autore.py` | 1189 | Automatic re-submission / re-run management for cluster jobs. | - |
| `tools/orca.py`, `tools/povray.py` | 139, 56 | ORCA input helper; povray rendering helper. | - |

Section 4 (below) lists per-module import status and the pytest results. The secondary modules are
summarised in more detail in section 1.9-1.12.

### 1.2 The calculator class (`calculator.py:58-1883`)

* **Base class**: `ase.calculators.calculator.FileIOCalculator` (`calculator.py:25,58`). However
  `cppaw.__init__` (79-194) **never calls `FileIOCalculator.__init__`** and overrides `set_label`,
  `set`, `reset`, `todict`, `read`, `get_property`, `check_state`, `calculation_required`, `calculate`,
  `write_input`, `read_results`. In practice it is a from-scratch calculator that only inherits the
  class name; nothing of ASE's `command`/`profile`/`directory` machinery is used.
* **`implemented_properties`** (72-77): `energy, forces, dipole, charges, xc, magmom, positions,
  occupations, number_of_bands, eigenvalues, bz_k_points, spin_polarized, number_of_spins`.
  `stress`, `magmoms`, `free_energy` are *not* implemented (`get_stress` at 517 raises via
  `get_property`). Several names (`positions`, `xc`, `occupations`) are not ASE properties at all.
* **Parameters** (`globals.defaultParameters`): `instructions` (list of dicts, each mapping a file
  type `strc|cntl|dcntl|wcntl|jobscript|parameters|runBefore|runScript|backup|doStrc|doDos|doWcntl`
  to a string or `inputFile` object), `np`, `node='2x12o'`, `version='1216'`, `paw='paw'`,
  `rstrt='F'`, `read=False`, `verbose`, `chckold`, `report`, `logCalc`, `backup`, `chckFrc=-1`.
  Plus implicit keys `atom_names`, `spin`, `pbc` that are derived from the `!STRUCTURE` file.

#### How inputs are written

* Default instruction chain when only `atoms` is given (`calculator.py:119-125`):
  `[{'strc': strcInputFile(atoms)}, {'cntl': data/defaults/sample_strt.cntl}, {'cntl': data/defaults/sample_rlxe.cntl}]`
  i.e. one wavefunction start run followed by a relaxation run. **Nothing in the CNTL is generated from
  Atoms**; CNTL files are pure templates (`data/defaults/*.cntl`, listed in 1.8).
* The `!STRUCTURE` file *is* generated (`input_files.py:926-1117`, `strcInputFile.__init__`):
  * starts from the template `data/defaults/default1.strc` (`!GENERIC LUNIT=1.889726124`,
    `!OCCUPATIONS EMPTY=15 NSPIN=2 SPIN[HBAR]=0. CHARGE[E]=0.`, fcc-like `!LATTICE T=` 6 Å block);
  * `pbc` handling (964-973): all-False -> adds `!ISOLATE`; otherwise adds `!KPOINTS R=30.0`
    (hard-coded). The `atoms.center(vacuum=7.0, axis=...)` call at 970-973 is **unreachable**
    (guarded by "all pbc True" and then tests each pbc for False), so mixed pbc gets neither
    `!ISOLATE` nor vacuum;
  * `setValue(['!LATTICE','T'], atoms.cell[:])` (974) - cell in Å because LUNIT = 1 Å in Bohr;
  * species: for each unique symbol builds a CP-PAW species name (`'O_'` for one-letter,
    `'CL'` for two-letter symbols) and copies the matching `!SPECIES` block from
    `data/defaults/specieslist_final.strc` (15 species, PBE/NDLSS setups) falling back to
    `specieslist_e0k.strc` (195 species) (`input_files.py:983-995`, module-level
    `g2_species`/`e0k_species` loaded at 2123);
  * atoms: `writeAtoms` (1083-1117) emits `!ATOM NAME='O_1' R=x y z !END` per atom with names
    `SYMBOL_index` uppercased; positions in Å.
  * `updateStrcInput(atoms)` (1030-1056) rewrites `T=` and every `R=` in place on each `calculate`.
* **Constraints**: `strcInputFile.aseConstraints` is declared (941, 957) but never populated or
  written. `FixAtoms` etc. are silently ignored.
* **Charge / spin / occupations**: `CHARGE[E]` and `SPIN[HBAR]` are only ever read
  (`calculator.py:184-190`, `getValue`) - there is **no `setValue(['!OCCUPATIONS', ...])` anywhere**, so
  `atoms.get_initial_charges()` / `get_initial_magnetic_moments()` are dropped on input (they are only
  used in `compare_atoms` to decide whether to recalculate, 227-229). This is the same defect as the
  workbench audit's ARCH-1.
* `write_input()` (1689-1736) is **dead and broken**: it references `AseCppawScript` which is never
  imported (NameError) and runs `rm *.strc* *.cntl*` through `run_command` (`shell=True`). The live
  path is `calculate()` (937-1013) which writes files itself via `saveInputFile`.

#### How CP-PAW is run

* `calculate()` iterates `instructions`; for each dict writes the files into `self.directory`
  (`label`), then `doInstructions()` (1065-1184):
  * `runBefore`/`runScript` snippets are written to disk, `chmod +x`, executed (`shell=True`).
  * Restart: if `rstrt` truthy and `<fileName>.rstrt` exists it runs
    `sed -i "s/START=T/START=F NEWSTRC=T/g" case.cntl` (1122) - string surgery on the CNTL.
  * Command templates (`globals.cpPawCmds`):
    `paw`: `paw_fast.x @inputFile@.cntl &>out &`; `ppaw`: `orterun -mca btl self,vader -np @np@ ppaw_fast.x ...`;
    `sbatch`: `sbatch --ntasks=@np@ ... --partition=@node@ ... jobscript @inputFile@.cntl`;
    `sbatchpaw`: `sbatchpaw -t @np@ -p @node@ -v @version@ -c @inputFile@.cntl`.
    For the local case it writes `case.sh` (`#!/bin/bash\npaw_fast.x case.cntl &>out &`) and
    `subprocess.Popen(['./case.sh'], start_new_session=True, cwd=directory)` (1170-1176).
  * Environment assumptions: `paw_fast.x`, `paw_strc.x`, `paw_dos.x`, `paw_wave.x`, `paw_toxyz.x`,
    `sbatchpaw` must be on `PATH`. **`PAWDIR` is never read** by the package (the CP-PAW binaries find
    setups themselves). Cluster-specific defaults are hard-coded: `node='2x12o'`, `version='1216'`,
    `'2x12o_low_priority'` (`globals.py:16,22`). Personal paths: `examples/nudged-elastic-bands/fireneb_vc.py:23`
    `sys.path.append('/home/pkaiser/hiwi/AseCppaw')`; the README example points to
    `data/examples/h2o` which does not exist.
  * Progress: `tailProt()` (1579-1671) busy-polls the `.prot` file (`follow()` generator, 20 ms
    sleep), feeds `!>` rows into `cppawProtocol` and report lines into `cppawReport`, and stops on
    `PROGRAM FINISHED`, `ERROR`, or `STOP IN`. `checkTmp()` (1034/1205, defined twice) treats any
    `*.tmp` file in the directory as "job running" and **truncates it to one space if > 1 GB**.
  * Convergence auto-pilot `checkConvergence()` (1408-1502): inspects the `ANNEE` friction column and
    `E(RHO)` trend and re-submits with modified `!PSIDYN`/`!RDYN` friction up to 3 times.
  * Backups `doBackup()` (1300-1368) copy files/dirs with suffixes; uses `os.system('cp ...')` for
    files > 1 GB. `checkOld()` (1370-1406) **deletes every file in the working directory** when a
    backup folder with an identical `.strc` is found, then copies the backup back.

#### How results are read

* `read_results()` (1822-1850) -> `readConvergence()` (1852-1883) -> `readCppawReport()` (1786-1820).
* `readConvergence` finds the last `PROGRAM STARTED` (`rfind`) and sets `converged=True` only if
  `STOP SIGNAL RECEIVED` follows; `ERROR=True` if `ERROR` appears; otherwise `ERROR = not 'PROGRAM FINISHED'`.
  Protocol files are **appended across runs** (the h2o example has 3 program runs; ch3cli 292), so all
  readers rely on `rfind` of the last block.
* `readCppawReport` seeks to the last `ENERGY REPORT` and streams lines through
  `prot.cppawReport.readReportLine` (`prot.py:307-406`). No regexes - all matching is by substring
  and `str.split()`:
  * `"TOTAL ENERGY" in line` -> `float(line.split()[3]) * ase.units.Hartree` (322).
  * `"ATOMLIST REPORT"` switches to `cell` mode: lines starting with `T` are parsed as `T1[ANGSTROM]= x y z`
    (331-347); a line starting with `NAME` switches to `atomlist` mode and, if `MH/ABOHR` is in the
    header, sets `force_fact = Hartree/(1000*Bohr)` (348-351).
  * `readAtomList` (181-233) reads `NAME ( x, y, z ) M MPSI_EFF Q ( fx, fy, fz )`: position from the
    first parenthesis group, charge = last token before the second `(` (or end of line), force from the
    second parenthesis group *if present*.
  * Eigenvalues/occupations by `EIGENVALUES [EV] FOR K-POINT n AND SPIN s` headers (mode
    `eigenvalues_k1s1`) and a hand-rolled tokenizer `readEigOcc` (235-276).
  * `reportResults()` (445-570) assembles `results`: `forces = array(forces) * force_fact`
    (`[0,0,0]` for atoms without a force triple), `charges`, `positions`, `symbols` (derived from the
    atom name: `X_` -> one-letter, else two-letter), `cell`, `dipole` (sum of `Q * (r - com)`), `magmom`
    (`spin * g_e` or `g_e*sqrt(S(S+1))`), `number_of_bands`.
* `calculator.get_property()` (810-861) returns the literal string `'ERROR IN CALCULATION'` when the
  run failed (852), instead of raising.

#### Unit conversions (verified numerically)

| Quantity | CP-PAW unit | Conversion used | Constant |
|---|---|---|---|
| Energy | Hartree (`H`) | `* ase.units.Hartree` | `27.211386024367243` eV (ASE 3.25 CODATA 2014 default) |
| Forces | `mH/aBohr` | `* Hartree/(1000*Bohr)` | `0.051422067090480646` eV/Å per mH/Bohr; `Bohr = 0.5291772105638411` Å |
| Positions, cell | Å (`LUNIT=1.889726124` Bohr = 1 Å written into `!GENERIC`) | none | - |
| Charges `Q[E]` | e | none | - |
| Eigenvalues | eV (protocol prints `[EV]`) | none | - |
| Magnetic moment | `SPIN[HBAR]` (S) | `S * g_e`, `g_e = -2.00231930436256` (`prot.py:27`) | Sign convention is negative! |
| Dipole | e·Å, computed from point charges | `sum(Q_i (r_i - com))` with `com = get_center_of_mass(scaled=True)` | **bug**: scaled (fractional) COM subtracted from Cartesian positions |

#### `read=True`, `label`, restart

* `label` = working directory (`set_label`, 297-313); `fileName` (default `'case'`) is the CP-PAW
  root name; `filePath = label/fileName`. `prefix` is always `''`.
* `read=True` means "do not run, parse the existing `<label>/<fileName>.prot`" (`calculate`, 960-965).
  In `__init__` the input files are re-discovered through `readDir()` (`input_files.py:1907-1987`,
  recognises `case.cntl`, `case.cntl1..5`, `case.cntl_strt/_rlxe/_urlx/_rlxr/_rlx`, `case.strc`,
  `case.strc1..`, `jobscript`), **but the guard at `calculator.py:129` checks
  `os.path.exists(self.fileName + '.prot')` relative to the CWD, not `self.filePath`**. Consequence
  (reproduced): `cppaw(read=True, label='ch3', fileName='case')` from the parent directory fails with
  `KeyError: 'atom_names'`; it only works when the CWD is the calculation directory (`label='.'`).
* Restart: `rstrt='T'` reuses `<fileName>.rstrt` (via `sed` on `START=`); a path string copies that
  restart file in. `chckold=True` short-circuits by copying an old backup if the `.strc` is identical.
* `results['ERROR']`/`'converged'` are the only status signals; for the completed ch3cli single-step run
  `converged` came back `False` (no `STOP SIGNAL RECEIVED` is printed for `NSTEP=1`).

#### NEB path

There is no NEB code in the package itself. Two examples exist:
* `examples/nudged-elastic-bands/fireneb_vc.py` (2020): builds `ase.neb.NEB(images, method='improvedtangent',
  parallel=True, remove_rotation_and_translation=True)`, `interpolate('idpp')`, one `cppaw` calculator
  per image with a 3-step instruction list (`case.cntl1` start, `case.cntl2` relax, `case_force.cntl`
  force step) submitted via `sbatch`, optimiser `FIRE(neb, trajectory, restart)`. Personal path at line 23.
* `neb_simulation.ipynb` imports `from ase_cppaw import read_strc, read_input, cppaw` - **a module that
  does not exist** in the package (the notebook cannot run as-is). `data/examples/ch3cli_*.strc`,
  `ch3cli.cntl`, `ch3cli_force.cntl` are the inputs it refers to. Last commit `aaea61b neb works`.
* The force-step template `data/defaults/neb_force.cntl` / `case_force.cntl`:
  `!GENERIC NSTEP=1 START=F`, `!PSIDYN STOP=F FRIC=0.008`, `!RDYN STOP=F FRIC=0.0` - i.e. one MD step
  with atom dynamics *enabled* so that forces are printed (see 3.1).

### 1.3 Input-file object model (`input_files.py`)

`inputFile(block, branches)` is a tree of `branchdict()` (`{'branch','active','branches'}`) and
`leafdict()` (`{'leaf','types','value','active'}`) nodes. Parsing (`readbranch`, 1300-1388) is driven
by the schema in `data/db/<BLOCK>.json` (CONTROL 116 kB, STRUCTURE 106 kB, DCNTL, DPCNTL, GCNTL,
PCNTL, BCNTL, TCNTL, WCNTL; 337 kB total) which was generated from the CP-PAW manual by
`manual_converter.py`. Each schema node has `block|leaf`, `types` (`real`, `real(3)`, `real(3,3)`,
`integer array`, `character`, `logical`, ...), `rules` (`mandatory`, `optional`, `multiple`, mutual
exclusions) and `description`. `_x` suffixed blocks (`!RDYN_x`) are parsed as inactive
(`active=False`) and re-emitted with `_x`. Serialisation is `objecttoinput` (1423-1500) with
`formatFloat` (1280-1298, 8 significant digits) and 79-column wrapping. Accessors:
`getValue(path)`, `setValue(path, value)`, `addBranch`, `removeBranch`, `getMultiBranch(...,'NAME', name)`.
`fortran_float` (102-137) handles `1.234D+05` and `0.31674-103`.

### 1.4 Protocol layer (`prot.py`)

`cppawReport` (125-570) described above; `cppawProtocol` (571-755) turns `!>` rows
(`NFI T[PSEC] T[K] EKIN(PSI) E(RHO) ECONS ANNEE ANNER`) into a pandas DataFrame (`readLine`, 637-667,
prints every line) and plots with matplotlib (`showGraph`). `getTimeObj/convertTime` parse
`PROGRAM STARTED on THU 22 MAY 2025 15:03 (30.004S)` using `locale`.

### 1.5 Batch / DB layer (`db.py`, `batch_db.py`, `batch.py`, `data/testset/*.db`)

See section 4/agent findings summarised in 1.9. In short: the `.db` files are standard `ase.db`
sqlite databases whose rows carry reference data for benchmark sets (G2 atomisation energies, CCCBDB
dipoles, `.sprot` structure reports) in `key_value_pairs`/`data`; `batch.py` submits one `cppaw` per
row with `batchDefParams` (`paw='sbatch'`, `node='2x12o_low_priority'`) and harvests results back.

### 1.6 Manual converter (`manual_converter.py`)

Reads the CP-PAW manual LaTeX source (`\block{!CONTROL}`, `\brules{}`, `\bdescr{}`, `\vformat{}`,
`\vrules{}`, `\vdefault{}` macros) and emits the schema JSON files in `data/db/` plus
`sequentialdb.csv` (columns `block0..block4, rules, default, types, description`). It is a one-off
generator; its *output* (the JSON schema) is the valuable artefact.

### 1.7 Open Babel integration (`openbabel_integration.py`)

Wraps `openbabel.pybel`/`OBConversion` for format conversion, hydrogen addition and force-field
pre-optimisation of molecules before CP-PAW. Details in 1.9.

### 1.8 Templates shipped in `data/defaults/`

`sample_strt.cntl` (start: `NSTEP=200 DT=5.0 START=T`, `EPWPSI=30`, `!DFT TYPE=10`, `!PSIDYN STOP=T FRIC=0.05 !AUTO ...`),
`sample_rlxe.cntl` (relax: `NSTEP=1000 START=F`, `EPWPSI=50`, `!PSIDYN ... SAFEORTHO=T`, `!RDYN_X STOP=T FRIC=0.0 !AUTO ...` -
note `_X` = **atom dynamics disabled**), `case_force.cntl`, `neb_force.cntl` (force step, `!RDYN` active),
`mol_*.cntl`, `surf_*.cntl` (`_strt`, `_urlx`, `_rlxr`, `_hf` hybrid variants), `default1.strc`,
`default.strc`, `default.dcntl`, `default.wcntl`, `specieslist_final.strc` (15 PBE species),
`specieslist_e0k.strc` (195 species), `atomcolors*.json`.

### 1.9 Secondary modules, tests, data, history

**Batch/DB layer.** `db.py` defines `AseCppawDB` -> `batchDB`, `analyseDB` over `ase.db`; `batch.py`
submits one `cppaw` per DB row (`batchDefParams`: `paw='sbatch'`, `node='2x12o_low_priority'`,
`rstrt='T'`) and harvests results; `batch_db.py` manages test-set folders. `data/testset/*.db` are
**plain ASE sqlite databases** (tables `systems, species, keys, text_key_values, number_key_values,
information`): `allRef.db` (297 rows, reference atomisation energies), `g2ref.db` (184, G2 set,
kvp `name`, `g2num`), `kepp.db` (15), `margraf.db` (152, bond-type tags such as `b_C2C`),
`nistcccbdb.db` (1894 rows, NIST CCCBDB reference data). They are useful as benchmark reference
data for a validation suite, not for the application core. Note that `batch_db.py:132` and
`batch.py:206` run `rm -rf <label>` via `shell=True` string concatenation.

**Import-level breakage.** `db.py`, `analyse.py`, `openbabel_integration.py`, `visualize.py`,
`visualize_new.py`, `viewer.py`, `batch.py`, `batch_db.py` carry `# wildcard import replaced`
comments from an automated refactor; `db.py` (lines 130, 178, 182, 189, 261, 290, 447, 533, 545,
1180, 1185, 1838), `analyse.py` (383, 582) and `openbabel_integration.py` (141) still call
`AseCppawInputFiles.*` **without importing it** -> `NameError` at call time. `visualize.py:22`
`import AseColors` fails at import time (module does not exist; `visualize_new.py` uses
`ase.data.colors.jmol_colors` instead). Commit `f42f7c6` ("pip package works, small bugs (imports)
still present") acknowledges this.

**Analysis.** `analyse.py` (`analyseStruc`, `analyseGeometry`, `calculateAE`, `analyseCalcSet`,
`analyseAll`) compares calculated vs reference geometries/energies; `statistics.py`
(`doStatistics`, `grubbsTest`, `standardDeviation`) is pure stdlib math and reusable as-is;
`colors.py` is a static Jmol colour table; `jobs.py` is an empty 13-line stub.

**Manual converter.** Parses the CP-PAW manual LaTeX (`\block{!CONTROL}` ... `\vdefault{}` macros),
builds a pandas table and writes `data/db/*.json` + `sequentialdb.csv` (`manual_converter.py:278`).
Outputs exist and are what `input_files.py` loads at import.

**Open Babel integration** (`openbabel_integration.py`, 432 lines): `pybel.readstring`,
`OBMol.ConnectTheDots/PerceiveBondOrders`, `OBMolBondIter`; functions `atoms2xyz`, `findFF`
(gaff/mmff94/uff), `findConformer` (force-field optimisation), `perceiveBonds`/`perceiveBondsStrc`,
`writeMoleculeSVG`, `smiles2atoms`, `inchi2atoms`, `getMultiplicity`. Works with the installed
Open Babel 3.1.0; no error handling around OB calls; bond orders are returned as tags, not stored on
the Atoms.

**Visualisation.** `visualize*.py`: matplotlib contour / "rubber-sheet" 3-D plots of CP-PAW density
and wave-function grids (`contourPlot`, `rubberSheet`, `plotDict`), POV-Ray renders (`simplePOV`,
`getPovData`, `tools/povray.makePov`), `morphAtoms` and NEB image distance plots. `viewer.py`:
`NGLDisplay`/`view_ngl()` nglview + ipywidgets viewer. `dos_plot.py`: `dosFunction`/`dosPlot`
matplotlib DOS plots from `paw_dos.x` `.dos` files. No x3d/ipyvolume code path is exercised
(x3d only through `ase.visualize` in notebooks). `visualize_legacy.py` is superseded.

**tools/.** `tools/autore.py` is not "auto-restart": it is an **auto**matic **r**eaction-**e**quation
generator (`makeCompDictDb`, `autoRE`, `balancedCoefficients`, `scoreReactions`, `minimizeCoeff`,
`getReactionLaTeXStr`) for reaction/atomisation-energy benchmarking. `tools/orca.py` writes/reads
ORCA inputs for cross-validation; `tools/povray.py` renders.

**Examples/docs.** All `examples/useCase*.py` hard-code personal paths
(`/home/pmk/paw/hiwi/new_ase_cpaw/...`, `/mnt/pmk/nuku/femoco_resting_state/...`, `uName='pmk'`);
`examples/ir_h2o/infrared.py` and `fireneb_vc.py` import the pre-package modules `AseCppaw`,
`AseCppawBatch`, `AseCppawInputFiles` from `/home/pkaiser/hiwi/AseCppaw`. `changes.patch` is not a
diff but a 48-line list of file paths. `docs/doxygen` is stale (references a removed `db_old`);
`docs/notebooks/` has `h2o`, `indole`, `neb`, `neb_reload`, `contour_plot`, `read_manual` notebooks.
`paw_setup.sh` is an apt/`git clone`/build script that symlinks CP-PAW binaries into `/usr/local/bin`.

**Packaging.** Three inconsistent metadata files: `pyproject.toml` (version 0.2.0, deps
`ase>=3.22`, `numpy>=1.21`, `openbabel-wheel>=3.1.1.21`), `setup.cfg` (1.2.0, `openbabel>=3.1.1`),
`setup.py` (0.1.0, `pdfplumber`, author email `pmk@example.com`). `python_requires` not pinned
consistently. The package is editable-installed in the `asecppaw` env pointing at
`/home/pmk/ase-cp-paw/src`.

**History.** 30 commits, 2022-11-23 (`16351c3 ase-cp-paw inital commit state 14.11.22`) to
2025-05-24 (`aaea61b neb works`), one author under three identities (`Patrick Kaiser`, `PMK89`,
`Patrick M. Kaiser`), remote `git@github.com:cp-paw/ase-cp-paw.git`. The 2025 commits
(`110e5c3 added unit tests`, `69713f8 made neb test`, `4ddb043 fixed read=True bug`,
`42803cd fixed density error`) are the most recent functional work.

---

## 2. Reuse / reimplement / obsolete

### Reusable as-is or with light porting (name, file, lines)

| Function / asset | Location | Why |
|---|---|---|
| CP-PAW input schema JSON | `src/asecppaw/data/db/{CONTROL,STRUCTURE,DCNTL,DPCNTL,GCNTL,PCNTL,BCNTL,TCNTL,WCNTL}.json` | Machine-readable types/rules/help for every CP-PAW input keyword; enables a validating editor and autocompletion in Atomscope. Regenerate from the current manual with a modernised `manual_converter.py` (the CP-PAW manual has evolved since 2018/2022). |
| `fortran_float` | `input_files.py:102-137` | Needed for `.cub`/`.strc_out`/protocol numbers like `1.0502140000000001E-003`, `0.31674-103`. Remove the `replace('d0','0000')` hack (it corrupts e.g. `2.5d03`) and use a proper regex. |
| `readbranch` / `objecttoinput` / `convertValue` / `formatFloat` / `checkend` / `checkvalue` | `input_files.py:1300-1388, 1423-1500, 1193-1278, 1280-1298, 1119-1171` | Working round-trip parser/serialiser for the CP-PAW block language including `_x` deactivation and 79-col wrapping. Port the algorithm, rewrite with a real tokenizer (the current one is regex-per-keyword with `print` debugging and returns strings on error). |
| `strcInputFile.writeAtoms` + species lookup | `input_files.py:983-995, 1058-1117`; `data/defaults/specieslist_final.strc`, `specieslist_e0k.strc` | Atoms -> `!ATOM` blocks and species-block lookup by symbol; the two species lists are the only ready-made PAW setup tables in the codebase. |
| `strcInputFile.__init__` (branches path) | `input_files.py:996-1028` | `.strc` -> `Atoms` (names, `R=`, `T=`, `!ISOLATE` -> pbc). |
| `cppawReport.readReportLine/readAtomList/readEigOcc/readKPointList` | `prot.py:181-406` | Reference for the exact protocol layout (block headers, column semantics, `mH/ABOHR` header detection). Reimplement with regexes and `PROGRAM STARTED` splitting; keep as the spec. |
| `cppawReport.reportResults` | `prot.py:445-570` | Reference for symbol-from-atom-name, `force_fact`, magmom conventions. |
| `cppawProtocol.readLine` | `prot.py:637-667` | `!>` iteration-row layout for live progress plots. |
| `readDir` | `input_files.py:1907-1987` | Documents the file-naming conventions of existing calculation folders (`.cntl1`, `.cntl_strt`, `.cntl_rlxe`, ...) - needed to import legacy calculations. |
| `makeDcntl/makeDosWeight/makeAtomBranch`, `makeWcntl/makeViewbox/makeViewplane`, `makeAnalyseCntl` | `input_files.py:1503-1905` | Generators for DOS (`paw_dos.x`) and density/wavefunction (`paw_wave.x`) control files; useful for an analysis panel. |
| `readCube` | `input_files.py:1989-2019` | Replace with `ase.io.cube.read_cube_data` (bug: index rollover uses `>= n-1`, dropping the last plane). |
| CNTL templates | `data/defaults/*.cntl` | Good starting presets (start / relax / force / hybrid / surface). |
| `tools/base.readDprot/readSprot/readDos/readDosFolder/readGnuFile/readStp(s)` | `tools/base.py:187-586` | Parsers for `paw_dos.x`/`paw_strc.x` outputs. |
| `getTimeObj/convertTime` | `prot.py:30-124` | Protocol timestamp format. |
| `atomcolors*.json` | `data/defaults/` | Element colour tables (compare with `ase.data.colors.jmol_colors`). |

### Reimplement (keep the idea, not the code)

* The calculator itself (`calculator.py`): the instruction-list concept ("write strc + a sequence of
  cntl files, run them in order, tail the protocol") is the right abstraction for CP-PAW's multi-stage
  workflow, but the implementation is a hand-rolled process manager with shell strings, polling loops
  and destructive helpers. Build on `GenericFileIOCalculator`/`CalculatorTemplate` (section 5) with an
  explicit `Stage` list and a stream-parser for progress.
* Protocol parsing: same layout, but split on `PROGRAM STARTED`, parse only the last run, regex with
  anchored patterns, and **fail loudly when forces are absent** (see 3.1).
* Species/setup lookup: table-driven (`symbol -> !SPECIES block`), but sourced from the CP-PAW
  distribution's setup files instead of a 2020 snapshot.

### Obsolete

* `doInstructions`, `tailProt`, `follow`, `checkTmp`, `checkConvergence`, `doBackup`, `checkOld`,
  `runWcntl` (`calculator.py:909-1671`), `script.py` + `tools/script/*.sh`, `tools/autore.py`,
  `globals.cpPawCmds`: cluster (Slurm `sbatchpaw`, `2x12o` partitions) and shell-script specific.
* `batch.py`/`batch_db.py`/`db.py`/`analyse.py`/`statistics.py`: benchmark-campaign tooling around
  test-set `.db` files - not needed for an interactive application; `ase.db` itself is still useful.
* `visualize*.py`, `viewer.py`, `dos_plot.py`, `jupyter.py`: matplotlib/x3d/notebook-era rendering;
  Atomscope has its own renderer. Keep only the DOS file readers.
* `openbabel_integration.py`: superseded by the workbench `openbabel_service.py` (which correctly
  round-trips charge/multiplicity and captures OB errors).
* `manual_converter.py`: keep as a tool to regenerate the schema, not as runtime code.

---

## 3. Assumptions, bugs and audit cross-checks

### 3.1 Forces only exist when atom dynamics is on (== workbench PARSE-1)

Verified against real protocols:

* `/home/pmk/ase-cp-paw/calculations/h2o/case.prot` (CNTL has `!RDYN_x` = disabled). The ATOMLIST rows
  have the `FORCE[MH/ABOHR]` header but **no force column**:
  ```
  NAME          POSITION[ANGSTROM]            M[U]    MPSI_EFF[U] Q[E]           FORCE[MH/ABOHR]
  O_1      (  0.00000,  0.00000,  0.11926)   15.9994    3.3263  -0.00000
  ```
  `grep -c` for rows with two parenthesis groups: **0**.
* `/home/pmk/ase-cp-paw/calculations/ch3cli/cppaw1/case.prot` (CNTL `!GENERIC NSTEP=1`, `!RDYN STOP=T FRIC=0.0`):
  ```
  CL1      ( -1.84596,  0.48399,  0.00003)   35.4527    1.6537  -0.44329  ( -16.52,  -0.33,   0.03)
  ```
  730 such rows.
* Running `asecppaw` on both (`.scratch/ase/smoke/`): h2o -> `get_forces()` returns
  `[[0,0,0],[0,0,0],[0,0,0]]` **silently** (because `reportResults` appends `[0.0,0.0,0.0]` for atoms
  without a force triple, `prot.py:483-486`); ch3cli -> real forces (max 0.025 eV/Å) and energy
  `-936.234 eV = -34.4060 H`. So any ASE optimiser or NEB driven by the default
  `sample_rlxe.cntl` (`!RDYN_X`) converges at step 0 - exactly the PARSE-1 no-op reported in
  `/home/pmk/cp-paw/docs/third_party_audit_report.md`. The workbench fixed this by (a) running native
  CP-PAW friction dynamics instead of ASE-BFGS and (b) `parse_protocol_report(..., require_forces=True)`
  raising when no forces are present (`backend/app/protocol.py:247-302`).
* Additional precision trap: forces are printed with 2 decimals in mH/aBohr, i.e. a resolution of
  0.005 mH/Bohr ≈ 2.6e-4 eV/Å; `fmax` targets below ~1e-3 eV/Å are meaningless from the protocol.
  A binary/structured force output (`case_r.tra`, `.strc_out`, or a CP-PAW option to print more digits)
  should be preferred.
* Whether `!RDYN STOP=T FRIC=0.0 NSTEP=1` is a clean single-point-with-forces recipe is **not
  established**: in the ch3cli run the last ATOMLIST positions (`CL1 -1.84596 ...`) differ from
  `case.strc` (`-1.9626 ...`) by ~0.1 Å, so the atoms moved (or the strc was rewritten by a previous
  stage). This must be verified against CP-PAW's `TSTOP` semantics before Atomscope relies on it.

### 3.2 Charge/spin dropped (== ARCH-1)

`default1.strc` fixes `CHARGE[E]=0. SPIN[HBAR]=0. NSPIN=2 EMPTY=15`; `strcInputFile` never writes
`!OCCUPATIONS` from Atoms and the calculator only reads `SPIN[HBAR]` to compute a `magmom`. An ion or
radical passed as `Atoms` with `initial_charges`/`initial_magmoms` is computed as a neutral singlet.
The workbench version (`backend/app/structures.py:454-460`) writes `CHARGE[E]`/`SPIN[HBAR]` from
`structure.charge`/`multiplicity`, but its ASE bridge smears the totals evenly over
`initial_charges`/`initial_magmoms` (`backend/app/ase.py:107-116`) - a trap for anything reading
per-atom values.

### 3.3 Other bugs / risky assumptions found

| # | Location | Issue |
|---|---|---|
| B1 | `calculator.py:129` | `read=True` checks `os.path.exists(self.fileName + '.prot')` relative to CWD -> `KeyError: 'atom_names'` from any other directory (reproduced). |
| B2 | `calculator.py:1735` | `AseCppawScript` undefined -> `NameError` in `write_input`. |
| B3 | `calculator.py:1711`, `tools/base.py:49-52`, `1122`, `1348` | `run_command(..., shell=True)` with interpolated file names; `rm *.strc* *.cntl*`; `sed -i` on the CNTL; `os.system('cp ...')`. |
| B4 | `calculator.py:1015/1186, 1034/1205` | `calculate_numerical_forces` and `checkTmp` are defined twice; the former imports `ase.calculators.test.numeric_force`, which **does not exist in ASE 3.25** (`ImportError` verified). |
| B5 | `calculator.py:79-194` | `FileIOCalculator.__init__` never called; `atoms.calc = self` is set inside the calculator constructor (side effect on the caller's object); `atoms.positions`/`cell` are overwritten from file at 112-113. |
| B6 | `calculator.py:852` | `get_property` returns the string `'ERROR IN CALCULATION'` instead of raising -> downstream `float` arithmetic errors far from the cause. |
| B7 | `prot.py:539` | `dipole` uses `get_center_of_mass(scaled=True)` (fractional) minus Cartesian positions; also a point-charge dipole, not CP-PAW's. |
| B8 | `prot.py:213-233` | `Q[E]` printed as `********` (Fortran overflow, seen in ch3cli last report) -> charge unreadable -> `charges` shorter than `positions`, dipole loop misaligned. |
| B9 | `prot.py:529-535` | `magmom = S * g_e` is negative for positive spin (g_e = -2.0023); ASE convention is µB with positive = majority spin up. |
| B10 | `input_files.py:964-973` | Unreachable `atoms.center(vacuum=7.0)`; mixed pbc handled as periodic without `!ISOLATE`; `!KPOINTS R=30` hard-coded. |
| B11 | `input_files.py:941,957` | Constraints ignored (see 1.2). |
| B12 | `input_files.py:112` | `fortran_float` `replace('d0','0000')` corrupts `d0` inside exponents. |
| B13 | `input_files.py:2004-2016` | `readCube` rollover `>= n-1` drops the last plane in each dimension. |
| B14 | `input_files.py:1300-1388`, `prot.py:645` | Debug `print()` on hot paths (every `!>` line is printed). |
| B15 | `calculator.py:1852-1883` | `converged` heuristic (`STOP SIGNAL RECEIVED`) false for finished `NSTEP=1` runs (reproduced: `converged=False, ERROR=False`). |
| B16 | `calculator.py:1034-1063` | `checkTmp` truncates any `*.tmp` > 1 GB to a single space; `checkOld` (1370-1406) deletes all files in the working directory. |
| B17 | `globals.py`, examples | Hard-coded cluster names (`2x12o`, `1216`, `sbatchpaw`), personal path `/home/pkaiser/hiwi/AseCppaw` (`fireneb_vc.py:23`), README example path that does not exist, notebook importing a non-existent `ase_cppaw` module. |
| B18 | `prot.py:322` | Energy is the *last* `TOTAL ENERGY` in the file irrespective of which program run produced it; protocols are appended across runs (h2o: 3 runs, ch3cli: 292). |
| B19 | `calculator.py:960-965` | With `read=True`, `calculate()` re-parses the file for every `get_*` call; no caching invalidation logic ties results to the Atoms actually computed. |

### 3.4 Cross-check with the workbench audit (`/home/pmk/cp-paw/docs/*.md`) and code

* **PARSE-1** (critical, relaxation no-op): root cause identical to 3.1. Current workbench code is the
  *post-fix* state: `workflows.py:182-267` runs native `!RDYN` relaxation, `protocol.py:247-302`
  raises on missing forces (comment cites PARSE-1), NEB is explicitly disabled (`workflows.py:508-524`).
* **ARCH-1** (charge dropped): fixed in workbench `ase.py:107-116` and `structures.py:454-460`;
  regression test `backend/tests/test_ase.py:69-86`.
* **TQ-1** (no workflow test coverage): partially addressed - `test_workflow_jobs.py` still stubs
  `run_workflow_job`; `_run_relaxation`/`_run_molecular_dynamics` remain untested end-to-end.
* **OB-1** (Open Babel warnings not captured): fixed (`openbabel_service.py:71-101` uses the global
  `ob.obErrorLog`).
* Still open in the workbench: `structures.py:42-44` silent `except Exception: pass` around RDKit UFF;
  `workflows.py:278-294` `except Exception: rows = []` writes an empty trajectory silently;
  `_suppress_stderr` fd-dup2 hack (`openbabel_service.py:524-536`).
* Unit constants in the workbench agree with `asecppaw`: `LUNIT=1.889726124` (`structures.py:464`),
  `_MH_ABOHR_FORCE_FACT = units.Hartree/(1000*units.Bohr)` (`protocol.py:37`), `_G_FACTOR = -2.00231930436256`
  (`protocol.py:34`), `_ANGSTROM3_TO_ABOHR3 = (1/units.Bohr)**3` (`workflows.py:29`).
* Workbench structure model <-> Atoms: bonds are **always regenerated by a distance heuristic**
  (`structures.py:552-585`) after any ASE round-trip; `!STRUCTURE` has no bond concept at all.
  Worth porting from the workbench: `ProtocolReport.finalize` with `require_forces`
  (`protocol.py:247-351`), `ase_tools.py` (measure/geometry/coordination, 121 lines),
  `_capture_obabel_errors`, `element_from_atom_name` (`structures.py:261-279`), and the
  "same function builds preview and executed deck" pattern (`workflows.py:53-104`).

---

## 4. Tests in `ase-cp-paw/tests`

Procedure: the repository was copied (rsync, excluding `.git` and `__pycache__`) to
`/home/pmk/Projects/atomscope/.scratch/ase/ase-cp-paw-copy/` and pytest was run there with
`PYTHONPATH=src`. `pytest` is **not installed** in the `asecppaw` env; it was borrowed via `PYTHONPATH`
from another existing conda env (`envs/ape`, pytest 7.4.0, Python 3.11.7) without installing anything.

* `tests/conftest.py` (14 lines) **replaces the real `ase` package with a stub module** whose `Atoms`
  does nothing (`sys.modules['ase'] = ase`), then adds `src/` to `sys.path`. Consequently no test can
  exercise real ASE behaviour, and any test that would import `ase.units`/`ase.io` would break.
* `tests/test_utils.py`: 6 pure unit tests - `test_branchdict_leafdict`, `test_checkBlock`,
  `test_fortran_float_basic`, `test_checkvalue`, `test_doStatistics`, `test_readValueList` (uses
  `tmp_path`). None require the CP-PAW binary, the network, or personal paths. Nothing tests the
  calculator, the protocol parser, or `strcInputFile`.
* Result: **5 passed, 1 failed** in < 1 s, no hangs, no external process started.
  Failure: `test_fortran_float_basic` - `fortran_float('1.234D+05')` raises
  `ValueError: Unable to parse Fortran float from string: 1.234D+05` (`input_files.py:127-136`): the
  function only handles lowercase `d0` (by string replacement) and the missing-`E` form
  `0.31674-103`; uppercase `D` exponents, promised by its own docstring, are not handled.
* Import check of every module with `PYTHONPATH=src` in the `asecppaw` env: all import except
  `visualize.py` (`ModuleNotFoundError: No module named 'AseColors'`). Third-party imports used across
  the package: numpy, pandas, matplotlib, ipywidgets, nglview, openbabel/pybel - all present in the env.
* The CP-PAW binary itself is present on this machine (`/home/pmk/cp-paw/bin/fast/paw_fast.x`,
  `PAWDIR=/home/pmk/cp-paw`) but is not used by any test. The workbench (`/home/pmk/cp-paw/backend/tests/test_ase.py`)
  shows the better pattern: a fake `paw_fast.x` shell script that writes a canned protocol, so the
  calculator can be tested end-to-end without CP-PAW.

---

## 5. ASE 3.25 API surface for Atomscope

<!-- AGENT_A -->

---

## 6. Mapping Atomscope's structure model <-> `ase.Atoms`

<!-- SECTION6 -->

---

## 7. Design recommendations for the modern CP-PAW ASE calculator

<!-- SECTION7 -->
