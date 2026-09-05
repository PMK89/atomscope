# Atomscope user guide

Atomscope is a molecular modelling, computational-chemistry and visualization
environment. You build or import a structure, look at it, set up a calculation
through a form the backend itself describes, run it locally, and analyse the
result — all inside a project directory you own.

This guide describes the application **as it behaves today**. Everything in it
was checked against a running instance (backend `0.1.0`, ASE 3.26.0, CP-PAW
`aa467ef873`). Where a feature exists only in the HTTP API and has no user
interface yet, that is stated explicitly.

Contents:

1. [Installation and first start](#1-installation-and-first-start)
2. [The application window](#2-the-application-window)
3. [Projects](#3-projects)
4. [Building and editing structures](#4-building-and-editing-structures)
5. [Importing and exporting files](#5-importing-and-exporting-files)
6. [Visualization](#6-visualization)
7. [Calculations](#7-calculations)
8. [Analysis](#8-analysis)
9. [Keyboard shortcuts](#9-keyboard-shortcuts)
10. [Limits and known problems](#10-limits-and-known-problems)

---

## 1. Installation and first start

### 1.1 What you need

| Requirement | Notes |
|---|---|
| Python 3.12 (`>=3.12,<3.13`) | the backend pins this range |
| [`uv`](https://docs.astral.sh/uv/) | creates and manages the backend virtual environment |
| `pnpm` (v10) and Node 22 | frontend build and dev server |
| A WebGL2 browser | the frontend is a normal web page; there is no desktop shell yet |
| **CP-PAW** (optional) | only needed for the DFT backend; everything else works without it |

Every Python and JavaScript dependency is installed from wheels/npm — nothing
is compiled by hand. Open Babel comes in through `openbabel-wheel`, RDKit
through the `rdkit` wheel, so no conda environment is required.

### 1.2 Bootstrap

```bash
git clone <repository> atomscope
cd atomscope
source env.sh          # keeps every cache inside the checkout
./scripts/bootstrap.sh
```

`env.sh` sets `UV_CACHE_DIR`, `UV_PROJECT_ENVIRONMENT`, `npm_config_cache`,
`PLAYWRIGHT_BROWSERS_PATH` and `ATOMSCOPE_DATA_DIR` to directories inside the
checkout. That is a deliberate rule of this project: **nothing installs
globally**. `scripts/bootstrap.sh` runs `uv sync --extra dev` for the backend,
`pnpm install --frozen-lockfile` for the frontend, downloads a project-local
Playwright Chromium (optional; failure is tolerated) and finally reports
whether CP-PAW was found.

`make setup` does the first two steps only.

### 1.3 Starting the application

Two processes, in two terminals:

```bash
make dev-backend     # FastAPI on http://127.0.0.1:8765
make dev-frontend    # Vite dev server on http://127.0.0.1:5173
```

Then open <http://127.0.0.1:5173>. The Vite dev server proxies `/api` (HTTP and
WebSocket) to the backend, so the browser only ever talks to one origin.

Both bind to the loopback interface only. The backend's own launcher refuses
any other host (`python -m atomscope.api.server --host` accepts only
`127.0.0.1` and `localhost`), and there is **no authentication** — do not
expose the port.

To run a second instance next to a first one, override the port and tell Vite
where the backend is:

```bash
cd backend && PYTHONPATH=$PWD/src python -m atomscope.api.server --port 8770
cd frontend && ATOMSCOPE_API_URL=http://127.0.0.1:8770 pnpm dev --port 5178
```

Check that the backend is alive:

```console
$ curl -s http://127.0.0.1:8765/api/health
{"status":"ok","version":"0.1.0","ase_version":"3.26.0"}
```

### 1.4 What needs CP-PAW and what does not

`GET /api/backends` reports, per backend, whether its executables were found.
On a machine without CP-PAW the `cppaw` entry simply says it is unavailable and
the Calculation panel greys it out — nothing else changes.

| Works with no external program | Needs CP-PAW |
|---|---|
| Building, editing, measuring, all display options | DFT total energies, forces, relaxation, MD |
| SMILES, all file import/export, the crystal and fragment libraries | Electron-density and orbital cubes |
| Crystallography (spglib): symmetry, supercells, slabs, Niggli, primitive | Density of states / projected DOS |
| Open Babel force fields (MMFF94, MMFF94s, UFF, GAFF, Ghemical): energy, optimization, conformer search | Band structures |
| ASE built-in calculators (EMT, Lennard-Jones, Morse) with BFGS and Langevin MD | |
| Quantum-chemistry **input generation** (ORCA, Gaussian, NWChem, GAMESS-US, Quantum ESPRESSO, ABINIT) | |

CP-PAW is located by looking, in order, at `$ATOMSCOPE_CPPAW_DIR/bin/fast`,
`$PAWDIR/bin/fast`, `~/cp-paw/bin/fast` and then `PATH`. Set
`ATOMSCOPE_CPPAW_DIR` if your installation is elsewhere. The plugin also
probes the runtime once and, if the binaries fail because the system
`libgfortran` is newer than the one they were built against, transparently
retries with a compatible `libgfortran` found under `~/miniconda3/pkgs`
(override with `ATOMSCOPE_CPPAW_LIBRARY_PATH`).

---

## 2. The application window

![Atomscope with the water HOMO displayed](images/atomscope-overview.png)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Atomscope  File Edit Select Build Extensions View Help          menu bar  │
├──────────────┬──┬─────────────────────────────────┬───────────────────────┤
│              │T │                                 │  Calculation          │
│  Project     │o │                                 │  Analysis             │
│  panel       │o │        Viewport                 │  Surfaces             │
│              │l │        (WebGL + overlay)        │  Crystal              │
│  structures  │b │                                 │  Properties           │
│  calculations│a │   ┌ tool settings ┐ (floating)   │                       │
│              │r │                                 │      right dock       │
│              │  ├─────────────────────────────────┤                       │
│              │  │ trajectory player (when loaded) │                       │
│              │  ├─────────────────────────────────┤                       │
│              │  │ job console                     │                       │
├──────────────┴──┴─────────────────────────────────┴───────────────────────┤
│ name │ formula │ atoms, bonds │ selected │ tool │ measurement │ hover      │
└───────────────────────────────────────────────────────────────────────────┘
```

**Menu bar** — `File`, `Edit`, `Select`, `Build`, `Extensions`, `Settings`, `View`,
`Help`.
`Settings ▸ Preferences…` holds the settings that are about the program rather
than the structure: rendering `Quality` (low / automatic by size / high
tessellation), `Depth cueing` (distant atoms fade into the background),
projection, background, and the list of calculation backends with what each one
found on this machine. They are stored **with the open project**, not globally,
and a backend is enabled by installing it, not from the dialog.
`Edit` holds undo/redo, cut/copy/paste/clear and the Cartesian editor; `Select`
holds the selection commands (all, none, invert, by element, by residue, solvent,
by SMARTS); `Help`
names the guides, the tutorials and the shortcuts. See the
[shortcut table](#9-keyboard-shortcuts) for the accelerators.

**Project panel** (left) — open/create a project, and the lists
`Structures (n)` and `Calculations (n)`. Clicking a structure loads it into
the viewport; clicking a calculation selects it, which is what drives the
Calculation, Analysis and Surfaces panels and the job console.

**Tool bar** (vertical strip) — the seven editor tools; each button shows an
icon and its shortcut letter.

**Viewport** — the Three.js scene. An SVG overlay on top of it draws
tool feedback (rubber band, measurement markers and labels, bond labels);
nothing tool-related is drawn inside the 3-D scene.

**Tool settings** — a floating panel over the viewport showing the options of
the active tool.

**Right dock** — seven tabs, all kept mounted so form state survives switching:

| Tab | Purpose |
|---|---|
| `Calculation` | choose a backend, fill in the parameter form, preview the generated input, run, read results |
| `Analysis` | convergence charts, orbital browser, DOS, band structure |
| `Spectra` | vibrational, NMR, UV-Vis and CD spectra, with mode animation |
| `Surfaces` | volumetric grids and the isosurfaces made from them |
| `Display` | every display layer and its settings (see [§6](#6-visualization)) |
| `Crystal` | unit cell, symmetry, cell operations, space groups |
| `Properties` | structure, selected-atom and bond properties, editable |

**Trajectory player** — appears between the viewport and the job console only
when a trajectory is loaded.

**Job console** — the streamed output of the selected calculation's job and of
its post-processing jobs, each line prefixed with its stream name. For CP-PAW
this is the driver log plus a live tail of `case.prot`.

**Status bar** — structure name, formula, atom/bond counts, selection size,
active tool, the measurement readout (Measure tool only), the hovered atom with
its coordinates, and error messages (which clear themselves after 8 s).

---

## 3. Projects

A project is a plain directory. Everything needed to reopen and continue work
is inside it; nothing lives in browser storage.

```
<project>/
  project.json                        manifest: id, name, format_version, timestamps,
                                      structure/calculation/dataset ids, notes, view settings
  structures/<id>.json                structure documents
  datasets/<id>.json + <id>.f32       imported volumetric grids (metadata + binary sidecar)
  presets/                            created, currently unused
  calculations/<calc-id>/
    calculation.json                  backend id, full parameter values, status, job record
    input/                            structure.json, values.json and the generated input files
    work/                             the working directory of the run: raw program output,
                                      job.json, driver.log/driver.err (CP-PAW), case.prot, ...
    results/                          results.json (the parsed ResultBundle)
                                      + <grid-id>.f32 sidecars for cubes
```

JSON is written with sorted keys and two-space indentation, so a project
directory diffs and version-controls cleanly. Binary sidecars are
little-endian float32 in C order. Grid references are relative to the project
root, so a project can be zipped and moved.

**Opening and creating.** In the Project panel, type an absolute directory path
on the machine running the backend and press `Open` or `Create`. `Create`
requires the directory to be missing or empty and names the project after the
last path segment. `Close` detaches it.

**Only one project is open at a time**, per backend process. The panel offers
`Open`/`Create` only when none is open, so close the current one first;
`Close` also clears the calculation list and drops loaded grids.

**What is persisted.** Structures (explicitly, with `Save current structure`),
calculations with their full merged parameter values and job record, parsed
results, volumetric grids, and the view settings (representation, projection,
hydrogen visibility, background, layer toggles), which are saved back to
`project.json` about half a second after you change them.

**What is not persisted.** The undo history; trajectories imported through
`File ▸ Import trajectory…` (calculation trajectories *are* stored, inside
`results.json`); the current selection and camera.

> `Save current structure` writes under the id of the document currently in
> the viewport. Crystal operations (supercell, slab, primitive cell, …) keep
> that id, so saving after such an edit **overwrites** the entry you started
> from rather than adding a new one. To keep both, save the derived structure
> and then re-insert the original from the crystal library (a library insert
> gets a fresh id), or export the intermediate to a file.

---

## 4. Building and editing structures

The tool bar holds eight tools. Only `Navigate` and `Auto-rotate` let the mouse
drive the camera; in every other tool a drag belongs to the tool. The mouse
wheel always zooms, and the browser context menu is suppressed over the canvas.

| Tool | Key | What the mouse does |
|---|---|---|
| **Navigate** | `N` | left-drag orbits about the pivot; right-drag, middle-drag and `Shift`+left-drag pan; wheel zooms; double-click an atom to make it the pivot, double-click empty space to fit the view |
| **Select** | `S` | click an atom to select it, click a bond to select both its atoms, click empty space to clear; drag a rubber band; `Shift` adds, `Ctrl`/`Cmd` toggles; double-click selects the whole connected fragment; right-click over nothing clears |
| **Draw** | `D` | click empty space adds an atom of the current element; click an existing atom changes its element; click a bond cycles its order 1→2→3→1; drag from an atom grows a new bonded atom, or bonds to the atom you release over; right-click deletes an atom (with its hydrogens) or a bond; keys `1`/`2`/`3` set the order for new bonds |
| **Manipulate** | `M` | left-drag moves the selection (or the atom under the cursor) in the view plane; `Shift`+left-drag moves along the view axis; right-drag rotates about the centroid |
| **Bond-centric** | `B` | click a bond to select it; left-drag changes its length (the smaller fragment moves, minimum 0.3 Å); right-drag rotates that fragment about the bond axis |
| **Measure** | `R` | click up to four atoms — two give a distance, three an angle, four a dihedral; click a marked atom to unmark it; right-click resets |
| **Auto-optimize** | `O` | runs the force field continuously; left-drag an atom and it is pinned where you hold it while the rest of the molecule relaxes around it |
| **Auto-rotate** | `A` | spins the view at the configured x/y/z speeds; any click in the viewport stops it |

Every drag is a single undo step: the tool previews the change live and commits
once on pointer-up, with a descriptive label that the `Edit` menu shows
(`Undo Add C`, `Redo Rotate 3 atoms`, …). The undo stack holds 200 entries.
Loading a document — `File ▸ New`, `File ▸ Open…`, clicking a structure in the
project panel, importing a trajectory, `Load final structure` — **clears the
undo history**.

### 4.1 Tool settings

* **Draw** — an element field (type a symbol, or press `…` for a periodic
  table of Z = 1…118), a bond-order selector (`Single`/`Double`/`Triple`), and
  an `Adjust hydrogens` checkbox (on by default) that keeps hydrogen counts
  consistent after every edit.
* **Select** — `Mode`: `Atoms` (default), `Residues` (offered only when the
  structure has residues) or `Molecules`. The `Select` menu adds
  `Select residues…` — a comma-separated list of names, numbers, ranges or
  chain-qualified terms (`LYS`, `12`, `12-20`, `A:12-20`) — and
  `Select solvent`, which takes the waters and counter-ions by residue name.
* **Manipulate** — besides dragging, numeric `Translate (Å)` x/y/z with a
  `Translate` button, and a `Rotate (°)` angle with `About x` / `About y` /
  `About z` buttons. With nothing selected these act on **all** atoms.
* **Bond-centric** — the selected bond's length as an editable number.
* **Measure** — the readout, e.g.
  `d12 = 0.970 Å   d23 = 0.970 Å   angle = 103.80°`.
* **Auto-optimize** — the force field (whichever Open Babel offers), the
  algorithm (`Steepest descent` or `Conjugate gradients`), the steps per round
  (default 4) and `Start`/`Stop`. Each round is one request to the backend and
  only one is ever in flight, so the loop follows the machine rather than piling
  up. The document's own constraints are honoured (see [§8.7](#87-constraints)),
  the whole run is a single undo step named `Auto-optimize`, and a force field
  that cannot type the molecule stops the run with the reason in the status bar.
  The panel shows the energy of the last round. Undo or redo during a run stops
  it first, so the undo reverts the run itself and leaves the edit before it
  alone (`Redo Auto-optimize` puts it back); dragging does nothing until the run
  is started, and loading another structure stops it. An edit made *elsewhere*
  while it runs — a bond order in the Properties tab, say — takes the
  optimization so far into its own undo entry.
* **Auto-rotate** — three speed sliders (−180…180 °/s; defaults x 0, y 20,
  z 0) with `Start`/`Stop` and `Reset`.

### 4.2 SMILES

`File ▸ Build from SMILES…` asks for a SMILES string and replaces the current
document with a 3-D structure. The backend uses RDKit: parse, add hydrogens,
embed with ETKDGv3 (fixed random seed 42, so the result is reproducible), then
clean up with MMFF94 (UFF if MMFF has no parameters). Typing `O` gives a water
molecule with O–H = 0.969 Å and H–O–H = 104.0°.

### 4.3 The Cartesian editor

`Edit ▸ Cartesian editor…` (also reachable from the Properties tab) opens a
modal with one atom per line, `element x y z` in Å. `Apply` commits
`Edit coordinates`; changing the number of atoms re-perceives the bonds.
`Revert` restores the text from the document.

### 4.3a The Properties tab

Besides the structure fields (name, formula, charge, multiplicity, cell) and
the selected atom (element, position, fractional coordinates, formal charge,
label), the tab ends in a **Bonds** table: one row per bond with its two atoms,
an order select, whether it can rotate, and its length in Å. Typing a length
moves the smaller of the two sides, exactly as dragging with the bond-centric
tool does. A bond is `rotatable` when it is a single, non-aromatic bond that
closes no ring and neither of whose atoms is terminal; a ring bond says `ring`.
With atoms selected the table shows only their bonds; it never builds more than
200 rows at once, and above 2000 bonds it waits for a selection rather than
walking the structure on every edit. A bond perceived *through* the cell
boundary shows the minimum-image length with a `*` and is not editable: its two
atoms sit at opposite ends of the box, so moving one along that vector would
fling it across the cell.

### 4.4 Crystal building

`Build ▸ Add unit cell` wraps a molecule in a bounding box with 5 Å padding.
`Build ▸ Supercell…` repeats the cell (real atoms are created).
`Build ▸ Slab…` cuts a slab perpendicular to a (h k l) plane with a chosen
number of layers and vacuum on both sides along **c**. `Build ▸ Crystal
library…` offers 507 CIF entries in 22 categories (elements, oxides, silicates,
zeolites, …), searchable by name or formula. The Crystal tab adds cell editing,
symmetry perception and a set of cell operations — see
[§8.5](#85-crystallography).

### 4.5 Fragment, peptide, nucleic-acid and nanotube builders

These exist in the backend and are fully working, but **they have no user
interface yet**; they are reachable only over the HTTP API:

| Endpoint | What it builds |
|---|---|
| `GET /api/build/fragments`, `GET /api/build/fragments/{category}/{name}` | a library of 382 fragments in 29 categories (alkanes, aromatics, amino acids, nucleobases, steroids, fullerenes, ligands, …) |
| `POST /api/build/insert` | inserts a fragment into the current structure |
| `POST /api/build/peptide` | a peptide from a one-letter sequence with a backbone preset: `straight`, `alpha_helix` (φ/ψ = −60/−40, the default), `beta_sheet` (−135/135), `helix_3_10` (−74/−4), `pi_helix` (−57/−70) or `custom` |
| `POST /api/build/nucleic` | DNA or RNA from a sequence, single or double strand, A/B/Z form |
| `POST /api/build/nanotube` | a (n,m) carbon nanotube, periodic along its axis |
| `POST /api/build/graphene` | an armchair or zigzag graphene sheet, optionally H-saturated |

Example (checked):

```console
$ curl -s -X POST http://127.0.0.1:8765/api/build/nucleic \
    -H 'content-type: application/json' \
    -d '{"sequence":"GATTACA","kind":"dna","double_strand":true,"form":"B"}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d["atoms"]), "atoms,", len(d["residues"]), "residues")'
452 atoms, 14 residues
```

The same applies to the chemistry helpers under `/api/chem/*` — add/remove
hydrogens, perceive bonds and bond orders, partial charges (Gasteiger, MMFF94,
QEq, EEM, QTPIE), aromaticity, InChI/SMILES identifiers, invert chirality,
hydrogen→methyl. They are used by the tests and are available to scripts, but
no menu item calls them yet. Force-field optimization and conformer search
*are* reachable from the UI, through the `Open Babel force fields` backend in
the Calculation tab.

---

## 5. Importing and exporting files

`GET /api/io/formats` is the authoritative list. As of today:

| Format id | Extensions | Read | Write | Library |
|---|---|---|---|---|
| `xyz` | `.xyz` | ✔ | ✔ | ASE |
| `extxyz` | `.extxyz` | ✔ | ✔ | ASE |
| `cif` | `.cif` | ✔ | ✔ | ASE |
| `pdb` | `.pdb`, `.ent` | ✔ | ✔ | ASE |
| `vasp` | `POSCAR`, `CONTCAR`, `.vasp` | ✔ | ✔ | ASE |
| `xsf` | `.xsf` | ✔ | ✔ | ASE |
| `json` | `.json` | ✔ | ✔ | ASE |
| `turbomole` | `coord` | ✔ | ✔ | ASE |
| `cube` | `.cube`, `.cub` | ✔ (atoms) | — | ASE |
| `gaussian-in` | `.gjf`, `.com` | ✔ | ✔ | ASE |
| `gaussian-out` | `.log`, `.g03`, `.g09`, `.g16` | ✔ | — | ASE |
| `orca-out` | `.orcaout` | ✔ | — | ASE |
| `espresso-in` | `.pwi` | ✔ | ✔ | ASE |
| `espresso-out` | `.pwo` | ✔ | — | ASE |
| `mol` | `.mol`, `.mdl` | ✔ | ✔ | **RDKit** |
| `sdf` | `.sdf`, `.sd` | ✔ | ✔ | **RDKit** |
| `mol2` | `.mol2` | ✔ | — | **RDKit** |
| `smi` | `.smi`, `.smiles` | ✔ | ✔ | **RDKit** |
| `cml` | `.cml` | ✔ | ✔ | **Open Babel** |

The split is deliberate: ASE for anything where positions and cells matter and
its reader is lossless, RDKit where bond orders and chemical perception matter,
Open Babel for the long tail. Formats not in the table are still *readable* if
ASE recognises the file (`ase.io.formats.filetype` is consulted as a fallback);
they cannot be written.

Readers always return bonds — from the file when the format carries them,
otherwise perceived from interatomic distances.

**Import.** `File ▸ Open…` opens a dialog with two ways in: a **path on this
machine**, which the backend reads directly, or **Choose a file…**, which
uploads it through the browser (the backend writes it into a scratch directory
outside your project, parses it and deletes it). The **Format** box overrides
the detection, which is what a file whose extension says nothing about its
contents needs — a Gaussian output called `run.txt`, say. The file picker is
filtered to the extensions the readers claim.

Text can also be pasted straight in: `Edit ▸ Paste` (Ctrl+V) reads XYZ, CIF,
PDB, molfiles, CML or SMILES from the clipboard, sniffing the format when it is
not obvious (`POST /api/io/import/text`).

**Import of quantum-chemistry output logs** (`POST /api/io/import/output`,
API only) reads Gaussian, ORCA, NWChem, Quantum ESPRESSO and GAMESS-US logs via
ASE, attaching the total energy, forces, dipole magnitude, partial charges and
magnetic moments, and turning a multi-step run into an optimization trajectory.
Vibrational data is not parsed.

**Save.** `File ▸ Save` (Ctrl+S) stores the open document in the project;
`Save as…` (Ctrl+Shift+S) writes a copy under a new name and continues editing
the copy, so an optimized or supercelled structure does not overwrite the one
it came from. Unsaved work is marked with a bullet in the window title and the
status bar, and leaving the page then asks first.

**Export.** `File ▸ Export XYZ`, `Export extended XYZ` and `Export CIF` (the
last is disabled without a unit cell) download the current structure;
`Export image…` writes a picture of the viewport (see [§6](#6-visualization)).
Extended XYZ carries the cell and per-atom properties; plain XYZ does not.
Trajectories are exported from the trajectory player's `Export XYZ` button as
extended XYZ with per-frame energy, forces, cell and time.

`POST /api/io/export` can write any writable format to a path on the backend
machine. Returning the text inline (no `path`) works for the ASE formats only.

---

## 6. Visualization

The `View` menu holds the quick switches — the four display types, hydrogens,
projection, `Fit to structure`, force vectors, unit cell, axes, labels on/off
and the background — and everything with a setting lives in the **Display tab**
of the right dock, which is Avogadro's Display Types dock:

| Section | What it holds |
|---|---|
| Structure | display type, **colour by**, atom radius, bond radius, multiple bonds, hydrogens, and a display type for the **selected atoms only** (ball-and-stick on the active site, wireframe on the rest) |
| Display scope | which atoms a display type applies to: assign one to the selection, show only the selection, hide the selection, or put everything back |
| Labels | on/off, what atoms and bonds are labelled with (index, symbol, name, formal or partial charge, residue name or number, uid, custom; bond order or length), colour, size, offset |
| Hydrogen bonds | on/off, cut-off distance and angle; drawn as dashed sticks from the geometry on screen |
| Ribbons | cartoon, ribbon or backbone rendering of a protein, and a width; helices red, strands yellow with an arrowhead, coil thin |
| Vectors | on/off, which field (forces, moments, mode displacements) and a scale |
| Unit cell and axes | the cell box, the repeat counts, the corner gizmo |

Atom colours come from the built-in element table (generated from ASE);
selected atoms are tinted towards blue, hovered atoms towards yellow.
**Colour by** replaces the element colours with what an atom is *part of*:

* `Residue` — the RasMol amino-acid colours Avogadro uses (acidic red, basic
  blue, aliphatic green, aromatic indigo, polar orange or cyan…), with the four
  bases coloured too. A residue name the table does not know is grey, so it is visible as
  unknown.
* `Chain` — a fixed cycle of eight colours in the order the chains appear.
* `Secondary structure` — the cartoon colours (helices red, strands yellow, the
  rest pale), fetched from the same DSSP assignment the ribbons use, so it works
  with ribbons off.

and four that do not need residues at all:

* `Atom index` — the red-to-violet sweep Avogadro uses, first atom to last. It
  is how one sees the order a file lists the atoms in.
* `Distance from the first atom` — the same sweep, scaled to the farthest atom.
* `Partial charge` — red for negative, blue for positive, white at zero, scaled
  by the largest magnitude in the structure so a set of small charges is still
  readable. The charges are the ones on the document: run
  `Extensions ▸ Assign partial charges` (Open Babel: gasteiger, mmff94, qeq, eem
  or qtpie) or take them from a calculation. The panel says so when there are
  none.
* `One colour` — everything in a colour chosen next to the list, for a figure
  where the molecule is a shape rather than a set of elements.

A structure without residues keeps its element colours under the three residue
schemes, and the panel says so. Double
and triple bonds are drawn as two or three parallel sticks in the plane of the
molecule; structures built from SMILES are kekulized, so an aromatic ring shows
alternating double bonds.

**Display scope** is Avogadro's Objects tab. Avogadro scopes each display
engine to a list of atoms; Atomscope draws one structure layer, so the same
thing is a display type *per atom*, plus atoms that nothing draws:

* **Assign to selection** — the selected atoms take the display type chosen
  above the buttons; everything else keeps the global one. Van der Waals
  spheres on a ligand over a wireframe protein is this, twice.
* **Display only selection** — the selection takes the chosen display type and
  every other atom is hidden.
* **Hide selection** — the selection is hidden and nothing else changes.
* **Show all** — every atom goes back to the global display type.

A hidden atom is drawn by nothing: no sphere, no bond, no label, and the mouse
cannot pick it. The assignment follows the *atoms*, not their positions in the
list, so deleting an atom, optimizing the geometry or undoing does not hand one
atom's display type to another; an operation that rebuilds the whole document
(`Add hydrogens`, opening another file) starts from a clean slate. It is a view
setting, not part of the document, and is not saved with the project.

The **cell repeat** (Display ▸ Unit cell and axes ▸ Repeat a/b/c) draws copies
of the atoms and bonds as well as the box, up to ten per axis and a total
instance budget; it changes nothing in the document. Use `Build ▸ Supercell…`
to actually create the atoms.

`File ▸ Export image…` writes what the viewport shows — including the axes
gizmo — at one, two or four times its size, as a PNG (with an optional
transparent background) or a JPEG.

### 6.1 Isosurfaces

The `Surfaces` tab lists every volumetric grid of the project — the ones a
calculation produced (electron density, spin density, orbitals) and any
imported cube. Each card shows the kind, the grid shape, the unit and, once
loaded, `min · max · mean · suggested` statistics.

`Add surface` meshes the grid with marching cubes in a Web Worker and adds a
surface card with:

* **Isovalue** — a slider plus a numeric field. The starting value is the
  backend's suggestion: for a positive field, the isovalue that encloses 80 %
  of the integrated density; for a signed field, `min(0.05, |max|/2)`. The
  slider is logarithmic for wide-range fields.
* **Colour** — one colour picker, or two when ± lobes are on (blue `#2b6cff`
  positive, red `#e03a3a` negative).
* **Opacity** — 0.05…1; transparent surfaces are rendered double-sided after
  the opaque geometry.
* **± pair** — offered when the grid has negative values and is not a density
  kind, and on by default for such grids. This is what turns an orbital into
  the familiar two-lobed picture.
* **Resolution** — `full`, `1/2` or `1/4`. Grids above 128³ points start at a
  coarser step.
* **Colour by** — paint the surface with the values of a *second* grid, which
  is how an electrostatic potential is mapped onto an electron density. Any
  other grid of the project can be chosen and is loaded when it is. The scale
  runs blue (negative) through white to red (positive) and is symmetric about
  zero by default -- white on the surface always means zero, which is what makes
  a potential map readable -- so it spans plus and minus the largest magnitude
  found on the surface. The line under the fields reports the values actually
  found there, and the two fields set the scale by hand; `use this range` puts
  the automatic one back.

`Import cube` reads a Gaussian cube from a path on the backend machine and
files it as a project dataset with a kind you choose (electron density, spin
density, orbital, orbital density, electrostatic potential, density difference,
other).

### 6.2 Trajectories

A trajectory reaches the viewport in two ways: `Load trajectory` on the
Calculation ▸ Results tab, or `File ▸ Import trajectory…` for any multi-frame
file ASE can read (extended XYZ, ASE `.traj`, `XDATCAR`, …).

The player offers first/previous/play-pause/next/last, a frame slider, an
`fps` field (default 15), a loop mode (`Once`, `Loop` — the default —, or
`Ping-pong`), a readout of frame index, step, time, energy and temperature
where available, and an energy sparkline with a marker on the current frame.

Playback is **display-only**: the renderer receives per-frame position and cell
overrides and the document is untouched. `Load frame as structure` commits the
current frame as a real edit (one undo step); `Export XYZ` writes the whole
trajectory.

---

## 7. Calculations

### 7.1 Choosing a backend

The `Backend` selector lists every discovered plugin, with ` (not available)`
appended and the entry disabled when its executables are missing.

| Backend | Executes | What it does |
|---|---|---|
| `CP-PAW` | yes | plane-wave/PAW DFT: single point, forces, damped relaxation, Car-Parrinello MD, densities, orbitals, DOS, band structures |
| `ASE workflows (built-in calculators or CP-PAW)` | yes | EMT, Lennard-Jones, Morse, an Open Babel force field, or CP-PAW forces; single point, BFGS relaxation, Langevin MD |
| `Open Babel force fields` | yes | MMFF94, MMFF94s, UFF, GAFF, Ghemical: single point, optimization, conformer search |
| `Quantum chemistry input generators` | **no** | writes ready-to-run decks for ORCA, Gaussian, NWChem, GAMESS-US, Quantum ESPRESSO and ABINIT |

### 7.2 The parameter form

![The CP-PAW parameter form](images/calculation-form.png)

Nothing about the form is hard-coded in the frontend. Each backend publishes a
`ParameterSchema` — sections of typed parameters with labels, units, ranges,
enum choices, help text, a pointer into the code's own manual, the path the
value maps to in the generated input, and optional visibility conditions. The
same React renderer draws all of them, so a new backend parameter needs no
frontend change.

* Fields appear and disappear as you type: CP-PAW's `k-point density R` is only
  shown for `Automatic from real-space length R`, `Electron temperature` only
  for Mermin occupations, and so on. Hidden parameters are neither validated
  nor written to the input.
* `Show advanced options` reveals the advanced sections and fields.
* Values you do not touch keep the schema default; the calculation record
  always stores the **complete merged dictionary**, so a calculation can be
  reproduced from its own JSON.

**Presets** are partial value sets published by the backend. CP-PAW ships six,
derived from the CP-PAW hands-on course: `Molecule: wave-function
optimization`, `Molecule: geometry optimization`, `Molecule: molecular dynamics
(Nosé)`, `Solid (insulator): single point`, `Solid (metal): Mermin
occupations`, `Ferromagnet (spin polarized, Mermin)`. Choosing one resets the
form to the schema defaults overlaid with the preset.

### 7.3 Validate, generate, run

The button row is `Validate`, `Generate input`, `Run`, plus `Fork`,
`Continue from restart`, `Cancel` and `New` when they apply.

**Validate** runs the generic type/range/enum checks and then the backend's own
semantic checks against the structure. Issues come back as errors (which block
generation) or warnings (which do not). Real examples:

* `plane-wave codes need a periodic cell` — warning, Quantum ESPRESSO on a
  molecule;
* `MD from random wave functions is unphysical` — CP-PAW `md` with
  `start = scratch`;
* `EMT has no parameters for [...]` — error;
* `occupations = mermin` with `SAFEORTHO` on — warning, it will be forced off.

**Generate input** writes the files and switches to the `Generated input` tab,
which shows each file in full with its role, and offers `Save input files…`.
Generation is deterministic: the same values always give byte-identical files.

**Run** submits the job. Only one job runs at a time per backend process; the
rest queue. Status moves `draft → ready → queued → running → completed |
failed | cancelled` and is shown as a badge in the project panel, on the
Calculation panel and in the Analysis header.

Input-only backends cannot be run: for `qc_inputs` the `Run` button is
disabled and carries the tooltip *This backend only generates input files*. The
API refuses it too, with

```
backend 'Quantum chemistry input generators' only generates input files;
run them with the target program
```

Take the deck from the `Generated input` tab and run it wherever you like.

**Monitoring.** The job console streams stdout and stderr line by line, and
additionally tails the files the program writes itself — `case.prot` for
CP-PAW, `progress.log` for the ASE and Open Babel runners. Everything is also
written to disk in the calculation's `work/` directory, and a final read after
the process exits makes sure nothing written just before the end is lost.

**Cancel** is cooperative. The manager sends `SIGTERM` to the driver process;
the CP-PAW driver turns that into a *soft stop* by touching `case.exit`, so
CP-PAW finishes the current step, writes its restart file and final reports and
exits normally. Only if the program does not stop within the grace period
(120 s for a CP-PAW run) is the whole process group terminated and then killed.
A cancelled CP-PAW calculation therefore leaves a usable `case.rstrt` behind.
Expect a cancel to take up to a minute and a half to be reported as finished.

**A run cannot be repeated in place.** Once a calculation is `completed`,
`failed` or `cancelled` its parameters are read-only:

> This calculation has run and is read-only. Fork it to change parameters or
> continue from its restart file.

### 7.4 Forking and continuing

* **`Fork`** creates `<name> (fork)`: a new calculation with the parent's
  values as the starting point, its own directory, and a `parent_calculation_id`
  link. Change what you like and run it.
* **`Continue from restart`** (CP-PAW only) creates `<name> (continued)`,
  copies the parent's `case.rstrt` into the new working directory and flips
  `Start from` to `Restart file (START=F)`. This is the CP-PAW workflow the
  course teaches — converge the electrons, then relax, then run MD — expressed
  as a chain of calculations, each with its own record and its own directory.

Beware the CP-PAW trap the schema warns about: with `START=F` the program
**ignores the structure file**. If you want to continue from the restart file
but with a new geometry, choose `Restart file, but take geometry from structure
(NEWSTRC=T)`.

### 7.5 Results

The `Results` tab shows the total energy to six decimals, whether the run
converged, the number of trajectory frames with a `Load trajectory` button,
any warnings, and `Load final structure`, which loads the relaxed/final
geometry (saved into the project as `<calculation name> (result)`) into the
viewport.

---

## 8. Analysis

The `Analysis` tab works on the calculation selected in the project panel and
has four sections.

### 8.1 Convergence

Three charts: `Convergence` (every series except energy and temperature, with
`Logarithmic y axis` on by default), `Total energy` versus step, and
`Temperature` versus time when the run had any. For CP-PAW these come from the
`!>` rows of the protocol: total energy, conserved energy, wave-function
kinetic energy and temperature.

### 8.2 Forces

Forces are attached to the final structure as a per-atom vector property and
drawn by `View ▸ Show force vectors`. CP-PAW only prints atomic forces when
the atoms are being propagated; the CP-PAW backend therefore offers a `Forces`
task that first converges the electrons and then takes a few strongly damped
atomic steps, and reports the forces **at the input geometry**. Missing forces
are reported as missing, never as zeros.

### 8.3 Orbitals

For a completed CP-PAW calculation the orbital browser lists every eigenvalue
with its band index, energy in eV, occupation and a HOMO/LUMO-relative label,
with the HOMO and LUMO rows highlighted and a `●` marking orbitals whose cube
already exists.

Pick a row (or press `HOMO`, `LUMO`, `−`, `+`) and press `Show`. If the cube
does not exist yet, Atomscope exports it **on demand**: it writes a one-step
restart control file under a separate root (`case_orb`), runs `paw_fast.x` for
that single step, converts the resulting `.wv` file to a Gaussian cube with
`paw_wave.x`, registers the grid and adds a surface. The original `case.prot`,
`case.rstrt` and `case.pdos` are left untouched. On this workstation one orbital took
8.1 s from pressing `Show` to the surface appearing.

You can also request cubes up front, in the calculation form: `Orbitals to
export (band indices)` takes **space-separated 1-based band numbers**, e.g.
`3 4 5`. (Ranges such as `1-4` are silently ignored.)

### 8.4 DOS and band structure

![Silicon DOS](images/silicon-dos.png)

**DOS** — set `Broadening [eV]` (default 0.1) and `Projection`
(`Total only`, `Per element` — the default —, or `Per atom`), press
`Compute DOS`. Atomscope writes a `.dcntl`, runs `paw_dos.x` as a
post-processing job, parses the resulting `.dos` files and plots them with a
marker at the Fermi level (or the HOMO if there is no Fermi level).
Projections are further split into s/p/d/f channels where the element has them.
Spin degeneracy is restored for non-spin-polarised runs, so integrating the
occupied DOS gives the valence-electron count.

**Band structure** — set `k-points per segment` (default 20). The path is
ASE's default high-symmetry path for the lattice, shown above the button.
`Compute bands` writes a `.bcntl`, runs `paw_bands.x` and reads the resulting
`.dat` files.

> Two caveats today. (a) The chart in the `Bands` section does not currently
> draw the band curves — the numbers are correct in the stored data and over
> `GET /api/cppaw/calculations/{id}/bands`, but the plot comes out empty
> (see [§10](#10-limits-and-known-problems)). (b) DOS and band results are not
> re-loaded when you reopen a project: the sections say *No DOS computed yet* /
> *No band structure computed yet* until you press the button again in the
> current session.

### 8.5 Crystallography

![The Crystal tab](images/crystal-panel.png)

The `Crystal` tab operates on the structure in the viewport, and every
operation is a single undo step.

* **Unit cell** — the lattice type and volume; a `On cell change` selector
  (`keep Cartesian coordinates`, the default, or `keep fractional
  coordinates`); an *a b c α β γ* editor; a raw 3×3 cell-matrix textarea; and a
  fractional-coordinate textarea. Each has `Apply` and `Reset`.
* **Symmetry** — a `Tolerance (Å)` field (default 0.001) and `Perceive`, which
  runs spglib and reports the space group as
  `Fd-3m (227) · Hall F 4d 2 3 -1d` and the point group as
  `m-3m · cubic · 192 ops · 1 asymmetric`. The block is greyed and marked
  `(outdated)` as soon as you change the structure.
* Operations on the symmetry: `Symmetrize`, `Primitive`,
  `Primitive + standardize`, `Niggli`, `Asymmetric unit`, and
  `Fill cell (group)` which regenerates the full cell from an asymmetric unit
  and a space-group number.
* **Operations** — `Wrap atoms`, `Standard orientation`, `Supercell…`,
  `Slab…`, `Crystal library…`, `Remove unit cell`, and `Scale to volume`.
* **Display** — the cell repeat counts described in [§6](#6-visualization).

### 8.6 Force fields

Molecular mechanics is reached through the `Open Babel force fields` backend in
the Calculation tab:

* `Single point` reports the energy in eV *and* in the force field's own unit
  (kcal/mol for MMFF94, kJ/mol for UFF/GAFF/Ghemical), plus the individual
  terms (bond, angle, stretch-bend, torsion, out-of-plane, van der Waals,
  electrostatic).
* `Optimize geometry` runs steepest descent or conjugate gradients and records
  a trajectory every *N* steps.
* `Conformer search` runs a systematic, random or weighted rotor search and
  returns the conformers as a trajectory with one energy per conformer, which
  the Analysis ▸ Convergence chart plots against the conformer index.

The structure's own constraints are always honoured, by the force fields here
and by `Extensions ▸ Optimize geometry (MMFF94)`; extra one-off constraints can
still be given as JSON in the advanced `constraints_json` field.

### 8.7 Constraints

`Extensions ▸ Constraints…` opens the table of geometric constraints the
document carries. They are saved with the structure, re-numbered when atoms are
removed, and dropped when an atom they name goes away.

* **Add** — choose a type, and the fields next to it are filled with the atoms
  you have selected, in the order you picked them (the numbering is the one the
  `index` label shows, starting at 1). The types are Avogadro's: `Ignore atom`,
  `Fix atom`, `Fix X`, `Fix Y`, `Fix Z`, `Distance`, `Angle` and `Torsion`.
* **Value** — a distance in Å, an angle or torsion in degrees. Leave it empty
  and the constraint holds whatever the geometry has when the run starts; the
  `Now` column always shows the current value. The value of a constraint that
  is already in the table can be typed into its row.
* **Delete selected** removes the rows you clicked, `Delete all` empties the
  table, and `Save…`/`Load…` write and read the list as a JSON file.

An ignored atom is left out of the force field entirely. That is an Open Babel
notion: ASE-driven calculations (and CP-PAW) do not see it, and CP-PAW takes
only fixed atoms and fixed bond lengths from the list. Open Babel treats a
torsion constraint as a restraint rather than a hard condition, so a torsion
holds approximately where a distance or an angle holds exactly.

---

## 9. Keyboard shortcuts

All of these were checked in a running browser. There is no "viewport focus":
the handlers are global, but the tool letters and the selection commands are
ignored while you are typing in a text field.

| Keys | Action | Notes |
|---|---|---|
| `N` | Navigate tool | ignored while typing, or with any modifier |
| `S` | Select tool | |
| `D` | Draw tool | |
| `M` | Manipulate tool | |
| `B` | Bond-centric tool | |
| `R` | Measure tool | |
| `O` | Auto-optimize tool | |
| `A` | Auto-rotate tool | |
| `1` / `2` / `3` | bond order Single / Double / Triple | Draw tool only |
| `Ctrl`/`Cmd` + `Z` | Undo | also `Edit ▸ Undo <label>` |
| `Ctrl`/`Cmd` + `Shift` + `Z` | Redo | |
| `Ctrl`/`Cmd` + `Y` | Redo | |
| `Ctrl`/`Cmd` + `A` | Select all atoms | |
| `Ctrl`/`Cmd` + `Shift` + `A` | Select none | |
| `Ctrl`/`Cmd` + `O` | Open… | the import dialog |
| `Ctrl`/`Cmd` + `S` | Save | into the open project |
| `Ctrl`/`Cmd` + `Shift` + `S` | Save as… | a copy under a new name |
| `Ctrl`/`Cmd` + `X` / `C` / `V` | Cut / Copy / Paste | the selection, or the whole molecule when nothing is selected; text selected in a panel is left alone |
| `Ctrl`/`Cmd` + `Backspace` | Clear the selection | without touching the clipboard |
| `Enter` | commit the value and leave the field | in number, element and isovalue fields |

Mouse conventions are summarised in the tool table in
[§4](#4-building-and-editing-structures). The modal dialogs (Cartesian editor,
Open, Export image, Help, Supercell, Surface slab, Crystal library) close on
`Escape` as well as with their buttons.

Note that `Ctrl+Z` and `Ctrl+O` are *not* suppressed while you type in a text
area, so undo can fire from inside the Cartesian editor.

---

## 10. Limits and known problems

Things you will notice, with their current status. None of them has a
workaround hidden from you.

* **Band-structure chart is empty.** `paw_bands.x` runs, the data is parsed
  correctly and is available over the API, but the chart in Analysis ▸ Bands
  draws only the axes and the high-symmetry ticks. Read the gap from the
  eigenvalues (Analysis ▸ Orbitals, or the protocol) until this is fixed.
* **`diagonalize` band mode fails** on a CP-PAW installation whose
  `paw_bands.x` predates that option — the tool stops with
  `BANDS: MODE UNKNOWN … DIAG`, and the previous (interpolated) result is
  returned unchanged instead of an error. Use the default
  interpolation mode, or rebuild CP-PAW.
* **DOS and bands are not restored when a project is reopened**; press the
  compute button again.
* **Cancelling a CP-PAW run takes ~90 s to report**, even when CP-PAW itself
  stopped immediately. The stop is clean and the restart file is written; only
  the status update is late.
* **`Save current structure` and `File ▸ Save` overwrite** the structure the
  document came from (see [§3](#3-projects)); `File ▸ Save as…` is how a
  derived structure gets its own entry.
* **One project and one running job at a time** per backend process.
* **Runs are serial.** The CP-PAW plugin can build an MPI command line
  (`mpirun -np N --oversubscribe ppaw_fast.x`) when a calculation asks for more
  than one core, but the calculation form always asks for one; there is no
  resources control yet.
* **Units are shown as raw tags** next to some numeric fields (`rydberg`,
  `angstrom`, `bohr`, `atomic_time`) rather than symbols.
* **No user interface for** the fragment/peptide/nucleic/nanotube builders, the
  `/api/chem/*` helpers, atom labels, colour schemes, ribbons/cartoons for
  biomolecules, vibrations and spectra, or Z-matrix editing.
* **No authentication.** The API is unauthenticated on loopback; a per-launch
  token is planned.
* **No desktop shell yet.** Atomscope runs in a browser against a local
  backend.
