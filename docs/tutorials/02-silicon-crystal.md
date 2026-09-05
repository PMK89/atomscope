# Tutorial 2 — Silicon: symmetry, supercells, slabs, DOS and bands

The periodic counterpart of [tutorial 1](01-water-cppaw.md), following chapter 6
of the CP-PAW hands-on course. You will insert silicon from the crystal
library, let spglib tell you its space group, build a 2×2×2 supercell and a
(111) slab, run a CP-PAW single point with a real k-point mesh, and finish with
a density of states and a band structure.

**Time:** about 4 minutes, of which 95 s is the DFT run.

**You need:** CP-PAW for sections 5–8. Sections 1–4 (library, symmetry,
supercell, slab) work on any machine — they only need spglib and ASE, which
come with the standard install.

Numbers below are from the reference workstation: Intel Core i7-6800K, serial
CP-PAW `aa467ef873`.

---

## 1. Insert silicon from the crystal library

Create a project (Project panel ▸ path ▸ **Create**), then
`Build ▸ Crystal library…`.

The library holds **507 CIF entries in 22 categories** (elements, oxides,
silicates, zeolites, halides, intermetallics, …). Type `Si` in the `Search`
field — search ignores the category — and pick **`Si-Silicon  Si`**.

The viewport shows the conventional cubic diamond cell: **8 atoms,
a = b = c = 5.4307 Å**, with the unit-cell box drawn around it (`View ▸ Show
unit cell` is on by default).

> The alternative is to build it: `POST /api/crystal/bulk` with
> `{"symbol":"Si","crystalstructure":"diamond","a":5.43}` goes through ASE's
> `bulk()`. That endpoint has no user interface yet; the library is the
> supported route.

Save it (`Save current structure`). Note that the crystal operations in the
next sections modify the structure **in place** and keep its id, so saving
again after one of them replaces this entry; §3 shows the way around that.

## 2. Inspect the symmetry

Open the **Crystal** tab. The `Unit cell` section reports

```
Lattice     cubic · V = 160.165 Å³ · pbc TTT
```

and gives you the six lattice parameters, the raw 3×3 cell matrix and the
fractional coordinates, each editable with an `Apply`/`Reset` pair.

In the `Symmetry` section leave `Tolerance (Å)` at `0.001` and press
**Perceive**:

```
Space group   Fd-3m (227) · Hall F 4d 2 3 -1d
Point group   m-3m · cubic · 192 ops · 1 asymmetric
```

That is the diamond structure: space group 227, full Hermann-Mauguin
`F 4_1/d -3 2/m`, point group `m-3m` (O_h), 192 symmetry operations, and all
eight atoms on a single Wyckoff orbit (`8a`) — hence *1 asymmetric*.

The block greys out and is marked `(outdated)` as soon as you move an atom.
Raise the tolerance if a slightly distorted structure should still be
recognised.

Two useful operations sit right below:

* **Primitive** reduces the conventional cell to the two-atom rhombohedral
  primitive cell: **a = b = c = 3.8401 Å, α = β = γ = 60°, V = 40.04 Å³** —
  exactly a quarter of the conventional volume, as it must be for an
  F-centred lattice.
* **Asymmetric unit** keeps one atom; **Fill cell (group)** with `227` puts
  the other seven back.

Do the **Primitive** reduction now and save the result as well (it is the cell
you will run DFT on in §5).

