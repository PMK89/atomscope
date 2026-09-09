# ASE integration analysis for Atomscope

Scope: (a) the installed ASE 3.25.0 API surface Atomscope should build on, (b) the historical
`asecppaw` package (`~/ase-cp-paw`, author Patrick M. Kaiser, 2020-2025), and (c) the prior
web-workbench ASE code (`~/cp-paw/backend/app/`). Everything below was verified against the
files on disk and by running read-only introspection with `~/miniconda3/envs/asecppaw/bin/python`
(ASE 3.25.0). Scratch outputs live in `.scratch/ase/`.

Licensing note: `~/ase-cp-paw/setup.cfg:9` says `license = MIT` and `pyproject.toml:12` says
`license = { file = "LICENSE" }`, but **no LICENSE file exists in the repository** (`ls LICENSE*` is empty;
the README links to a non-existent `LICENSE`). Since the author is the project owner, this is fixable by
adding the file; until then the package has no effective license grant and nothing should be vendored
from it into a distributed product without the owner adding one.

---

## 1. `asecppaw` architecture

### 1.1 Module map (`~/ase-cp-paw/src/asecppaw/`, 14 986 lines total)

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
    `sys.path.append('/home/<user>/hiwi/AseCppaw')`; the README example points to
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
(`/home/<user>/paw/hiwi/new_ase_cpaw/...`, `/mnt/<user>/nuku/femoco_resting_state/...`, `uName='<user>'`);
`examples/ir_h2o/infrared.py` and `fireneb_vc.py` import the pre-package modules `AseCppaw`,
`AseCppawBatch`, `AseCppawInputFiles` from `/home/<user>/hiwi/AseCppaw`. `changes.patch` is not a
diff but a 48-line list of file paths. `docs/doxygen` is stale (references a removed `db_old`);
`docs/notebooks/` has `h2o`, `indole`, `neb`, `neb_reload`, `contour_plot`, `read_manual` notebooks.
`paw_setup.sh` is an apt/`git clone`/build script that symlinks CP-PAW binaries into `/usr/local/bin`.

**Packaging.** Three inconsistent metadata files: `pyproject.toml` (version 0.2.0, deps
`ase>=3.22`, `numpy>=1.21`, `openbabel-wheel>=3.1.1.21`), `setup.cfg` (1.2.0, `openbabel>=3.1.1`),
`setup.py` (0.1.0, `pdfplumber`, author email `pmk@example.com`). `python_requires` not pinned
consistently. The package is editable-installed in the `asecppaw` env pointing at
`~/ase-cp-paw/src`.

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

* `~/ase-cp-paw/calculations/h2o/case.prot` (CNTL has `!RDYN_x` = disabled). The ATOMLIST rows
  have the `FORCE[MH/ABOHR]` header but **no force column**:
  ```
  NAME          POSITION[ANGSTROM]            M[U]    MPSI_EFF[U] Q[E]           FORCE[MH/ABOHR]
  O_1      (  0.00000,  0.00000,  0.11926)   15.9994    3.3263  -0.00000
  ```
  `grep -c` for rows with two parenthesis groups: **0**.
* `~/ase-cp-paw/calculations/ch3cli/cppaw1/case.prot` (CNTL `!GENERIC NSTEP=1`, `!RDYN STOP=T FRIC=0.0`):
  ```
  CL1      ( -1.84596,  0.48399,  0.00003)   35.4527    1.6537  -0.44329  ( -16.52,  -0.33,   0.03)
  ```
  730 such rows.
* Running `asecppaw` on both (`.scratch/ase/smoke/`): h2o -> `get_forces()` returns
  `[[0,0,0],[0,0,0],[0,0,0]]` **silently** (because `reportResults` appends `[0.0,0.0,0.0]` for atoms
  without a force triple, `prot.py:483-486`); ch3cli -> real forces (max 0.025 eV/Å) and energy
  `-936.234 eV = -34.4060 H`. So any ASE optimiser or NEB driven by the default
  `sample_rlxe.cntl` (`!RDYN_X`) converges at step 0 - exactly the PARSE-1 no-op reported in
  `~/cp-paw/docs/third_party_audit_report.md`. The workbench fixed this by (a) running native
  CP-PAW friction dynamics instead of ASE-BFGS and (b) `parse_protocol_report(..., require_forces=True)`
  raising when no forces are present (`backend/app/protocol.py:247-302`).
* Additional precision trap: forces are printed with 2 decimals in mH/aBohr, i.e. in steps of
  0.01 mH/Bohr ≈ 5e-4 eV/Å (rounding error up to 2.6e-4 eV/Å); `fmax` targets below ~1e-3 eV/Å are
  meaningless from the protocol.
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
| B17 | `globals.py`, examples | Hard-coded cluster names (`2x12o`, `1216`, `sbatchpaw`), personal path `/home/<user>/hiwi/AseCppaw` (`fireneb_vc.py:23`), README example path that does not exist, notebook importing a non-existent `ase_cppaw` module. |
| B18 | `prot.py:322` | Energy is the *last* `TOTAL ENERGY` in the file irrespective of which program run produced it; protocols are appended across runs (h2o: 3 runs, ch3cli: 292). |
| B19 | `calculator.py:960-965` | With `read=True`, `calculate()` re-parses the file for every `get_*` call; no caching invalidation logic ties results to the Atoms actually computed. |

