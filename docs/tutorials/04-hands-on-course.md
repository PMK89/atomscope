# Tutorial 4 — The CP-PAW hands-on course, inside Atomscope

The course this follows is the *CP-PAW Hands-On Course on First-Principles
Calculations* (Blöchl, Schade and ten Brink, Clausthal University of
Technology). It is a shell course: you write `.cntl` and `.strc` decks in an
editor, run `paw_fast.x`, then run `paw_dos.x`, `paw_bands.x`, `paw_wave.x` over
what it produced and plot the results with xmgrace and Avogadro.

This tutorial walks the same ground with everything in one application. Chapter
by chapter, it says what to do in Atomscope and what to expect — and, where
Atomscope cannot yet do what the course asks, it says so plainly rather than
quietly skipping it (§11).

**The course document is not in this repository and must not be**: its notice
permits personal and classroom copies only. Nothing here is quoted from it. What
is here are chapter numbers, the physical parameters, and the steps in
Atomscope's own words. Every number in it was produced by running the
calculations on this machine.

**You do not need CP-PAW for most of it.** Chapters 2–8 need the real binaries,
but every panel they use also works on an ASE calculator, and §10 says which
parts to run with EMT instead. Where a CP-PAW result is quoted below, it came
from `paw_fast.x` on this machine.

## Contents