> Reminder: crystal operations keep the structure's id, so `Save current
> structure` **overwrites** the entry you started from. To keep both the
> conventional and the primitive cell, save one, then re-insert the other from
> the library — a library insert gets a fresh id.

## 3. Make a supercell

Re-insert `Si-Silicon` (conventional cell) and choose `Build ▸ Supercell…`.
Enter `2 2 2` and press **Build supercell**.

You now have **64 atoms** in a **10.8614 Å** cube, V = 1281.32 Å³. Perceive the
symmetry again: still `Fd-3m (227)`, now with 1536 operations — 192 point
operations × 8 lattice translations. A supercell of a perfect crystal has the
same space group; what it buys you is room for a defect, a dopant or a phonon
that does not fit in the primitive cell.

The undo label is `Supercell 2x2x2`, so `Ctrl+Z` takes you back.

> `Build ▸ Supercell…` creates **real atoms**. If you only want to *see* more
> cells, use `Crystal ▸ Display ▸ Cell repeats` instead — that repeats the cell
> box in the display and creates nothing.

## 4. Cut a (111) slab

Press `Ctrl+Z` to undo the supercell (or re-insert `Si-Silicon` from the
library) so the conventional cell is back in the viewport, then choose
`Build ▸ Slab…`:

| Field | Value |
|---|---|
| `Miller indices h k l` | `1 1 1` |
| `Layers` | `6` |
| `Vacuum (Å)` | `10` |

Press **Build slab**. Result: **48 atoms**, cell 7.6802 × 7.6802 × 38.0286 Å,
and — the important part — **`pbc TTF`**: periodic in a and b, not in c. The
atoms occupy z = 10.0 … 28.03 Å in 12 distinct atomic planes, with 10 Å of
vacuum below and above.

Perceive the symmetry of the slab: `P-3m1 (164)`. Cutting the surface has
destroyed the cubic symmetry and left the three-fold axis perpendicular to the
(111) plane, which is what you would expect (this is an ideal, unreconstructed
and unpassivated surface — a real Si(111) reconstructs).

The number of atoms follows from the surface cell ASE derives from the cell you
hand it. Starting from the 8-atom conventional cell you get an 8-atom-per-layer
surface cell; start from the primitive cell instead and the slab is
correspondingly smaller.

Slabs are where the vacuum direction matters for DFT: with `pbc` false along c
Atomscope will not ask CP-PAW to sample k-points in that direction.

## 5. Run a CP-PAW single point

Load the **primitive** 2-atom cell (project panel), open the **Calculation**
tab and set:

| Field | Value |
|---|---|
| `Name` | `Si single point` |
| `Backend` | `CP-PAW` |
| `Preset` | `Solid (insulator): single point` |
| `Time steps` | `1000` |

The preset is the course's chapter 6 setup: `k-point sampling = Automatic from
real-space length R` with `R = 30 Bohr`, 5 empty bands, and `!ISOLATE` switched
off (it is a solid, the periodic images *should* interact).

**Generate input** and read the STRC:

```
!STRUCTURE
  !GENERIC LUNIT[AA]=1.0 !END
  !LATTICE T=0.0 2.71535 2.71535 2.71535 0.0 2.71535 2.71535 2.71535 0.0 !END
  !KPOINTS R=30.0 !END
  !OCCUPATIONS NSPIN=1 EMPTY=5 CHARGE[E]=0.0 !END
  !SPECIES NAME='SI' ID='SI_.75_6.0' NPRO=2 2 1 LRHOX=2 RAD/RCOV=1.4 !END
  !ATOM NAME='SI1' R=0.0 0.0 0.0 !END
  !ATOM NAME='SI2' R=1.3576749999999997 1.3576749999999997 1.3576749999999997 !END
!END
!EOB
```

The fcc primitive vectors, the second atom at (¼,¼,¼) of the conventional cell,
and `!KPOINTS R=30.0` instead of an explicit grid. `R` is a real-space length:
CP-PAW chooses a mesh with Δk ≈ 2π/R, so a larger `R` means a denser mesh. The
CNTL is the same wave-function optimization as in tutorial 1, without the
`!ANALYSE!DENSITY` and `!ANALYSE!WAVE` blocks.

If you would rather name the mesh yourself, switch `k-point sampling` to
`Explicit grid (DIV)` and enter e.g. `4 4 4`; `Γ point only` is there for
molecules in a box.

Press **Run** and watch the protocol in the job console. Early on it reports
what the k-point density bought you:

```
NUMBER OF K-POINTS.....................................:        112
```

**Observed: 181 steps, 95.3 s** (compare with 18.7 s for water — 112 k-points
is 112 times more wave functions to converge, which is exactly where the time
goes; the course's `R = 30` is a converged, not a cheap, setting).

Results tab:

```
Energy: -217.624143 eV
Converged: true
```

= −7.99756 H for two silicon atoms. The result also carries a `band_gap` of
**0.7686 eV** and a `direct_gap` of **2.5914 eV**.

## 6. Density of states

Open **Analysis ▸ DOS** with the finished calculation selected.

| Field | Value |
|---|---|
| `Broadening [eV]` | `0.1` |
| `Projection` | `Per element` |

Press **Compute DOS**. Atomscope writes a `.dcntl` control file, runs
`paw_dos.x` as a post-processing job (the job console shows its `case.dprot`),
and parses the `.dos` files it produces. **Observed: 6 s.**

![Silicon DOS](../images/silicon-dos.png)

The chart shows four curves — `total`, `Si`, `Si s`, `Si p` — over
−5.09 … 15.07 eV, with a dashed marker labelled `E_F` at the Fermi level
**7.409 eV**.

What to read out of it:

* The valence band runs from −5.1 eV to E_F with four resolved peaks
  (−2.2, 0.8, 3.7 and 4.9 eV). Its character changes across the band: below
  0 eV it is mostly **Si s** (integrating to 1.57 e s against 0.23 e p), while
  between 4 eV and E_F it is almost pure **Si p** (2.89 e against 0.14 e) —
  the sp³ hybrid resolved into its components.
* There is a clean gap immediately above E_F, followed by the conduction band.
* Integrating the *occupied* DOS gives **7.999 electrons**, i.e. exactly the
  8 valence electrons of Si₂. That is a good check that the broadening,
  the spin degeneracy and the energy grid are all being handled correctly.
  (Split per element: 7.51 e are assigned to the Si projectors — 2.67 e s-like
  and 4.42 e p-like — the remainder living in the interstitial region that no
  atomic projector claims.)

`Per atom` gives one set of curves per atom instead of per element; `Total only`
is the cheapest.

## 7. Band structure

Open **Analysis ▸ Bands**. The panel already shows the path:

```
Path: G – X – W – K – G – L – U – W – L – K – , – U – X
```

That is ASE's default high-symmetry path for an fcc lattice. The lone `,` is
the marker for a break in the path (between `K` and `U`); the chart renders it
as `K|U`.

Set `k-points per segment` to `40` and press **Compute bands**. Atomscope
writes a `.bcntl`, runs `paw_bands.x` in linear-interpolation mode against the
`case.pdos` file the main run left behind, and reads the resulting `.dat`.
**Observed: 5 s.**

The numbers, read from the band data (10 bands × 400 k-points, spin-restricted):

| Quantity | Value |
|---|---|
| Valence-band maximum | 7.405 eV, at **Γ** |
| Conduction-band minimum | 8.173 eV, near **X** |
| **Indirect gap** | **0.769 eV** |
| Direct gap at Γ | 2.591 eV |

So silicon comes out as the indirect-gap semiconductor it is, with the VBM at
Γ and the CBM along Γ–X. The PBE values (0.77 eV indirect, 2.59 eV direct at
Γ) sit where you would expect a semilocal functional to sit: experiment gives
1.17 eV and 3.4 eV. The band gap being too small by roughly a factor of 1.5 is
the usual DFT band-gap problem, not a mistake in your setup.

The indirect gap here agrees exactly with the `band_gap` the single-point run
reported (§5) — the same eigenvalues, once from the 112-point mesh and once
interpolated onto the path.

> **Two things to know today.**
>
> 1. The *chart* in the Bands section currently draws the axes and the
>    high-symmetry ticks but **not the band curves** — the data is correct and
>    complete, the plot is not. Until that is fixed, read the numbers from
>    Analysis ▸ Orbitals (which lists the eigenvalues of the self-consistent
>    mesh), from the protocol's `ABSOLUTE GAP` line, or from
>    `GET /api/cppaw/calculations/{id}/bands`.
> 2. `paw_bands.x` also has a `diagonalize` mode, which re-diagonalises the
>    Hamiltonian at each k-point instead of interpolating. It is slower and
>    more accurate — but a CP-PAW build older than the option rejects it with
>    `BANDS: MODE UNKNOWN … DIAG`, and Atomscope then hands back the previous
>    interpolated result rather than an error. If you need it, rebuild CP-PAW
>    from a current source tree; otherwise stay with the default.

Reading the gap straight from the eigenvalues instead:

```console
$ curl -s http://127.0.0.1:8765/api/cppaw/calculations/<id>/orbitals \
  | python3 -c 'import json,sys; [print(o["band"], o["energy"], o["label"]) for o in json.load(sys.stdin)["orbitals"][:6]]'