### 3.4 Cross-check with the workbench audit (`~/cp-paw/docs/*.md`) and code

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
`.scratch/ase/ase-cp-paw-copy/` and pytest was run there with
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
* The CP-PAW binary itself is present on this machine (`$PAWDIR/bin/fast/paw_fast.x`,
  `PAWDIR=~/cp-paw`) but is not used by any test. The workbench (`~/cp-paw/backend/tests/test_ase.py`)
  shows the better pattern: a fake `paw_fast.x` shell script that writes a canned protocol, so the
  calculator can be tested end-to-end without CP-PAW.

---

## 5. ASE 3.25 API surface for Atomscope

Installed: **3.25.0** (`~/miniconda3/envs/asecppaw/lib/python3.11/site-packages/ase`). PyPI
latest (2026-09-04): **3.29.0** (3.26.0 2025-08-12, 3.27.0 2025-12-28, 3.28.0 2026-03-17, 3.29.0
2026-06-21). Atomscope should target `ase>=3.25` for the API below and re-verify against 3.29 before
release; the relevant modern surfaces (`GenericFileIOCalculator`, `ase.mep`, `ase.filters`,
`config.ini` profiles) are already present in 3.25, and the deprecated paths (`ase.neb`,
`ASE_*_COMMAND`, `FileIOCalculator.command`) are the ones most likely to disappear.

### 5.1 Calculator base classes (`ase/calculators/calculator.py`, `genericfileio.py`, `abc.py`)

* `all_properties` (calculator.py:128) = `['energy','forces','stress','stresses','dipole','charges',
  'magmom','magmoms','free_energy','energies','dielectric_tensor','born_effective_charges','polarization']`;
  `all_changes` (145) = `['positions','numbers','cell','pbc','initial_charges','initial_magmoms']`.
  Exceptions: `CalculatorSetupError`, `EnvironmentError`, `InputError`, `CalculationFailed`, `SCFError`,
  `ReadError`, `PropertyNotImplementedError`, `PropertyNotPresent`.
* `BaseCalculator(GetPropertiesMixin)` (447): `results` dict, `check_state` via `compare_atoms`,
  `get_property(name, atoms, allow_calculation)` (492) invalidates on any change and calls `calculate`.
* `Calculator(BaseCalculator)` (554): legacy `restart/label/atoms/directory/**kwargs`, `set()`,
  `directory`/`label`/`prefix` properties.
* `FileIOCalculator(Calculator)` (1055): `command` is a deprecated shim onto `self.profile.command`;
  `_initialize_profile` resolves explicit `command` -> `ASE_<NAME>_COMMAND` (deprecated, warns) ->
  `[name]` section of `~/.config/ase/config.ini` (`ase.config.Config`, `ASE_CONFIG_FILE`) ->
  `_legacy_default_command` -> `EnvironmentError`. `calculate()` = `write_input` -> `execute` -> `read_results`.
* **Recommended for Atomscope:** `ase.calculators.genericfileio.GenericFileIOCalculator(template, profile, directory, parameters)`
  with a `CalculatorTemplate(name, implemented_properties)` implementing
  `write_input(profile, directory, atoms, parameters, properties)`, `execute(directory, profile)`,
  `read_results(directory) -> Mapping`, `load_profile(cfg)` (and optionally `socketio_argv`/`socketio_parameters`),
  plus a `BaseProfile(command)` subclass with `get_calculator_command(inputfile)` and `version()`.
  This is what `abinit`, `aims`, `espresso`, `octopus`, `orca`, `onetep`, `exciting` use in 3.25
  (`names.templates`). Benefits: no mutable `set()` (parameters are immutable per calculator
  instance), clean separation of input writing (usable for a "preview deck" UI without running),
  execution (replaceable by an async job runner), and result parsing (unit-testable on stored
  protocols), and `GetOutputsMixin` gives `get_eigenvalues/get_fermi_level/get_number_of_bands/...`
  for free from the `results` mapping.
* `SinglePointCalculator(atoms, **results)` / `SinglePointDFTCalculator(..., efermi, bzkpts, ibzkpts, kpts)`
  (`singlepoint.py:16, 96`) are the right containers for **stored** results (imported protocols, DB
  rows, trajectory frames); keys must be in `all_properties`.
* Base-class survey: `Calculator` - emt, lj, morse, tip3p, tip4p, ff, eam, idealgas, mixing, qmmm,
  harmonic, turbomole, cp2k (shell-driven), vasp (`GenerateVaspInput, Calculator`);
  `GenericFileIOCalculator` - abinit, aims, espresso, octopus, orca, onetep, exciting;
  `FileIOCalculator` - gaussian, nwchem, gamess_us, mopac, dftb, siesta, gromacs, elk, demonnano,
  crystal, dftd3, acemolecule, qchem, amber, gulp, dmol.

### 5.2 Representing results