1. [Before you start](#1-before-you-start)
2. [The whole course in one project (the fast path)](#2-the-whole-course-in-one-project-the-fast-path)
3. [Chapter 2: water, wave functions and geometry](#3-chapter-2-water-wave-functions-and-geometry)
4. [Chapter 3: water orbitals, planes, DOS and COOP](#4-chapter-3-water-orbitals-planes-dos-and-coop)
5. [Chapter 4: malonaldehyde](#5-chapter-4-malonaldehyde)
6. [Chapter 5: molecular dynamics](#6-chapter-5-molecular-dynamics)
7. [Chapter 6: solids, silicon and aluminium](#7-chapter-6-solids-silicon-and-aluminium)
8. [Chapter 7: magnetism, iron and NiO](#8-chapter-7-magnetism-iron-and-nio)
9. [Chapter 8: convergence](#9-chapter-8-convergence)
10. [Following the course without CP-PAW](#10-following-the-course-without-cp-paw)
11. [What Atomscope cannot do yet](#11-what-atomscope-cannot-do-yet)
12. [Past the course: surfaces, thermochemistry, scripting](#12-past-the-course-surfaces-thermochemistry-scripting)

---

## 1. Before you start

Start the backend and the frontend as `README.md` describes, open
`http://127.0.0.1:5173`, and make a project: enter a directory path in the left
dock and press `Create`. Everything below lives in that one project, because
that is how the course's exercises relate to each other — chapter 2.8 continues
chapter 2.7 from its restart file, and chapter 8.2 varies one parameter of a
converged reference run.

If CP-PAW is installed, Atomscope finds it through `$PAWDIR` (or
`$ATOMSCOPE_CPPAW_DIR`). The `Calculation` tab's `Backend` list will hold
`cppaw` beside `ase_builtin`; if it does not, the binaries were not found and
§10 is your route.

One number to know before you compare anything: **the gap this machine computes
is not the gap the course prints.** Chapter 2.7 quotes 5.4665 eV for water; a run
here gives 5.3843 eV. Typing the course's own deck out by hand and running it
directly against the installed `paw_fast.x` also gives 5.3843 eV — so the
difference is this machine's code or setup files, not the input Atomscope
writes. Expect small offsets of that kind throughout, and compare *shapes* and
*differences* rather than absolute totals.

## 2. The whole course in one project (the fast path)

Every exercise below is also scripted, so you can have the finished
calculations to look at while you work through the steps yourself. From
`backend/`:

```bash
PYTHONPATH=src:../scripts/course ../.venv/bin/python -m run water-wavefunction
PYTHONPATH=src:../scripts/course ../.venv/bin/python -m run water-relax
PYTHONPATH=src:../scripts/course ../.venv/bin/python -m run water-orbitals
```

and the same for `malonaldehyde-wavefunction`, `malonaldehyde-relax`,
`malonaldehyde-orbitals`, `silicon-wavefunction`, `aluminium`,
`iron-reference`, `iron-ferromagnet`, `nio-symmetry-broken`,
`nio-antiferromagnet`. The sweeps of chapter 8 have their own runner:

```bash
PYTHONPATH=src:../scripts/course ../.venv/bin/python -m sweep water-cell-size
```

with `iron-cutoff`, `iron-dual-cutoff`, `silicon-kpoints` and `silicon-volume`
as the others. Everything lands in one project at
`.scratch/course-runs/course/`, which you open in the application by pasting
that absolute path into `Project path`.

These scripts drive the same `CalculationService` the application drives —
there is no second code path. They exist so the course's chain can be rerun
end to end after a change, and they are how the numbers quoted in this tutorial
were produced.

## 3. Chapter 2: water, wave functions and geometry

[Tutorial 1](01-water-cppaw.md) is this chapter in full detail: the fcc cell,
the generated `.cntl` and `.strc`, the protocol file, the convergence plot, the
relaxation and the final geometry. Read it there and come back. In brief:

**2.7 — optimize the wave functions.** Build water (`File ▸ Build from
SMILES…`, `O`), then in `Calculation` pick the `cppaw` backend, `Task ▸
Wave-function optimization (single point)`, and press `Generate input` to see
the deck before running anything. `Run` streams the protocol into the console at
the foot of the window.

The course's setup for a molecule is a 12 Å face-centred cell at the Γ point
with the electrostatic image interaction subtracted; Atomscope writes that when
`Vacuum margin for molecules` boxes the molecule and `Electrostatic decoupling
of periodic images (!ISOLATE)` is `auto` or `always`.

**2.7.4 — follow the progress graphically.** `Analysis ▸ Convergence` plots the
total energy and the gap against iteration while the run is going, which is what
the course does by piping the protocol's `!>` rows into xmgrace.

**2.8 — relax the atoms.** `Fork` the finished calculation, tick `Continue from
restart`, set `Task ▸ Geometry optimization (damped dynamics)` and run. The
friction schedule the course uses is the default: `Automatic atomic friction`
on, with `Atomic friction factor while the energy falls` at 0.9, so the friction
decays while the structure is going downhill.

**2.8.4 / 2.8.5 — analyse the geometry.** The course runs `paw_strc` and then
loads the result into Avogadro. Here, `Analysis ▸ Protocol ▸ Show reported
geometries` turns the protocol's geometry blocks into a trajectory you can step
through, and the `Properties` tab lists bond lengths, angles and torsions of
whatever is selected.

Relaxed water comes out at **0.9815 Å and 105.07°** against the 0.981 Å and
105.2° the course reports (experiment: 0.9572 Å, 104.474°). That is the whole
chain — schema, deck, real binaries, parsing — agreeing with a published
result.

## 4. Chapter 3: water orbitals, planes, DOS and COOP

**3.3 — extract and plot the orbitals.** In `Calculation ▸ Setup`, put the band
indices you want into `Orbitals to export (band indices)` and run. Then
`Analysis ▸ Orbitals` lists the eigenvalues with occupations; `HOMO` and `LUMO`
jump to the frontier orbitals, `−` and `+` step, and `Show` computes the
isosurface and loads it into the viewport. The `Surfaces` tab controls the
isovalue and the two signs.

The course's molecule sits at (0,0,0) of its cell, which means CP-PAW's cubes
wrap across the grid boundary and the lobes come out at the corners of the box.
Atomscope rolls the grid by a whole number of voxels so the structure sits in
the middle of it — exact, no interpolation, and it drops the corner image atoms
CP-PAW writes as well.

**3.4 — contour plots.** `Analysis ▸ Planes` lists the cuts CP-PAW wrote and
draws each as a contour map or as a rubbersheet (`relief ×`, `light azimuth`
and `light elevation` shape it). The number of contour levels and the
scale are yours to set.

**3.5 — DOS and COOP.** `Analysis ▸ DOS`, then `Compute DOS`. `Projection`
chooses `Total only`, `Per element` or `Per atom`, and `Broadening [eV]` is the
width. Where the run reported overlap populations, the COOP appears as a second
chart under the DOS — positive for bonding, negative for antibonding.

## 5. Chapter 4: malonaldehyde

**4.4 — build it.** The course draws C₃H₄O₂ from its Lewis formula. Two ways
here: `File ▸ Build from SMILES…` with `OC=CC=O` and then the `Draw` tool for
the hydrogens, or the `Draw` tool from the start — click to place an atom, drag
between two to bond them, `1`/`2`/`3` for the bond order. `Build ▸ Add
hydrogens` fills in the rest, and `Auto-optimize` (the `O` tool) pulls the
sketch into a sensible shape with a force field before any DFT runs.

**4.5 / 4.6 — optimize and relax.** As chapter 2, with one addition the course
makes: `Atomic masses (u)` takes `C: 5; O: 5; H: 2`, which speeds the damped
dynamics up by making the heavy atoms lighter. The enol form's intramolecular
hydrogen bond is drawn by the `Hydrogen bonds` display type (`Display` tab).

**4.7.2 — orbitals and eigenvalues.** `Analysis ▸ Orbitals` again. The table is
the level diagram in numbers; the isosurfaces are what the course prints.

**4.7.3 — projected DOS.** `Compute DOS` with `Projection ▸ Per atom` gives one
curve per atom, `Per element` one per element. This is where the course's
per-atom and per-angular-momentum decomposition lives.

**4.7.4 — special orbitals in a local frame.** The course builds `!ORB` blocks
with nearest-neighbour directions so a projection is taken onto a local
coordinate system rather than the cell axes. Atomscope writes those from the
structure's own bonds.

**4.7.5 — COOPs.** The same chart as 3.5, now per bond.

**4.7.6 — wave functions and density.** Tick `Electron density (cube)` in
`Output and analysis` before running; `Grid spacing for cubes` controls the
resolution. The result is an isosurface in the `Surfaces` tab like any other.

## 6. Chapter 5: molecular dynamics

This is the chapter that runs longest and shows the most.

**Set it up.** Fork the relaxed malonaldehyde, `Continue from restart`, then in
`Calculation ▸ Setup`:

* `Task ▸ Molecular dynamics`
* `Time steps` and `Time step` — thousands of steps. The default step is 5
  atomic units of time, which is 0.121 fs (that is what the trajectories on this
  machine record: the first frame of a real run is stamped 0.1209 fs)
* `Temperature` 300 K, `Nosé thermostat (atoms)` on, and a `Thermostat frequency
  (THz)` — it has to be well below the vibrational frequencies it is coupling to,
  or the thermostat drives the modes instead of thermalising them
* `Nosé thermostat (wave functions)` on as well: that is the second thermostat
  the chapter is about, and it is what keeps the wave functions from heating up
  with the ions
* `Initial random velocities (K)` to start the ions moving
* `Energy trajectory (_e.tra)` on, so the energies are written for the plots
  below

**Watch it.** The console streams the protocol. `Analysis ▸ Convergence` plots
the temperature against time beside the conserved energy — which is how you
tell equilibration from a broken time step: the total energy should hold still
while the temperature wanders.

**Play it back.** The trajectory (`_r.tra`, CP-PAW's own binary format, read by
`backends/cppaw/tra.py`) is loaded as a trajectory: the player under the
viewport steps through it, plays it and loops it. That is chapter 5.11's movie,
in the application rather than as a file.

**Take the chapter's plots off it.** `Analysis ▸ Dynamics` is what the course
runs `paw_tra` for, and it works on whichever trajectory is loaded:

* `Series ▸ Temperature of a group`, `Atoms ▸ One curve per element`, and a
  `Running average τ` of 100 fs gives Fig. 5.4 — the hydrogens running hot
  while the heavy atoms lag. Raise τ to 1000 fs for Fig. 5.5, where the two
  curves have met and equipartition is visible. The chart title names the
  window, because those two figures differ by nothing else.
* `Series ▸ Internal coordinate / mode` with one `Bond` term per O–H distance
  gives Fig. 5.6, the proton transfer itself. A single mode of two bond terms
  scaled +1 and −1 plots the transfer coordinate directly, which is how
  `paw_tra` writes it; `Add from selection` takes the atom indices from
  whatever you have picked in the viewport, and `Plot the time derivative` turns
  any of these into a velocity.

The temperature uses g = 3N degrees of freedom for the group, exactly as
`paw_tra` does — and as CP-PAW's own protocol does, so this number and the
`Temperature` curve on the `Convergence` tab agree. Against the physical count
it is low by 3N/(3N−6) for a free molecule, which for malonaldehyde's nine
atoms is 27/21; `paw_tra` prints the same warning, and the figures are drawn
with the uncorrected number.

## 7. Chapter 6: solids, silicon and aluminium

[Tutorial 2](02-silicon-crystal.md) covers silicon's symmetry, supercells,
slabs, DOS and bands in detail. The course's own path through it:

**6.3.1 — wave functions at equilibrium.** Insert silicon from `Build ▸ Crystal
library…` (or build it: `Crystal` tab, diamond structure, a = 5.431 Å). In
`Calculation`, the `Periodicity and k-points` section replaces the molecular
box: `k-point sampling` and `k-point density R` are what the course varies.

**6.3.2 — density of states.** `Compute DOS`; the gap is the empty stretch
around the Fermi level.

**6.3.4 — band structure.** `Analysis ▸ Bands` computes Γ–X–W–L–Γ–K, with
`k-points per segment` setting how finely each leg is sampled.

**6.3.6 — k-point convergence.** A sweep — see §9.

**6.3.7 — E(V), pressure and the bulk modulus.** A sweep over volumes, then
`Fitted curve ▸ Murnaghan equation of state (Fig. 6.7)` in the `Sweeps` panel.
The fit reports E₀, V₀, B₀ and B′, and the lattice constant when you give the
volume per formula unit in `Cell volume / a³`.

Two things worth knowing here, both measured. The tool fits **Murnaghan's**
equation of state (PNAS 30, 244), not Birch-Murnaghan: fitting the course's own
printed points with `birchmurnaghan` is 45× worse in residual than with
`murnaghan`, which is what identifies it. And scipy fits those same points
*better* than `paw_murnaghan.x` does — the course's tool uses a quenched
molecular-dynamics minimiser that stops a little short.

**6.4.2 — a metal.** Aluminium needs `Occupations ▸ Mermin functional (metals,
fractional occupations)` and an `Electron temperature`; without them a metal's
occupations cannot settle. The DOS then has no gap and a Fermi level in the
middle of it, which is the point of the exercise.

## 8. Chapter 7: magnetism, iron and NiO

**7.2.2 — ferromagnetic iron.** bcc iron, `Spin polarized` on. The DOS comes
back spin-resolved — up above the axis, down below — and `Spin density (cube)`
gives the isosurface of the difference.

**7.3 — antiferromagnetic NiO.** Rock-salt NiO doubled along (111), which the
`Crystal` tab's supercell does. The exercise is in two runs: first with
`External orbital potentials (!ORBPOT)` pushing the two nickel sublattices in
opposite directions to break the symmetry, then a second run continued from it
with the nudge removed, to see whether the ordering survives on its own. Fork
the first, clear the field, `Continue from restart`, run.

## 9. Chapter 8: convergence

The course's convergence chapters are four sweeps, and the `Sweeps` panel makes
and runs them.

Press `New sweep…`. A sweep varies **one parameter of an existing
calculation**, which is how the question is actually asked, so pick the
reference run in `Vary a parameter of`, choose the `Parameter`, and give the
`Values` — either a list (`20 30 40 50`) or a range (`20:50:10`). Then `Create
sweep` and `Run remaining points`.

The four exercises:

| Chapter | Reference | Parameter | Values | Restart? |
|---|---|---|---|---|
| 8.2 | converged non-magnetic iron | `Plane-wave cutoff (wave functions)` | `20 25 30 35 40 50 60 70` Ry | **yes** |
| 8.3 | the same iron | `Density cutoff ratio (CDUAL)` | `2:6:1` | no |
| 8.4 / 6.3.6 | silicon | `k-point density R` | `10:50:10` bohr | no |
| 8.5 | water | the cell size (not a parameter — see below) | 8 to 18 Å in steps of 2 | no |

Those are the course's own eight cutoffs; its command for the same scan is a
`paw_scan -r "EPWPSI 20 25 30 35 40 50 60 70"`. Iron because a late 3d
transition metal is the worst case for a plane-wave basis.

`Continue each point from this calculation` is the course's own distinction and
it changes the answer, not just the cost. Restarted from one converged
reference, a cutoff sweep measures the cutoff alone (8.2); left off, every point
converges on its own, which is what the density-cutoff and cell-size scans need
(8.3, 8.5).

`Converged within` states the answer instead of leaving it to the eye: it
reports the smallest x from which the energy stays inside the tolerance —
1 mH by default, which is what a total energy is quoted to. Under the energy,
a second chart plots how large the basis actually got at each point, which is
the cost side of the same question (the course's Fig. 8.1).

The cell-size sweep (8.5) varies the *structure* rather than a parameter, so it
is the one the panel cannot build: use the `sweep water-cell-size` runner from
§2, or write the six structures yourself and make a calculation from each.

## 10. Following the course without CP-PAW

Every panel above works on an ASE calculator, and the `ase_builtin` backend
needs nothing installed:

* **Chapters 2 and 4** — pick `ase_builtin`, `Calculator ▸ EMT (effective medium
  theory)` (or `Open Babel force field` with MMFF94 for an organic molecule),
  `Task ▸ Geometry optimization (BFGS)`. The convergence plot, the
  geometry tables, the trajectory playback and the `Sweeps` panel all behave the
  same; only the energies are different physics.
* **Chapter 5** — `Task ▸ Molecular dynamics (Langevin)` runs a trajectory with
  EMT, which plays back and plots exactly like the CP-PAW one.
* **Chapter 6** — EMT knows the metals, so silicon is out but aluminium and
  copper work; the E(V) fit of §7 works on an EMT sweep and gives a bulk
  modulus you can compare with the tabulated one.
* **Chapters 3, 7** — orbitals, DOS, bands and spin need a DFT code. What you
  can still do is import someone else's output: `File ▸ Open…` reads the formats
  in `Import`, and a `.cube` file becomes an isosurface.
* **Vibrations** (not in the course, but next door) — the `Spectra` tab computes
  normal modes from a force field with no external code at all, and §12's
  thermochemistry runs on those.

## 11. What Atomscope cannot do yet

Two of the course's exercises have no route here, and two figure families do
not. This is the honest list; each is a real gap, not a decision.

* **6.3.3 — empty atoms.** The exercise puts extra, electron-less sites in the
  interstitial volume of silicon and projects the DOS onto them, which is how
  the course shows where the bonding charge sits (its Fig. 6.2). The CP-PAW
  schema has no empty-site species, so neither the deck nor the projection can
  be written.
* **6.3.5 — the lattice constant by cell dynamics.** The course relaxes the
  *cell* and reads the lattice constant off it. There is no cell-dynamics option
  in the schema. The equation-of-state sweep of §7 answers the same question by
  a different route — and gives B₀ and B′ as well — so the physics of the
  chapter is reachable; the method is not.
* **Fig. 8.4 — several DOS curves overlaid.** One DOS at a time; there is no
  overlay across calculations. **Fig. 6.8** wants the free-electron √E curve
  drawn beside aluminium's DOS, which is also not there.
* **Figs 4.9, 5.7 — video files.** The trajectory player animates in the
  application, and images export as PNG or SVG, but there is no video writer.

## 12. Past the course: surfaces, thermochemistry, scripting

Three things Atomscope has that the course does not, each a chapter's worth on
its own:

**Surfaces and adsorbates** (§4.4a of the [user guide](../user-guide.md)).
`Build ▸ Surface slab…` builds a named surface — fcc(111), bcc(110), hcp(0001)
and eight more — which carries its **named adsorption sites**, and the `Crystal`
tab then grows an `Adsorbate` section: pick `fcc` or `bridge`, name an element
or one of ASE's molecules, give a height. That is the surface chemistry the
course's molecules and solids are the two halves of.

**Thermochemistry** (§8.8a). Compute normal modes in `Spectra`, then the
`Thermochemistry` section under them turns the frequencies into ZPE, entropy and
a free energy at a temperature — the harmonic model for an adsorbate, the ideal
gas for a molecule, the hindered translator/rotor for something that hops
between sites.

**Python, in the application** (§9). The `Scripts` tab runs Python with the
structure on screen as an `ase.Atoms`, and `context().project_root` is the open
project — so a script can read what every calculation in it produced. Each one
keeps a `calculation.json`, and its energy is at
`results.properties.energy.value`, in eV:

```python
import json

from atomscope.scripting import context, value

project = context().project_root
energies = {}
for path in sorted(project.glob('calculations/*/calculation.json')):
    calc = json.loads(path.read_text())
    energy = ((calc.get('results') or {}).get('properties') or {}).get('energy')
    if energy is not None:
        energies[calc['name']] = energy['value']

value('calculations with an energy', len(energies))
for name in sorted(energies)[:3]:
    value(name, energies[name])
```

Run against the course project of §2 that prints 29 calculations and their
totals — the whole course as one table, which is what the convergence chapters
keep asking you to build by hand. An adsorption energy is then one subtraction
in the same dictionary:

```python
value(
    'adsorption energy / eV',
    energies['slab + CO'] - energies['clean slab'] - energies['CO'],
)
```

with the names being whatever you called the three runs (the `Name` field of
the `Calculation` tab).

`Analysis ▸ Dynamics` draws the distance-against-time plot of Fig. 5.6 without
any of this (§6). What a script adds is the arithmetic the panel does not offer
— a fit to the curve, a histogram of the transfer times, anything you would
otherwise take to a second program. CP-PAW writes its trajectory in its own
binary format, `<root>_r.tra`, and the reader for it is part of Atomscope:

```python
import numpy as np

from atomscope.backends.cppaw.tra import read_position_trajectory
from atomscope.scripting import context, value

# every run keeps its files in its own directory under the project
work = context().project_root / 'calculations' / '<calculation id>' / 'work'
frames = read_position_trajectory(next(work.glob('*_r.tra')), n_atoms=len(atoms))

# the proton transfer: one O-H distance against time
positions = np.array(frames.positions_ang)      # (steps, atoms, 3), in angstrom
distance = np.linalg.norm(positions[:, 3] - positions[:, 0], axis=1)

value('frames', len(distance))
value('shortest O-H / A', distance.min())
for t, d in zip(frames.times_fs, distance):
    print(f'{t:10.4f} {d:8.4f}')      # two columns, in the output pane
```

`value()` is for the numbers you want at a glance; a series of a few hundred
rows belongs in `print`, which the output pane shows in a monospace column you
can copy straight into whatever you plot with. Or fit it in the script — scipy
is right there. The per-atom-group temperature of Figs 5.4 and 5.5 is the
same shape: sum ½*m*v² over the carbons and over the hydrogens separately,
divide by (3/2)*N*k_B, and average over a window. A script is not a substitute
for a panel, but it is the difference between "not possible" and "not yet a
button".

## Where to go next

* [Tutorial 1](01-water-cppaw.md) — chapter 2 and 3 in full, step by step.
* [Tutorial 2](02-silicon-crystal.md) — chapter 6's silicon, with symmetry and
  slabs.
* [Tutorial 3](03-force-field-and-conformers.md) — the force-field side, which
  the course does not cover and which is how you get a sensible starting
  geometry.
* [The user guide](../user-guide.md) — every panel, in reference form.
* [`docs/course/inventory.md`](../course/inventory.md) — the same course as a
  table, exercise by exercise, with the status of each and what was measured
  while implementing it. [`figures.md`](../course/figures.md) does it by figure:
  all 35, with what draws each one.
