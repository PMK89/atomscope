# Atomscope

**An open molecular modelling, computational-chemistry and visualization
environment.** Build a molecule or a crystal, look at it properly, set up a
DFT or force-field calculation through a form the backend itself describes, run
it locally, and analyse the result — in one place, with everything stored in a
project directory you own.

Atomscope takes [Avogadro 1.2](https://avogadro.cc/) as its functional
reference and extends it in two directions: deep integration of
[CP-PAW](https://github.com/cp-paw/cp-paw) as the flagship DFT backend, and the
[Atomic Simulation Environment](https://wiki.fysik.dtu.dk/ase/) as the common
language for structures, calculators and file formats. A modern stack —
TypeScript/React/Three.js in the browser, Python/FastAPI on the machine — with
a plugin architecture so that adding a code means writing one class, not
patching the application.

![Atomscope showing the HOMO of water computed with CP-PAW](docs/images/atomscope-overview.png)

---

## What works today

This is an honest list. Everything below was exercised against a running
instance; the [user guide](docs/user-guide.md) says how, and
[§11 of it](docs/user-guide.md#11-limits-and-known-problems) lists the rough
edges.

### Building and editing

* Seven interactive tools — navigate, select, draw, manipulate, bond-centric,
  measure, auto-rotate — with keyboard shortcuts, live drag preview and
  200-step undo/redo where every gesture is one labelled step.
* Draw with automatic hydrogen adjustment, a periodic table of Z = 1…118, bond
  order cycling, fragment selection, rubber-band and by-element selection.
* Measurements: distance, angle, dihedral, drawn as an overlay and shown in the
  status bar.
* 3-D structures from **SMILES** (RDKit ETKDGv3 + MMFF cleanup, reproducible).
* A Cartesian coordinate editor, and a properties panel where element,
  position, formal charge, label, total charge and multiplicity are editable.
* Crystal building: a library of **507 CIF entries**, unit-cell creation,
  supercells, (h k l) slabs with vacuum.
* Backend builders for **382 fragments**, peptides (α-helix, β-sheet, 3₁₀, π,
  custom φ/ψ), DNA/RNA in A/B/Z form, carbon nanotubes and graphene sheets —
  working over the API, not yet in the menus.

### Crystallography

spglib-backed symmetry perception (space group, Hall symbol, point group,
Wyckoff positions, asymmetric unit), symmetrization, primitive and standardized
cells, Niggli reduction, cell filling from a space group, wrapping, standard
orientation, volume scaling, fractional-coordinate editing.

### Visualization

* Ball-and-stick, stick, van der Waals and wireframe representations;
  perspective and orthographic cameras; principal-axis "fit to structure".
* Instanced rendering, ray-cast picking, hover and selection tinting.
* Unit cell with display repeats, an axis gizmo, force vectors, hydrogen
  hiding.
* **Isosurfaces** from any volumetric grid — marching cubes in a Web Worker,
  ± lobes for signed fields, adjustable isovalue, colour, opacity and
  resolution, with a backend-suggested starting isovalue.
* **Trajectory playback** with play/step/loop/ping-pong, an energy sparkline,
  and per-frame energy, time and temperature.

### Calculations

Schema-driven forms: each backend publishes its parameters as data — types,
units, ranges, help, manual references and visibility conditions — and one
renderer draws them all. Presets, validation with errors and warnings, a
byte-exact preview of the generated input, live job streaming, cooperative
cancellation, and forking (including "continue from restart file") so that a
finished run is immutable and its successor is a new record.

| Backend | Executes | What it does |
|---|---|---|
| **CP-PAW** | ✔ | plane-wave/PAW DFT: single point, forces, damped relaxation, Car-Parrinello MD, electron and spin densities, orbital cubes, DOS/PDOS, band structures; six presets from the CP-PAW hands-on course (MPI is implemented in the plugin but not yet selectable in the UI) |
| **ASE workflows** | ✔ | EMT, Lennard-Jones, Morse, an Open Babel force field, or CP-PAW forces, driven by ASE's BFGS optimizer or Langevin thermostat |
| **Open Babel force fields** | ✔ | MMFF94, MMFF94s, UFF, GAFF, Ghemical: energies with per-term breakdown, steepest-descent and conjugate-gradient optimization, systematic/random/weighted conformer search, constraints |
| **Quantum chemistry input generators** | — | ready-to-run decks for ORCA, Gaussian, NWChem, GAMESS-US, Quantum ESPRESSO and ABINIT |

Backend plugins load from Python entry points, so a third-party code is a
separate package.

### Analysis

Convergence charts, forces as per-atom vectors, an orbital browser with
HOMO/LUMO labels and **on-demand cube export**, projected density of states,
band structures along ASE's high-symmetry paths, energy-term breakdowns, and
CP-PAW's projected atomic charges.

### File formats

XYZ, extended XYZ, CIF, PDB, VASP POSCAR/CONTCAR, XSF, ASE JSON, Turbomole,
Gaussian cube, SMILES, MOL, SDF, MOL2 and CML for structures; Gaussian, ORCA,
NWChem, Quantum ESPRESSO and GAMESS-US output logs (with energies, forces,
dipoles, charges and optimization trajectories); any multi-frame format ASE can
read for trajectories. ASE handles the crystallographic formats, RDKit the ones
where bond orders matter, Open Babel the long tail.

### Projects

A project is a directory: a manifest, structure documents, and one directory per
calculation holding its inputs, its untouched working directory and its parsed
results. Deterministic JSON with sorted keys, binary sidecars for grids,
relative references. Zip it, move it, put it in git, reopen it in a year and
fork any run in it.

---

## Quick start

Requirements: Python 3.12, [`uv`](https://docs.astral.sh/uv/), `pnpm` (v10),
Node 22, and a WebGL2 browser. CP-PAW is optional — everything except the DFT
backend works without it.

```bash
git clone <repository> atomscope
cd atomscope
source env.sh                 # keeps every cache inside the checkout
./scripts/bootstrap.sh        # uv sync + pnpm install + optional Playwright Chromium
```

Then, in two terminals:

```bash
make dev-backend              # FastAPI on 127.0.0.1:8765
make dev-frontend             # Vite on  127.0.0.1:5173
```

and open <http://127.0.0.1:5173>.

```console
$ curl -s http://127.0.0.1:8765/api/health
{"status":"ok","version":"0.1.0","ase_version":"3.26.0"}
```

Five minutes from there to a converged DFT calculation:
**[Tutorial 1 — Water with CP-PAW](docs/tutorials/01-water-cppaw.md)**.
No CP-PAW? Start with
**[Tutorial 3 — Force fields and conformers](docs/tutorials/03-force-field-and-conformers.md)**,
which needs nothing beyond the install above. Working through the CP-PAW
hands-on course? **[Tutorial 4](docs/tutorials/04-hands-on-course.md)** walks all
of it, chapter by chapter.

---

## Documentation

| Document | For |
|---|---|
| [User guide](docs/user-guide.md) | installation, the window, projects, editing, formats, visualization, calculations, analysis, shortcuts |
| [Tutorial 1 — Water with CP-PAW](docs/tutorials/01-water-cppaw.md) | the CP-PAW course's water example, end to end: CNTL/STRC, protocol, energy, density, orbitals |
| [Tutorial 2 — Silicon](docs/tutorials/02-silicon-crystal.md) | a periodic workflow: symmetry, supercell, (111) slab, k-points, DOS, band structure |
| [Tutorial 3 — Force fields and conformers](docs/tutorials/03-force-field-and-conformers.md) | SMILES → hydrogens → MMFF94 → conformer search → export, on any machine |
| [Tutorial 4 — The CP-PAW hands-on course](docs/tutorials/04-hands-on-course.md) | the whole course, chapter by chapter, inside Atomscope — and what it cannot do yet |
| [Developer guide](docs/developer-guide.md) | layout, toolchain, typed contracts, adding a backend/format/layer/tool, testing, review workflow |
| [Architecture](docs/architecture/README.md) | one page per subsystem, with the reasoning |
| [Decisions](docs/decisions/README.md) | ADRs |
| [CP-PAW analysis](docs/cppaw-analysis.md) | the complete CP-PAW input schema, tool chain, output formats and traps |
| [ASE analysis](docs/ase-analysis.md) | what ASE offers and how Atomscope uses it |
| [Avogadro 1 parity matrix](docs/avogadro1-feature-parity.md) | 312 features of Avogadro 1.2 with evidence, expected behaviour and status |
| [Roadmap](ROADMAP.md) · [State](docs/STATE.md) | phases and where work stands |

---

## Status and limitations

Atomscope is **young and under active development** (version 0.1.0). It is
usable for real work today — the tutorials are real calculations with real
numbers — but it is not a finished product.

Known limitations, in rough order of how often you will meet them:

* **No authentication.** The backend binds to 127.0.0.1 and refuses any other
  host, but anything on the machine can drive it. A per-launch token is
  planned. Do not expose the port.
* **One project and one running job at a time** per backend process.
* **No desktop shell yet** — it runs in a browser against a local server.
* **The band-structure chart does not draw its curves.** `paw_bands.x` runs and
  the data is correct and available over the API; the plot is empty. DOS,
  convergence and orbital charts are fine.
* **DOS and band results are not restored when a project is reopened**; the
  compute button has to be pressed again.
* **Cancelling a CP-PAW run reports back after ~90 s**, even though the stop
  itself is immediate and clean.
* **`Save current structure` has no "save as"**: it writes under the current
  structure's id, so saving after a crystal operation overwrites the original.
* **Runs are serial from the UI.** The CP-PAW plugin builds an MPI command
  line when more than one core is requested, but the calculation form always
  requests one.
* **No UI yet** for the fragment/peptide/DNA/nanotube builders or the
  `/api/chem/*` helpers (they work over the API), nor for atom labels, colour
  schemes, ribbons/cartoons, vibrations, spectra or Z-matrix editing.
* **The parity matrix lags the code.** Many implemented features are still
  marked `NOT STARTED` there; read it as the target list, not as a status
  report.

What is deliberately solid: the data model and its units, the project format,
the plugin contract, the job manager's process handling, and the CP-PAW
adapter's handling of the traps documented in `docs/cppaw-analysis.md` (forces
that are only printed under `!RDYN`, `START=F` ignoring the structure file,
append-mode protocols, the completion marker, the `libgfortran` incompatibility
of prebuilt binaries). Those are the parts with golden fixtures and tests
behind them.

---

## Contributing

Read the [developer guide](docs/developer-guide.md) first. In short: everything
installs inside the checkout (`source env.sh`), `mypy --strict` and ESLint pass,
a bug becomes a regression test, anything copied in gets a row in
`docs/provenance.md`, and non-obvious decisions get an ADR.

```bash
make lint typecheck test      # what CI runs, plus the CP-PAW-marked tests
```

---

## License

**GPL-3.0-or-later.** See [`LICENSE`](LICENSE) and
[ADR 0001](docs/decisions/0001-license.md) for the reasoning.

Redistributed third-party material — the CP-PAW example deck and manual-derived
schema (GPL-3.0), Avogadro 1's crystal and fragment libraries
(GPL-2.0-or-later), ASE's element data tables (LGPL-2.1+) — is listed in
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md), with a file-level record
in [`docs/provenance.md`](docs/provenance.md).

CP-PAW is © Peter E. Blöchl and contributors, distributed under the GNU General
Public License; Atomscope drives it as an external program and does not
redistribute it.