Use the `results` mapping with `all_properties` keys, all in ASE units (eV, eV/Å, eV/Å³ for stress as
a 6-vector Voigt or 3x3, e·Å for `dipole`, e for `charges`, µB for `magmom`/`magmoms`). Extra,
non-standard outputs (eigenvalues, occupations, k-points, Fermi level, `!>` iteration history,
timings, CP-PAW-specific energy decomposition) go into the same mapping under their own keys and are
served by `GetOutputsMixin` (`get_eigenvalues(kpt, spin)` expects `results['eigenvalues']` shaped
`(nspins, nkpts, nbands)`, `results['ibz_kpoints']`, `results['kpoint_weights']`, `results['fermi_level']`,
`results['occupations']`) - **not** the `{'k1s1': [...]}` dicts of `asecppaw`. Never return a string
for a failed property; raise `CalculationFailed`/`PropertyNotPresent`.

### 5.3 Trajectory (`ase/io/trajectory.py`)

`write_atoms` (396-421) writes per frame: `pbc`, `numbers` (header), `constraints` (JSON via
`todict()`, header), `masses`, `positions`, `cell`, and *only if present* `tags`, `momenta`,
`initial_magmoms`, `initial_charges`; plus the calculator `results` and `atoms.info` (JSON-encodable
values, others skipped with a warning). Verified: **custom `atoms.arrays` (e.g. `formal_charges`)
are silently dropped by `.traj`**, `atoms.info` nested dicts/lists/ndarrays survive (tuples become
lists). The `ase.io` `json` format (`ase.db` JSON backend) drops **both** custom arrays and `info`.
The lossless path is `ase.io.jsonio.encode(atoms.todict())` + `Atoms.fromdict(decode(...))`, which
preserves custom arrays, `info`, cell, pbc and constraints (verified with `FixAtoms`, `FixBondLengths`,
`Hookean`). `extxyz` also round-trips custom per-atom arrays and `info` (as `_JSON` strings) but only
`FixAtoms`/`FixCartesian` constraints and only when `columns=[..., 'move_mask']` is requested.

### 5.4 Constraints (`ase/constraints.py`)

Classes: `FixAtoms, FixBondLength, FixBondLengths, FixCartesian, FixScaled, FixInternals,
FixLinearTriatomic, Hookean, ExternalForce, MirrorForce, MirrorTorque, FixCom, FixSubsetCom,
FixedPlane, FixedLine, FixedMode, FixSymmetry, FixParametricRelations,
FixCartesianParametricRelations, FixScaledParametricRelations`, helper `dict2constraint`.
**`FixSymmetry` is importable from `ase.constraints` in 3.25**, not `ase.spacegroup.symmetrize`.
Cell filters live in `ase.filters` (`UnitCellFilter, ExpCellFilter, StrainFilter, FrechetCellFilter`).
All constraints tested implement `todict()` and are `@jsonable`, so `atoms.todict()`/`jsonio` round-trip
them; `Atoms.fromdict` uses `dict2constraint`. Note `set_constraint(FixBondLength(i,j))` is stored as a
`FixBondLengths` instance.

### 5.5 Optimisers, MD, NEB

* `ase.optimize`: `BFGS, LBFGS, LBFGSLineSearch, BFGSLineSearch, FIRE, FIRE2, MDMin, GPMin,
  QuasiNewton, GoodOldQuasiNewton, ODE12r, CellAwareBFGS`; submodules `precon` (`PreconLBFGS`,
  `PreconFIRE`), `sciopt`, `climbfixinternals`. Common signature
  `Optimizer(atoms, restart=None, logfile='-', trajectory=None, ...)`; `run(fmax, steps)`,
  `attach(fn, interval)`, and **`irun(fmax, steps)` generator** - the right hook for a UI that streams
  progress per step (yield after each step, check `converged`).
* `ase.md`: `VelocityVerlet, Langevin, Andersen, Bussi, MDLogger` at top level; `NVTBerendsen`,
  `NPTBerendsen`, `NPT`, `NoseHooverChainNVT`, `IsotropicMTKNPT` in submodules;
  `ase.md.velocitydistribution.MaxwellBoltzmannDistribution/Stationary/ZeroRotation`. `MolecularDynamics`
  also has `irun`.
* `ase.mep` (modern): `NEB, DyNEB, NEBTools, AutoNEB, interpolate, idpp_interpolate, DimerControl,
  MinModeAtoms`. `ase.neb` still imports but is a deprecated shim.

### 5.6 Other modules verified

`ase.spacegroup` (`crystal`, `Spacegroup`; `get_spacegroup` needs **spglib, not installed** here),
`ase.build` (`molecule, bulk, surface, fcc111, add_adsorbate, nanotube, graphene, make_supercell,
cut, stack, minimize_rotation_and_translation, sort, niggli_reduce, find_optimal_cell_shape`),
`ase.geometry` (`get_distances, get_angles, get_dihedrals, wrap_positions, cell_to_cellpar,
cellpar_to_cell, find_mic`, `analysis.Analysis` for bond/angle/dihedral lists),
`ase.neighborlist` (`NeighborList, natural_cutoffs, build_neighbor_list, get_connectivity_matrix` -
the built-in route to bond *perception*), `ase.data` (`chemical_symbols, atomic_numbers,
atomic_masses, covalent_radii, vdw_radii, reference_states, colors.jmol_colors/cpk_colors`),
`ase.units` (`Hartree=27.211386024367243, Bohr=0.5291772105638411, Rydberg=13.605693012183622,
Debye=0.20819433442462576, kcal/mol=0.04336410390059322, kJ/mol=0.010364269574711572,
fs=0.09822694788464063, kB=8.617330337217213e-05, GPa=0.006241509125883258`; default
`__codata_version__ = 2014`; `create_units('2018')` for other CODATA sets), `ase.db` (`connect`;
backends json/sqlite/postgresql/mysql; `row.toatoms()`, `key_value_pairs`, `data`),
`ase.visualize.view` (ase-gui, x3d, ngl, ...), `ase.visualize.plot.plot_atoms`, `ase.io.x3d` writer.

