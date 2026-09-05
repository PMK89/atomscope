# Tutorial 1 — Water with CP-PAW

This is the first example of the CP-PAW hands-on course (chapters 2.7, 2.8 and
3), done entirely inside Atomscope: build a water molecule, converge its wave
functions, read the total energy and the gap, relax the geometry, export the
electron density and look at the molecular orbitals.

**Time:** about 5 minutes of computer time, most of it waiting for three short
CP-PAW runs.

**You need:** a working CP-PAW installation. If you do not have one, read
[§9](#9-following-along-without-cp-paw) first — the build-and-measure parts of
this tutorial work anyway, and the Open Babel and ASE backends give you
something to run.

All numbers below were produced on the reference workstation of this project —
an Intel Core i7-6800K (6 cores / 12 threads, 3.4 GHz), 62 GB RAM, Linux 7.0,
CP-PAW `aa467ef873` built 2025-05-07, **serial** (one core). Your energies
should match to the last digit for the same input; your timings will not.

---

## 1. Create a project

Start the two processes (`make dev-backend`, `make dev-frontend`) and open
<http://127.0.0.1:5173>.

In the **Project** panel on the left, type an absolute directory path — say
`/home/you/atomscope-projects/water` — and press **Create**. The panel now
shows the project name, its path, `Structures (0)` and `Calculations (0)`.

Everything this tutorial produces will land in that directory.

## 2. Build the molecule

`File ▸ Build from SMILES…`, and enter:

```
O
```

The viewport shows a water molecule. Atomscope asked RDKit to parse the SMILES,
add the hydrogens, embed the molecule in 3-D with ETKDGv3 (fixed seed, so this
is reproducible) and clean it up with MMFF94.

Check it with the **Measure** tool (`R`): click H, then O, then the other H.
The status bar reads

```
d12 = 0.969 Å   d23 = 0.969 Å   angle = 103.98°
```

Switch to the **Properties** tab and rename the structure to `water`, then
press **Save current structure** in the project panel. `Structures (1)` now
lists `water  H2O, 3 atoms`.

> If you prefer, draw it by hand instead: press `D` for the Draw tool, set the
> element to `O`, click once in the viewport, and let *Adjust hydrogens* add
> the two hydrogens for you.

## 3. Set up the wave-function optimization

Open the **Calculation** tab.

| Field | Value |
|---|---|
| `Name` | `water wave-function optimization` |
| `Backend` | `CP-PAW` |
| `Preset` | `Molecule: wave-function optimization` |

The preset is the course's chapter 2.7 setup: `task = single point`,
300 time steps, plane-wave cutoff `EPWPSI = 30 Ry`, `CDUAL = 2`. Everything
else stays at the schema default: PBE exchange-correlation, fixed occupations,
4 empty bands, a 4 Å vacuum margin around the molecule and `!ISOLATE`
electrostatic decoupling.

Now switch on the two analysis outputs, in the `Output and analysis` section:

* tick **Electron density (cube)**;
* set **Orbitals to export (band indices)** to `3`.

> That field takes **space-separated 1-based band numbers**. `3 4 5` exports
> three orbitals. A range such as `1-4` is silently ignored — you would get no
> orbital cube at all. You do not have to decide now: §8 shows how to export
> any orbital afterwards, on demand.

Press **Validate**. The report comes back empty — no errors, no warnings.

## 4. Look at the generated CNTL and STRC

Press **Generate input** and the panel switches to the **Generated input** tab.
Two files, exactly as they will be handed to `paw_fast.x`.

`case.strc` (role *structure*):

```
!STRUCTURE
  !GENERIC LUNIT[AA]=1.0 !END
  !LATTICE T=9.526662220963834 0.0 0.0 0.0 8.611093697480383 0.0 0.0 0.0 8.0 !END
  !ISOLATE !END
  !OCCUPATIONS NSPIN=1 EMPTY=4 CHARGE[E]=0.0 !END
  !SPECIES NAME='O_' ID='O_.75_6.0' NPRO=2 2 1 LRHOX=2 RAD/RCOV=1.4 !END
  !SPECIES NAME='H_' ID='H_.75_6.0' NPRO=1 1 LRHOX=2 RAD/RCOV=1.4 !END
  !ATOM NAME='O_1' R=0.007544053151178948 0.39774343120556577 0.0 !END
  !ATOM NAME='H_2' R=-0.7671031370575064 -0.18439316493074823 0.0 !END
  !ATOM NAME='H_3' R=0.7595590839063272 -0.21335026627481796 0.0 !END
!END
!EOB
```

Read it as the course teaches: `LUNIT[AA]=1.0` means the numbers are in
Ångström, not the CP-PAW default of Bohr. The molecule is not periodic, so
Atomscope put it in an orthorhombic box — its extent plus twice the 4 Å margin,
here 9.53 × 8.61 × 8.00 Å — and added `!ISOLATE` so the periodic images do not
see each other electrostatically. The species use CP-PAW's **internal** setups
`O_.75_6.0` and `H_.75_6.0`; no external setup file is needed. The projector
counts follow the usual rule: `1 1` for hydrogen, `2 2 1` otherwise.

`case.cntl` (role *control*):

```
!CONTROL
  !GENERIC START=T NSTEP=300 DT=5.0 NWRITE=50 ETOL=1.0E-05 AUTOCONV=20 !END
  !DFT TYPE=10 !END
  !FOURIER EPWPSI=30.0 CDUAL=2.0 !END
  !PSIDYN STOP=T FRIC=0.05 SAFEORTHO=T
    !AUTO FRIC(-)=0.3 FACT(-)=0.97 FRIC(+)=0.3 FACT(+)=1.0 MINFRIC=0.01 !END
  !END
  !ANALYSE
    !TRA R=T E=T !END
    !DENSITY TITLE='electron density' FILE='case_density.wv' TYPE='TOTAL' DR=0.4 !END
    !WAVE TITLE='band 3' FILE='case_b3.wv' B=3 K=1 S=1 DR=0.4 !END
  !END
!END
!EOB
```

`START=T` starts from random wave functions. There is **no `!RDYN` block**, so
the atoms do not move: this is a pure electronic-structure optimization, and
consequently CP-PAW will not print forces (see §7). `!PSIDYN FRIC=0.05` damps
the wave-function dynamics, and `!AUTO` is the *autopilot* that stops the run
once the total energy has changed by less than `ETOL = 10⁻⁵ H` for
`AUTOCONV = 20` consecutive steps. `STOP=T` in `!PSIDYN` does **not** mean
"stop when converged" — it means the initial wave-function velocities are zero.

Every value in the form has a `backend_path` telling it where to go, which is
why the form and the deck stay in step: `Time steps` is
`CONTROL/GENERIC/NSTEP`, `Plane-wave cutoff` is `CONTROL/FOURIER/EPWPSI`, and
so on. Generation is deterministic — the same values always give byte-identical
files.

Press **Save input files…** if you want the deck outside the project; you can
run it by hand with `paw_fast.x case.cntl` in exactly the same way.

## 5. Run it and watch the protocol

Press **Run**. The badge next to the calculation name goes `queued` →
`running`, and the **job console** below the viewport starts filling. First
Atomscope's own driver:

```
[atomscope] starting /home/pmk/cp-paw/bin/fast/paw_fast.x case.cntl in .../work
```

and then a live tail of `case.prot`, CP-PAW's protocol file, which is the file
the course tells you to `tail -f`. The banner, the *unused elements* check of
both decks, the setup construction reports, the file report, and then one `!>`
row per time step:

```
!>     1   0.00012     0   0.494559     17.482495     17.977054  0.3000  0.0000
!>     2   0.00024     0   1.700872     14.912291     16.613163  0.2910  0.0000
!>     3   0.00036     0   3.011118     10.870544     13.881662  0.2823  0.0000
...
!>   108   0.01306     0   0.000001    -17.311894    -17.311893  0.3000  0.0000
!>   109   0.01318     0   0.000001    -17.311894    -17.311894  0.0123  0.0000
```

The columns are the step, the elapsed simulation time in ps, the atomic
temperature, the wave-function kinetic energy, the total energy in Hartree and
the conserved energy, then the two frictions. Watch the fourth column fall
towards zero and the fifth settle: that is the electronic structure relaxing
onto the Born-Oppenheimer surface.

Near the end the autopilot fires:

```
 STOP SIGNAL FROM AUTOPILOT
 STOP SIGNAL RECEIVED
```

and CP-PAW writes its final reports and exits.

```
[atomscope] paw_fast.x exited with code 0 after 18.7 s
[atomscope] paw_wave.x case_density.wcntl -> case_density.cub
[atomscope] paw_wave.x case_b3.wcntl -> case_b3.cub
[atomscope] done
```

The two `paw_wave.x` calls are part of the same job: the `.wv` files CP-PAW
wrote are converted to Gaussian cubes automatically.

**Observed: 109 steps, 18.7 s of `paw_fast.x`, ~21 s wall clock for the whole
job.**

Atomscope does not trust the exit code alone — it checks that the protocol
contains CP-PAW's own `PROGRAM FINISHED` marker in the segment after the last
`PROGRAM STARTED` before calling the run complete.

## 6. Read the energy

Open the **Results** tab of the Calculation panel:

```
Energy: -471.080639 eV
Converged: true
Trajectory frames: 108
```

That is CP-PAW's `TOTAL ENERGY : -17.3118943 H` converted at the adapter
boundary — Atomscope stores everything in ASE units (eV, Å), and Hartree and
Bohr never leave the CP-PAW plugin. The full energy report from the protocol
survives in the result record:

| Term | Value (H) |
|---|---|
| TOTAL ENERGY | −17.3118943 |
| AE KINETIC | 17.8390975 |
| AE ELECTROSTATIC | −30.6048852 |
| AE EXCHANGE-CORRELATION | −4.5463291 |
| ISOLATE ENERGY | 0.0002226 |
| PS KINETIC | 9.0252601 |
| PS ELECTROSTATIC | 22.3632489 |
| PS EXCHANGE-CORRELATION | −3.7465184 |

The `ISOLATE ENERGY` of 0.2 mH is the electrostatic decoupling correction —
small, which tells you the 4 Å vacuum margin is generous enough.

The eigenvalues, from the protocol's last report:

| Band | E (eV) | Occupation | Label | Character |
|---|---|---|---|---|
| 1 | −25.298 | 2.00 | HOMO−3 | 2a₁ (O 2s) |
| 2 | −12.987 | 2.00 | HOMO−2 | 1b₂ (bonding, in-plane) |
| 3 | −9.296 | 2.00 | HOMO−1 | 3a₁ (lone pair, in-plane) |
| 4 | −7.197 | 2.00 | HOMO | 1b₁ (lone pair, out of plane) |
| 5 | −1.425 | 0.00 | LUMO | 4a₁ (antibonding) |
| 6 | 0.162 | 0.00 | LUMO+1 | |

giving a HOMO-LUMO gap of **5.772 eV** (the protocol's `ABSOLUTE GAP`, matched
by the `band_gap` property). PBE underestimates the real optical gap of water
substantially, as expected — this is a Kohn-Sham gap, not an excitation energy.

The Analysis tab's **Convergence** section plots the same information:
`Total energy` versus step, and, on a logarithmic axis, the wave-function
kinetic energy dropping by seven orders of magnitude.

CP-PAW's projected charges are attached to the result structure:
O −0.625 e, H +0.312 e each.

## 7. Relax the geometry

Chapter 2.8 of the course continues from the converged wave functions. In
Atomscope that is a **fork**.

With the finished calculation selected, press **Continue from restart**. A new
calculation `water wave-function optimization (continued)` appears, with the
parent's `case.rstrt` already copied into its working directory and `Start
from` set to `Restart file (START=F)`. It is a fresh draft, so the form is
editable again: choose `Task = Geometry optimization (damped dynamics)`, set
`Time steps` to 1000 and, in the advanced `Species and setups` section,
`Hydrogen mass (u)` to `2` — the course's trick of making hydrogen heavier so
larger time steps stay stable. A fork inherits the parent's values, so untick
`Electron density (cube)` and clear `Orbitals to export` unless you want the
cubes again.

> The `Name` field is not editable after a calculation exists: a fork is always
> called `<parent> (fork)` or `<parent> (continued)`. Only the parameter values
> can be changed.

Generate the input again and look at the new `case.cntl`:

```
!CONTROL
  !GENERIC START=F NSTEP=1000 DT=5.0 NWRITE=50 ETOL=1.0E-05 AUTOCONV=20 !END
  ...
  !RDYN STOP=T FRIC=0.1
    !AUTO FRIC(-)=0.0 FACT(-)=1.0 FRIC(+)=0.01 FACT(+)=1.0 !END
  !END
```

`START=F` and a `!RDYN` block: the atoms now move, with friction 0.1 and their
own autopilot. Because the atoms move, CP-PAW *does* print forces in the
`ATOMLIST REPORT`.

Run it. **Observed: 93 steps, 14.3 s.**

```
Energy: -471.086437 eV
```

and with the Measure tool on the loaded final structure: O–H = 0.978 Å,
H–O–H = 103.81°. But the forces from the last `ATOMLIST REPORT` are still
around 3 mH/Bohr — 0.152 eV/Å as the largest atomic force. The run stopped
because the *total energy* stopped changing, which is not the same as the
forces vanishing. Turn on `View ▸ Show force vectors` to see them.

So continue once more (**Continue from restart** again, which gives
`… (continued) (continued)`), tighten `ETOL` (advanced, in the `Task` section)
to `1e-7` and run. **Observed: 22 steps, about 10 s.**

| | O–H (Å) | H–O–H (°) | max &#124;F&#124; (eV/Å) | E (eV) |
|---|---|---|---|---|
| RDKit/MMFF94 start | 0.969 | 103.98 | — | — |
| after the first relaxation | 0.978 | 103.81 | 0.152 | −471.086437 |
| after the continuation | 0.980 | 103.80 | 0.014 | −471.086709 |
| experiment | 0.958 | 104.5 | | |

0.98 Å and 103.8° is the textbook PBE answer for water; PBE is known to
overestimate the O–H bond length by about 0.02 Å.

Load the trajectory (`Results ▸ Load trajectory`) and press play to watch the
molecule settle; the energy sparkline under the viewport shows the descent.

## 8. Density and orbitals

### The electron density

Open the **Surfaces** tab with the first (single-point) calculation selected.
The `Grids` list shows what the run produced:

```
electron density        electron density · 80 × 80 × 80 · e/bohr^3
orbital:3               orbital · 80 × 80 × 80 · e/bohr^3
```

Press **Add surface** on `electron density`. Marching cubes runs in a Web
Worker and a surface card appears with the backend's suggested isovalue,
**0.05616 e/bohr³** — the value that encloses 80 % of the integrated density.
You get the familiar rounded-triangle envelope of a water molecule.

Drag the **Isovalue** slider up to tighten the surface onto the O–H bonds, down
to see the diffuse tail. **Opacity** below 1 lets you see the atoms inside.

A sanity check you can do yourself: the grid integrates to **8.40 electrons**,
which is right — water has 8 valence electrons in the pseudo-density, plus the
augmentation tail that `paw_wave.x` puts on the grid.

### The orbitals

Open **Analysis ▸ Orbitals**. Every eigenvalue is listed with its occupation
and a HOMO/LUMO-relative label; a `●` marks the ones whose cube already exists
(band 3, because you asked for it in §3).

Select `4 · −7.197 · 2.00 · HOMO` (or just press the **HOMO** button) and press
**Show**.

The cube does not exist yet, so Atomscope makes it: it writes a one-step
restart control file under a separate root `case_orb`, runs `paw_fast.x` for
that single step (`.wv` files are only written in the last step of a run),
converts the result with `paw_wave.x`, registers the grid and adds a surface.
The job console shows the whole thing — the `case_orb.prot` of the one-step run
scrolls past and ends in `PROGRAM FINISHED`. **Observed: 8.1 s** from pressing
`Show` to the surface appearing, of which the CP-PAW run is about 3 s. Your
`case.prot`, `case.rstrt` and `case.pdos` are left untouched.

The surface comes up with **± pair** enabled, so you get both lobes: blue for
positive, red for negative.

![The water HOMO](../images/atomscope-overview.png)

Rotate the view (Navigate tool, left-drag) until you look along the molecular
plane. The HOMO is the 1b₁ lone pair — two lobes perpendicular to the
H–O–H plane, with essentially no amplitude on the hydrogens. Press **LUMO**
and **Show** to see the 4a₁ antibonding orbital instead, which does sit on the
hydrogens, along the O–H directions.

Viewed *face-on* the two lobes project on top of each other and look like a
single sphere; that is the camera, not the orbital. Rotate.

Compare with the eigenvalue table as you step through with the `−` and `+`
buttons: band 1 is the spherical O 2s shell, band 2 the in-plane bonding
combination, band 3 the in-plane lone pair, band 4 the out-of-plane lone pair.

## 9. Following along without CP-PAW

If `CP-PAW (not available)` is greyed out in the backend list, sections 1, 2
and the geometry measurements still work exactly as written. Replace sections
3–7 with one of these:

**Open Babel force fields** — the fastest option, and it needs nothing beyond
the standard install. Choose the backend `Open Babel force fields`,
`Force field = MMFF94`, `Task = Optimize geometry`, and run. You get a total
energy in eV *and* in kcal/mol, the individual force-field terms, and an
optimization trajectory. What you will not get is a gap, orbitals or an
electron density: a force field has no electrons.

**ASE built-in calculators** — choose `ASE workflows (built-in calculators or
CP-PAW)`, `Calculator = EMT`, `Task = Geometry optimization (BFGS)`. EMT is an
effective-medium potential parameterised for Al, Cu, Ag, Au, Ni, Pd and Pt,
with rough extra parameters for H, C, N and O; it will optimize water, but do
not read chemistry into the numbers. Lennard-Jones and Morse are also there for
teaching. This backend produces energies, forces and trajectories — enough to
follow §7 and the convergence charts of §6, but again no density and no
orbitals.

**Generate a deck for another code** — choose `Quantum chemistry input
generators`, program `ORCA`, task `Geometry optimization`, method `B3LYP`,
basis `def2-SVP`, and press `Generate input`. You get a complete `case.inp`
you can run wherever ORCA is installed. The `Run` button stays greyed out on
purpose, with the tooltip *This backend only generates input files*; the API
refuses it with `backend 'Quantum chemistry input generators' only generates
input files; run them with the target program`.

The same works for Gaussian, NWChem, GAMESS-US, Quantum ESPRESSO and ABINIT.

**Look at a real density anyway** — the Surfaces tab's `Import cube` reads any
Gaussian cube file that exists on the machine running the backend, so a density
produced elsewhere can be examined with the same isosurface controls.

## What you have now

Inside the project directory:

```
water/
  project.json
  structures/            water, plus one "(result)" structure per finished run
  calculations/
    <id-1>/  input/{case.cntl,case.strc,structure.json,values.json}
             work/   case.prot  case.rstrt  case.strc_out  case_r.tra
                     case_density.cub  case_b3.cub  case_orb_*.cub  driver.log ...
             results/results.json + one .f32 sidecar per grid
    <id-2>/  the relaxation, with the parent's restart file
    <id-3>/  the continuation
```

Every deck is exactly the one that ran, every protocol is untouched, and the
parameter values that produced them are stored next to them. You can hand the
directory to a colleague, or reopen it in six months and fork any of the three
runs.

## Where to go next

* [Tutorial 2 — Silicon](02-silicon-crystal.md): the periodic version of the
  same workflow, with k-points, DOS and a band structure.
* [Tutorial 3 — Force fields and conformers](03-force-field-and-conformers.md):
  no DFT required.
* [User guide §7](../user-guide.md#7-calculations) for the rest of the
  calculation machinery, and `docs/cppaw-analysis.md` for the CP-PAW input
  schema in full.