```

## 8. Convergence — the thing the course insists on

Chapter 8 of the hands-on course is entirely about convergence tests, and
Atomscope makes them cheap: fork the calculation, change one parameter, run.

* **Plane-wave cutoff.** Fork, set `Plane-wave cutoff (wave functions)` to 20,
  25, 30, 35, 40 Ry, run each. Plot total energy against cutoff.
* **k-points.** Fork and vary `k-point density R` (10, 20, 30, 40 Bohr). At
  `R = 30` this cell already needs 112 k-points; the energy should be flat well
  before that.
* **Density cutoff.** `CDUAL` multiplies the wave-function cutoff to give the
  density cutoff. 4 is exact, 2 is usually adequate — check it once for your
  system.

Each fork keeps its own directory, its own deck and its own protocol, so the
whole series is reproducible from the project alone. `Fork` (rather than
`Continue from restart`) is the right button here: you want a fresh `START=T`
run each time, not a continuation.

## 9. Without CP-PAW

Sections 1–4 need nothing but the standard install, and they are a complete
crystallography workflow in themselves: library, symmetry perception, primitive
and standardized cells, Niggli reduction, supercells, slabs, wrapping,
fractional-coordinate editing and volume scaling.

For section 5 onwards:

* the `Quantum chemistry input generators` backend writes a **Quantum
  ESPRESSO** `pw.x` deck for the same cell (`Program = espresso`,
  `Functional = PBE`, `Wave-function cutoff = 40 Ry`, `k-point grid = 4 4 4`)
  or an **ABINIT** input, ready to run wherever those codes are installed;
* the `ASE workflows` backend with the `EMT` calculator cannot help here —
  EMT has no silicon parameters and `Validate` reports the error
  `EMT has no parameters for ['Si']`. Use it on Cu, Al, Ag, Au, Ni, Pd or Pt
  if you want to exercise the periodic relaxation path;
* DOS, band structures and orbitals are CP-PAW-only in Atomscope today.

## Where to go next

* [Tutorial 3 — Force fields and conformers](03-force-field-and-conformers.md),
  which needs no external program at all.
* [User guide §8.5](../user-guide.md#85-crystallography) for the full list of
  crystallography operations.
* `docs/cppaw-analysis.md` §3.4 for every `!STRUCTURE` key, including the
  `!OCCUPATIONS!STATE` blocks you need for antiferromagnets, and §6 for the
  rest of the course's deck families (aluminium with Mermin occupations, iron,
  NiO, graphene).