### 5.7 `ase.io` formats relevant to Avogadro parity (ASE 3.25, 99 formats registered)

Full dump: `.scratch/ase/out3.txt`. `single` = one structure per file.

| Format (ase name) | read | write | notes |
|---|---|---|---|
| `xyz` | yes | yes | plain xyz |
| `extxyz` (`.xyz`) | yes | yes | key=value header, custom per-atom columns, `info` as `_JSON` |
| `cif` | yes | yes | no mmCIF |
| `proteindatabank` (`.pdb`) | yes | yes | residue names/ids preserved as arrays (`residuenames`, `residuenumbers`, `atomtypes`, `bfactor`, `occupancy`) |
| `mol` (MDL V2000) | yes | **no** | reader ignores the bond block entirely |
| `sdf` | yes (first record only) | **no** | multi-record files return 1 molecule; bonds ignored |
| `mol2` | **no** | **no** | Open Babel / RDKit |
| `cml` | **no** | **no** | Open Babel |
| `smiles` / `inchi` | **no** | **no** | Open Babel / RDKit (also 3-D embedding) |
| `mmcif` | **no** | **no** | Open Babel / gemmi |
| `vasp` (POSCAR/CONTCAR) | yes | yes | |
| `vasp-out`, `vasp-xdatcar`, `vasp-xml` | yes | xdatcar yes | |
| `cube` | yes | yes | `ase.io.cube.read_cube_data` returns (data, atoms) |
| `gaussian-in` (`.com/.gjf`) | yes | yes | |
| `gaussian-out` (`.log`) | yes | no | |
| `orca-output` | yes | no | ORCA input via `ase.calculators.orca.OrcaTemplate.write_input`, not an ioformat |
| `gamess-us-in` | **no** | yes | |
| `gamess-us-out`, `gamess-us-punch` | yes | no | |
| `nwchem-in` (`.nwi`) | yes | yes | |
| `nwchem-out` (`.nwo`) | yes | no | |
| `molden` | **absent** | **absent** | Open Babel (read only) |
| `xsf` | yes | yes | |
| `json` | yes | yes | ase.db JSON; drops `info` and custom arrays |
| `db` | yes | yes | sqlite ase.db |
| `traj` | yes | yes | see 5.3 |
| `espresso-in` (`.pwi`) / `espresso-out` | yes / yes | yes / no | |
| `cp2k-restart`, `cp2k-dcd` | yes | no | no `cp2k-in` |
| `abinit-in` / `abinit-out` | yes / yes | yes / no | |
| `aims` | yes | yes | |
| `castep-castep`, `castep-cell`, `castep-geom`, `castep-md`, `castep-phonon` | yes | cell yes | |
| `dftb`, `gen` | yes | yes | |
| `lammps-data` / `lammps-dump-text` | yes / yes | yes / no | |
| `gromacs` (`.gro`), `gromos` (`.g96`) | yes | yes | |
| `turbomole`, `turbomole-gradient` | yes | yes / no | |
| `res` (SHELX), `magres`, `mustem`, `xtd`, `xsd`, `dlp4`, `siesta-xv`, `struct` (WIEN2k), `crystal`, `dmol-arc/car/incoor`, `eon`, `gen`, `gpumd`, `jsv`, `onetep-in`, `prismatic`, `rmc6f`, `sys`, `v-sim` | yes | yes (siesta-xv read only) | |
| `elk`, `gpaw-out`, `gpw`, `nomad-json`, `octopus-in`, `qbox`, `wout` | yes | no | |
| `exciting` | no | no | template only |
| `findsym`, `html`, `vti`, `vtu`, `x3d`, `png`, `eps`, `pov` | no | yes | export only |

Where Open Babel/RDKit are required: mol2, CML, SMILES/InChI (parsing and 3-D generation), mmCIF,
molden, **writing** MOL/SDF, multi-record SDF, and anything needing **bond orders, aromaticity,
formal charges, hydrogens** - ASE has no bond model at all (no per-bond arrays; `mol`/`sdf` readers
discard the bond block). Bond perception in pure ASE is only distance-based via
`ase.neighborlist.natural_cutoffs` + `get_connectivity_matrix`.

### 5.8 Zero-binary calculators (demo backends) - all instantiated and run in this env

| Calculator | Module | `implemented_properties` | Notes |
|---|---|---|---|
| `EMT` | `ase.calculators.emt` | energy, free_energy, energies, forces, stress, magmom, magmoms | Al, Cu, Ag, Au, Ni, Pd, Pt (+ H, C, N, O as rough); ideal for metal-slab demos |
| `LennardJones` | `ase.calculators.lj` | energy, energies, forces, free_energy, stress, stresses | parameters `epsilon, sigma, rc, ro, smooth` |
| `MorsePotential` | `ase.calculators.morse` | energy, energies, free_energy, forces, stress | |
| `TIP3P`, `TIP4P` | `ase.calculators.tip3p/tip4p` | energy, forces | rigid-water models; need `FixBondLengths`/`FixLinearTriatomic` and OHH ordering |
| `HarmonicCalculator`, `SpringCalculator`, `HarmonicForceField` | `ase.calculators.harmonic` | energy, forces | |
| `EAM` | `ase.calculators.eam` | energy, free_energy, forces, stress | needs a potential file |
| `ForceField` | `ase.calculators.ff` | energy, forces | generic bonded FF (needs explicit terms) |
| `IdealGas`, `SumCalculator/MixedCalculator/LinearCombinationCalculator` (`mixing`), `EIQMMM/SimpleQMMM` (`qmmm`) | | | composition helpers |

External Python-package calculators: `psi4` is importable in this env; `gpaw`, `tblite`, `xtb`,
`spglib` are not.

### 5.9 Input-generation-only candidates (verified without binaries)

| Code | ASE class / base | Writes input without binary? | Output readers |
|---|---|---|---|
| ORCA | `ase.calculators.orca.ORCA`, `OrcaTemplate` (GenericFileIO) | yes - `OrcaTemplate().write_input(None, dir, atoms, params, props)` produced `orca.inp` | `orca-output` |
| Quantum ESPRESSO | `Espresso`, `EspressoTemplate` (GenericFileIO) | yes, needs an `EspressoProfile(command, pseudo_dir)` object (binary need not exist) | `espresso-in/out` |
| Gaussian | `Gaussian` (FileIOCalculator) | yes - `write_input(atoms)` wrote `.com` | `gaussian-in/out` |
| NWChem | `NWChem` (FileIOCalculator) | yes - wrote `.nwi` | `nwchem-in/out` |
| GAMESS-US | `GAMESSUS` (FileIOCalculator) | same pattern (not executed) | `gamess-us-out/punch` |
| VASP | `Vasp` (`GenerateVaspInput, Calculator`) | POSCAR/INCAR/KPOINTS yes; POTCAR needs `VASP_PP_PATH` | `vasp*` |
| Abinit / Octopus / FHI-aims / exciting / ONETEP | templates (GenericFileIO) | yes with a profile object | `abinit-*`, `octopus-in`, `aims`, `onetep-in` |
| CP2K | `CP2K` (`Calculator`, drives `cp2k_shell`) | no standalone writer | `cp2k-restart` |
| GPAW | `gpaw` package | not importable here | `gpaw-out`, `gpw` |
| Siesta, DFTB+, MOPAC, Turbomole | FileIOCalculator / custom | siesta/dftb/mopac write inputs; turbomole needs `define` | `siesta-xv`, `gen`, `turbomole` |

---

## 5.8a Surface builders and adsorbates (`ase/build/surface.py`) — implemented

Wrapped in `atomscope.crystal.surfaces`: `fcc100/110/111/211`, `bcc100/110/111`, `hcp0001`,
`hcp10m10`, `diamond100/111`, plus `add_adsorbate` and `add_vacuum`. `graphene`, `mx2` and
`nanotube` are in the same module and are **not** wrapped — different parameterisation, and 2D
materials rather than adsorption surfaces.

Three traps, all found by testing:

* **The sites live in `atoms.info['adsorbate_info']`**, a plain dict, and would be lost the
  moment a structure was saved. `Structure.surface` (`model.SurfaceInfo`) is the field that keeps
  them and `ase_bridge.convert` writes **ASE's own key** back, so `ase.build.add_adsorbate` works
  unchanged on a slab that has been through a project file or a user script.
* **`add_adsorbate` caches `'top layer atom index'` into that dict** on first use
  (`positions[:, 2].argmax()`). Carrying only `cell` and `sites` would place a second adsorbate
  `height` above the *first adsorbate*, because that atom is then the highest. The index is part
  of `SurfaceInfo` for that reason, and a test adds O on fcc and O on hcp *through JSON* and
  asserts the two z are equal.
* **`Atoms.extend` merges no `info`**, so `slab += adsorbate` leaves the slab's per-atom lists
  (uids, labels, formal charges) against a longer set of atoms. `from_atoms` read them
  positionally and raised `IndexError` — reachable from the Scripts panel with one `+=`. It now
  drops per-atom data, atomic properties, bonds and residues that cannot belong to the atoms
  present, which is what `crystal._common.new_atoms` already did deliberately.

Not every element has a tabulated constant for every lattice (`bcc110('Al')` raises "Can't guess
lattice constant for bcc-Al!"); ASE's own message is passed through. A builder called without
`vacuum` leaves the third cell vector at **zero**, so the cell has no volume and the angles
against it are NaN.

`fcc211` reports no named sites at all, and `hcp10m10`/`diamond100`/`diamond111` report only
`ontop` — that is ASE's table, not an omission here.

## 5.9 Thermochemistry (`ase/thermochemistry.py`) — implemented

Four classes, of which three are wrapped in `atomscope.analysis.thermo` and one is not:

* `IdealGasThermo(vib_energies, geometry, potentialenergy, atoms, symmetrynumber, spin, natoms,
  ignore_imag_modes)` — `get_ZPE_correction()`, `get_enthalpy(T)`, `get_entropy(T, P)`,
  `get_gibbs_energy(T, P)`. **`atoms` is required for the entropy**, not merely `natoms`:
  `get_entropy` raises `RuntimeError('atoms, symmetrynumber, and spin must be specified...')`
  because it needs the moments of inertia and the mass. It sorts the given energies by `abs` and
  keeps the largest 3N-6 (nonlinear) or 3N-5 (linear); `geometry` is taken on trust.
* `HarmonicThermo(vib_energies, potentialenergy, ignore_imag_modes)` — keeps every mode given, no
  trimming, no structure: `get_internal_energy(T)`, `get_entropy(T)`, `get_helmholtz_energy(T)`.
* `HinderedThermo(vib_energies, trans_barrier_energy, rot_barrier_energy, sitedensity,
  rotationalminima, potentialenergy, mass, inertia, atoms, symmetrynumber)` — keeps 3N-3 when
  `atoms` is given, otherwise `len-3`; needs either `atoms` or both `mass` and `inertia`.
* `CrystalThermo(phonon_DOS, phonon_energies, potentialenergy, formula_units)` — **not wrapped**:
  it needs a phonon density of states, i.e. force constants over a supercell (`ase.phonons`),
  which no Atomscope backend produces.

Two traps worth recording, both found by testing against ASE's own asserted numbers:

* `_clean_vib_energies` refuses an *imaginary* energy (`np.iscomplex`) but passes a **negative
  real** one straight through, producing a plausible-looking free energy from a saddle point.
  `analysis.vibrations.frequencies_cm` reports an imaginary mode as a negative wavenumber, so
  `analysis.thermo.energies_ev` moves the sign into the imaginary part before ASE sees it.
* `ase/test/test_thermochemistry.py`'s `CH3_THERMO["gibbs"]` (8.678687641495167) is **dead
  data** — it is never asserted, and it disagrees by 1 meV with the enthalpy and entropy that
  same file does assert (10.610695269124156 - 1000*0.0019310086280219891 = 8.679686641102167).
  The identity is pinned in `tests/analysis/test_thermo.py` instead of that number.

`ase.phasediagram` (`PhaseDiagram`, `Pourbaix`) is a separate surface and is not wrapped.

## 6. Mapping Atomscope's structure model <-> `ase.Atoms`

Principle: `ase.Atoms` is the *computational* view; Atomscope's structure model is the *chemical*
view (bonds, charges, residues, selections). Conversion must be explicit and lossless in the
Atomscope -> Atoms -> Atomscope direction, and must never regenerate chemistry by heuristics when
the source already had it (the workbench regenerates bonds via `infer_bonds` after every round-trip -
that is the anti-pattern to avoid).

| Atomscope field | ase.Atoms carrier | Native? | Round-trips through | Notes |
|---|---|---|---|---|
| element (Z) | `numbers` | yes | everything | |
| position (Å) | `positions` | yes | everything | |
| cell (3x3 Å), pbc | `cell`, `pbc` | yes | everything | rank-deficient cells allowed by ASE; CP-PAW needs rank 3 or `!ISOLATE` |
| per-atom label / name (e.g. CP-PAW `O_1`) | `arrays['labels']` (`new_array`, dtype `<U16`) | custom array | `todict`/jsonio, extxyz; **not** `.traj` | also mirror in `info['cppaw']['atom_names']` for the calculator |
| formal charge (int per atom) | `arrays['formal_charges']` (int) | custom array | `todict`/jsonio, extxyz | do **not** use `initial_charges` (float, means "starting partial charge" to calculators) |
| partial charge (float, computed) | `calc.results['charges']` / `SinglePointCalculator(charges=...)` | native result | `.traj` (results) | Q[E] from CP-PAW |
| total charge (int) | `info['charge']` | info scalar | `.traj`, jsonio, extxyz | CP-PAW `CHARGE[E]`; **never smear over `initial_charges`** |
| spin multiplicity / total spin | `info['multiplicity']` (2S+1) or `info['spin']` (S) | info scalar | same | CP-PAW `SPIN[HBAR]`=S; `NSPIN=2` |
| per-atom initial moments | `initial_magmoms` | yes | everything | µB; `!STRUCTURE!ATOM` only has `NAME, R, M, SP` (schema), so per-atom moments cannot be passed to CP-PAW - only the total `SPIN[HBAR]` (and `!STRUCTURE!STATE` overrides). Keep them for other backends. |
| bonds (i, j, order, aromatic flag) | `info['bonds']` as `ndarray (nbonds, 3)` int or list of `[i, j, order*2]` | info | `.traj`, jsonio, extxyz (`_JSON`) | no per-bond array facility in ASE; keep indices 0-based and re-index on atom deletion |
| residues / chains | `arrays['residuenames']`, `arrays['residuenumbers']`, `arrays['chainids']` | custom arrays (PDB reader already uses `residuenames`/`residuenumbers`/`atomtypes`/`bfactor`/`occupancy`) | `todict`/jsonio, extxyz, pdb | reuse the PDB reader's names for interoperability |
| selections / groups | `info['selections'] = {name: [indices]}` | info | `.traj`, jsonio | or `tags` for a single active group |
| constraints (fixed atoms, fixed distances) | `atoms.constraints` (`FixAtoms`, `FixBondLengths`, ...) | yes | `.traj`, jsonio; extxyz only FixAtoms/FixCartesian | CP-PAW `!STRUCTURE!CONSTRAINTS` has `!FREEZE ATOM=`/`GROUP=`, `!BOND`, `!ANGLE`, `!TORSION`, `!RIGID`, `!TRANSLATION`, `!ROTATION`, `!COGSEP`, `!MIDPLANE`, `!LINEAR` (schema `data/db/STRUCTURE.json`) - `FixAtoms` -> `!FREEZE`, `FixBondLengths` -> `!BOND`, `FixInternals` angles/dihedrals -> `!ANGLE`/`!TORSION`, `FixCom` -> `!TRANSLATION`; others must raise |
| velocities | `momenta` | yes | everything | |
| masses (isotopes) | `masses` | yes | everything | CP-PAW `!ATOM M=` / `!SPECIES M=` |
| provenance (source file, format, timestamps) | `info['provenance']` dict | info | `.traj`, jsonio | |
| calculator settings (CP-PAW deck) | `info['cppaw']` dict (strc/cntl text or parameter dict) | info | `.traj`, jsonio | keep the *generated* deck text for reproducibility |

Serialisation rule: persist Atomscope structures with **`ase.io.jsonio.encode(atoms.todict())`**
(plus results via `SinglePointCalculator` where relevant); use `.traj` only for optimisation/MD
frames (positions, cell, results) and treat everything not in the `.traj` whitelist as belonging to
the parent structure record; use `extxyz` for interchange with columns explicitly listed. Any
`arrays[...]` key must have first dimension `len(atoms)`; when atoms are added/removed, Atomscope
(not ASE) must re-index `info['bonds']` and `info['selections']`.

Import path for chemistry-rich formats: Open Babel (`OBMol`) or RDKit -> Atomscope model (bonds,
formal charges, total charge, multiplicity, residues) -> `Atoms` via the table above. Never go
file -> `ase.io.read` -> heuristic bonds when the file had bonds.

---

## 7. Design recommendations for the modern CP-PAW ASE calculator

### 7.1 Architecture

* `CPPAWTemplate(CalculatorTemplate)` + `CPPAWProfile(BaseProfile)` + `CPPAW(GenericFileIOCalculator)`.
  `implemented_properties = ['energy', 'free_energy', 'forces', 'charges', 'magmom', 'dipole']`
  (only what CP-PAW actually prints; add `stress` only when a CP-PAW stress output is confirmed).
  Extra outputs (`eigenvalues`, `occupations`, `ibz_kpoints`, `fermi_level`, `homo`, `lumo`, `gap`,
  `iterations` DataFrame-like arrays, `energy_terms`, `timings`, `version_hash`) go into `results` too.
* Profile: `command` from `~/.config/ase/config.ini` `[cppaw]` section (`command = paw_fast.x`,
  optional `parallel_command = mpirun -np {np} ppaw_fast.x`, `pawdir = ...`) with Atomscope settings
  as the override. No `ASE_*_COMMAND`, no `PATH` assumptions, no personal or cluster defaults in code.
  `version()` parses the `CPPAW VERSION INFO` banner (`hash=`, `committed on=`) from a dry run or from
  the last protocol.
* Execution: `subprocess.run([command, 'case.cntl'], cwd=directory, stdout=open('out'), ...)` -
  argv lists only, no `shell=True`, no background `&`, no `sed -i`. For the interactive UI wrap the
  same template in an async job runner that streams the protocol; the ASE calculator stays
  synchronous (`execute` blocks) so ASE optimisers/NEB work unchanged.
* Multi-stage runs are an explicit `stages: list[Stage(cntl_params, strc_override=None, restart=bool)]`
  parameter (start -> relax -> force); the template writes `case.cntl` per stage and runs them
  sequentially, keeping each stage's protocol in its own file (`case.stage1.prot`) instead of
  appending to one `case.prot`.

### 7.2 Inputs

* `!STRUCTURE` generated from Atoms with the schema-validated object model (port of
  `input_files.readbranch/objecttoinput`), **including `!OCCUPATIONS CHARGE[E]=info['charge']`,
  `SPIN[HBAR]=S`, `NSPIN`** and `EMPTY` from parameters. Refuse (raise `InputError`) rather than
  silently ignore: unknown species, rank-deficient cell with any pbc=True, constraints that have no
  CP-PAW representation, `initial_charges` that do not sum to `info['charge']`.
* Constraints: render `FixAtoms` as `!CONSTRAINTS !FREEZE ATOM='O_1' !END`, `FixBondLengths` as
  `!BOND`, `FixInternals` angle/dihedral terms as `!ANGLE`/`!TORSION`, `FixCom` as `!TRANSLATION`
  (schema: `!STRUCTURE!CONSTRAINTS` in `data/db/STRUCTURE.json`); raise for `Hookean`, `FixedPlane`,
  `FixSymmetry`, cell filters. Note CP-PAW enforces constraints with RATTLE/SHAKE during `!RDYN`, so
  forces reported for frozen atoms are constrained forces - document this for optimiser users.
* pbc: all-False -> `!ISOLATE` + a box with configurable vacuum (default 7 Å, applied for real, unlike
  the dead `atoms.center` call); all-True -> `!KPOINTS` with a user-visible density (`R=` or `DIV=`);
  mixed -> vacuum along non-periodic axes and a warning that CP-PAW is 3-D periodic.
* Species: table `symbol -> !SPECIES` block, seeded from `specieslist_final.strc`/`specieslist_e0k.strc`
  but re-generated from the current CP-PAW distribution; expose the chosen setup (ID, ZV, NPRO,
  RCL/RCOV) in the UI.
* `!CONTROL` from a small typed parameter set (`nstep`, `dt`, `epwpsi`, `cdual`, `dft_type`,
  `psidyn` friction/auto, `rdyn` on/off + friction, `start`, `nwrite`, `stop`) merged into named
  presets (start / relax-electrons / relax-atoms / single-point-forces / MD / hybrid) and rendered
  through the schema so that every keyword is validated and documented (`data/db/CONTROL.json` help).
* Always keep the rendered deck text in `results['input_files']` and `info['cppaw']` for reproducibility.

### 7.3 Outputs and parsing (audit traps)

* Parse **only the last program run**: split the protocol on `PROGRAM STARTED`, then take the last
  `ENERGY REPORT`/`ATOMLIST REPORT` inside it. Better: write one protocol per stage.
* Regex-anchored parsers for: `^TOTAL ENERGY\s*:\s*(-?\d+\.\d+) H`, `^T[123]\[ANGSTROM\]=`,
  `^(\S+)\s+\(\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\)\s+([\d.]+)\s+([\d.*]+)\s+([-\d.*]+)(?:\s+\(\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\))?$`
  for ATOMLIST rows (handle `********` overflow explicitly), `^!>\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)`
  for iterations, `EIGENVALUES \[EV\] FOR K-POINT\s+(\d+) AND SPIN\s+(\d+)`, `HOMO-ENERGY`, `LUMO-ENERGY`,
  `SMALLEST DIRECT GAP`, `PROGRAM FINISHED`, `STOP SIGNAL RECEIVED`, `ERROR`, `STOP IN`.
* **Forces: fail loudly when absent.** If `properties` includes `forces` and the ATOMLIST rows carry
  no force triple, raise `CalculationFailed("CP-PAW printed no forces; atom dynamics (!RDYN) was not
  active")`. Never fill zeros (asecppaw `prot.py:485`), never let an optimiser "converge" on them
  (PARSE-1). Treat `converged`/`STOP SIGNAL RECEIVED` as informational, not as success.
* Force precision: protocol forces have 0.01 mH/Bohr resolution (~5e-4 eV/Å). Either read a
  higher-precision source (`case_r.tra`/`.strc_out`/a CP-PAW print option) or document a minimum
  `fmax` of ~1e-2 eV/Å and expose it in the UI.
* Establish and unit-test the "single point with forces" recipe (`!GENERIC NSTEP=1 START=F`,
  `!RDYN STOP=T FRIC=0.0` or the CP-PAW-recommended equivalent) with a check that reported positions
  equal the input positions to 1e-5 Å; if CP-PAW moves atoms in that mode, the calculator must use
  the *reported* positions/forces pair and warn.
* Units: energy `Hartree -> eV` via `ase.units.Hartree`; forces `mH/aBohr -> eV/Å` via
  `ase.units.Hartree / (1000 * ase.units.Bohr)` only when the header says `MH/ABOHR` (raise if the
  header is unknown); positions/cell in Å directly (`LUNIT` = 1 Å expressed in Bohr: write
  `1/ase.units.Bohr` = `1.8897261258369282`, not the `1.889726124`/`1.8897261` literals found in
  `default1.strc`, `case.strc` and the workbench). `magmom` in µB = `2*S` (positive), not `S*g_e`.
* Charges: `Q[E]` per atom -> `results['charges']`; `dipole` only if CP-PAW prints one - otherwise
  do not fabricate a point-charge dipole (asecppaw B7).
* Restart: `case.rstrt` handled through a `restart: bool | Path` parameter that renders `START=F`
  (and `NEWSTRC=T` when the structure changed) in the generated CNTL - no string surgery on files.
* Errors: non-zero exit, `ERROR`/`STOP IN` lines, missing `PROGRAM FINISHED`, or missing required
  blocks -> `CalculationFailed` with the protocol tail attached; never return `'ERROR IN CALCULATION'`.
* Testing: fixture protocols from `~/ase-cp-paw/calculations/{h2o,ch3cli}` (no-force and
  with-force cases) plus a fake `paw_fast.x` script (as in the workbench `test_ase.py`) for end-to-end
  calculator tests without CP-PAW; a real-binary smoke test gated on `[cppaw]` being configured.

### 7.4 What to port first (concrete)

1. `data/db/*.json` schema + `manual_converter.py` (regenerate from the current manual).
2. `input_files.py:1300-1500` parser/serialiser algorithm (rewrite with a tokenizer; keep the
   `_x` deactivation semantics and 79-col wrapping), `formatFloat`, fixed `fortran_float`.
3. `strcInputFile` (Atoms <-> `!STRUCTURE`) with the fixes in 7.2, species tables from
   `specieslist_*.strc`.
4. Protocol parser rebuilt from `prot.py:181-570` layout knowledge + workbench
   `ProtocolReport.finalize(require_forces=True)`.
5. CNTL presets from `data/defaults/*.cntl` as typed parameter sets.
6. `readDir` conventions for importing legacy calculation folders; `readDos*/readSprot/readDprot` for
   analysis panels; `makeDcntl/makeWcntl` for DOS/density post-processing.
