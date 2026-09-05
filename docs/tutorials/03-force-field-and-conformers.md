# Tutorial 3 — Force fields and conformers

A complete modelling workflow that needs **no external program**: build a
molecule from SMILES, add hydrogens, optimize it with MMFF94, run a conformer
search, compare the conformer energies, measure the geometry and export the
result. Everything here works on a stock Atomscope install — RDKit and Open
Babel come in as wheels with `make setup`.

**Time:** under a minute of computer time. The two calculations take about
2 seconds each.

The molecule is **n-butane**. It is the textbook case: one rotatable C–C bond,
an *anti* minimum and two *gauche* minima, and an energy difference that has
been measured. Small enough to see everything, real enough to check the answer.

Numbers below are from the reference workstation (Intel Core i7-6800K); MMFF94
energies are deterministic and should reproduce exactly.

---

## 1. Build it from SMILES

Create a project, then `File ▸ Build from SMILES…` and enter:

```
CCCC
```

The viewport shows n-butane with all 14 atoms — RDKit adds the hydrogens,
embeds the molecule with ETKDGv3 using a fixed random seed, and cleans it up
with MMFF94, so you get the same starting geometry every time.

Open the **Properties** tab: `Formula  C4H10`, `Atoms / bonds  14 / 13`.
Rename the structure to `butane` and press **Save current structure**.

### Building it without hydrogens first

If you want to see the hydrogens being added — the way Avogadro's *Add
Hydrogens* command works — build the heavy-atom skeleton first. The SMILES
builder always adds them, so use the Draw tool instead: switch the element to
`C` and click four times, or turn **Adjust hydrogens** off in the Draw tool
settings, draw the four carbons, and turn it back on.

The dedicated endpoint is there too, though it has no menu item yet:

```console
$ curl -s -X POST http://127.0.0.1:8765/api/io/smiles \
    -H 'content-type: application/json' -d '{"smiles":"CCCC","add_hydrogens":false}' > c4.json
   # → 4 atoms
$ curl -s -X POST http://127.0.0.1:8765/api/chem/add-hydrogens \
    -H 'content-type: application/json' -d "{\"structure\": $(cat c4.json)}" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d["atoms"]), "atoms,", len(d["bonds"]), "bonds")'
14 atoms, 13 bonds
```

## 2. What the force fields say about the starting geometry

Open the **Calculation** tab:

| Field | Value |
|---|---|
| `Name` | `butane MMFF94 single point` |
| `Backend` | `Open Babel force fields` |
| `Force field` | `MMFF94` |
| `Task` | `Calculate energy (and forces)` |

Press **Run**. It finishes instantly. The Results tab shows

```
Energy: -0.077164 eV
```

and the stored result also carries the energy in the force field's **own** unit
— MMFF94 reports **−1.7794 kcal/mol** — plus the individual terms:

| Term | eV |
|---|---|
| bond | +0.0824 |
| angle | +0.0123 |
| stretch-bend | −0.0003 |
| torsion | −0.3560 |
| out-of-plane | 0.0 |
| van der Waals | +0.1845 |
| electrostatic | 0.0 |

Reading a force-field total energy on its own is meaningless — the zero depends
entirely on the field's parameterisation. Only *differences within one force
field* mean anything, which is exactly what §4 uses. To see how arbitrary the
absolute number is, fork the calculation and change `Force field`:

| Force field | Energy of the same geometry |
|---|---|
| MMFF94 | −1.779 kcal/mol |
| UFF | 36.19 kJ/mol |
| GAFF | 18.77 kJ/mol |
| Ghemical | 40.28 kJ/mol |

Five different fields, five different numbers, no contradiction. Use MMFF94 or
MMFF94s for organic molecules, GAFF for small molecules destined for an AMBER
simulation, UFF when you need an element the others do not cover.

## 3. Optimize with MMFF94

Fork the calculation (or start a new one with `New`) and set:

| Field | Value |
|---|---|
| `Name` | `butane MMFF94 optimization` |
| `Task` | `Optimize geometry` |
| `Algorithm` | `Conjugate gradients` |
| `Number of steps` | `500` |
| `Convergence (energy change)` | `1e-6` |
| `Record a frame every N steps` (advanced) | `10` |

Press **Run**. **Observed: 2.0 s.**

```
Energy: -0.220114 eV
Converged: true
Trajectory frames: 9
```

= **−5.0760 kcal/mol**, so the optimization gained 3.30 kcal/mol over the
starting geometry.

Open **Analysis ▸ Convergence** and look at the `Total energy` chart — the
recorded energies are

```
-0.1510  -0.2131  -0.2181  -0.2195  -0.2199  -0.2201  -0.2201  -0.2201  -0.2201
```

which is what a well-behaved conjugate-gradient optimization looks like: most
of the drop in the first recorded interval, then a flat tail.

Press **Load trajectory** on the Results tab and play it back; then
**Load final structure** to bring the optimized geometry into the viewport.

> `Algorithm` and the optimization fields only appear when `Task` is
> `Optimize geometry` — the form hides parameters that do not apply, and hidden
> parameters are neither validated nor sent to the backend.

## 4. Measure the optimized geometry

Switch to the **Measure** tool (`R`) and click along the carbon chain.

| Measurement | Atoms | Value | Reference |
|---|---|---|---|
| C–C bond | C1–C2 | **1.5203 Å** | 1.531 Å (experiment) |
| C–C bond (central) | C2–C3 | **1.5273 Å** | |
| C–C–C angle | C1–C2–C3 | **111.48°** | 112.7° |
| C–C–C–C dihedral | C1–C2–C3–C4 | **−179.99°** | 180° (*anti*) |

Click the four carbons in order and the status bar shows all of it at once:

```
d12 = 1.520 Å   d23 = 1.527 Å   d34 = 1.520 Å   angle = 111.48°   dihedral = -179.99°
```

The optimizer found the *anti* conformer, as it should from a starting
geometry RDKit already cleaned up with MMFF.

The **Properties** tab gives the same information for one atom at a time:
select an atom and it shows the element, the exact position, the formal
charge, the label and the list of bonds with their orders and lengths.

## 5. Conformer search

This is the part a single optimization cannot do: an optimizer walks downhill
from where it starts, so it finds the nearest minimum, not the best one.

Start a new calculation:

| Field | Value |
|---|---|
| `Name` | `butane conformer search` |
| `Backend` | `Open Babel force fields` |
| `Force field` | `MMFF94` |
| `Task` | `Conformer search` |
| `Search method` | `Systematic rotor search` |
| `Number of conformers` | `10` |
| `Optimization steps per conformer` | `200` |

Press **Run**. **Observed: 2.0 s.**

A *systematic* search enumerates the rotor states exhaustively — for butane
there is one rotatable bond with three staggered states, so the search returns
**3 conformers** and the `Number of conformers` setting (which caps random and
weighted searches) does not bite. `Random` picks rotor states at random;
`Weighted` (the default) biases the sampling by energy and is the right choice
for anything with more than a handful of rotors.

Results:

```
Energy: -0.220074 eV       (the best conformer)
Trajectory frames: 3
```

`Load trajectory` and step through the three frames with the player. Measuring
the C–C–C–C dihedral in each:

| Conformer | C–C–C–C dihedral | Energy (eV) | Relative (kcal/mol) | Name |
|---|---|---|---|---|
| 3 | −179.4° | −0.2201 | **0.00** | *anti* |
| 1 | +63.8° | −0.1858 | **+0.79** | *gauche*⁺ |
| 2 | −62.1° | −0.1845 | **+0.82** | *gauche*⁻ |

That is the textbook picture: one *anti* minimum at 180°, two equivalent
*gauche* minima near ±60°, and a *gauche*–*anti* difference of about
0.8 kcal/mol. The experimental value is 0.9 kcal/mol, and the two *gauche*
conformers differ by 0.03 kcal/mol, which is numerical noise in the individual
optimizations rather than physics — by symmetry they are degenerate.

**Analysis ▸ Convergence** plots the same series, now labelled *conformer* on
the x axis instead of *step*, so you can see the spread at a glance.

The energy sparkline under the trajectory player shows it too, with a marker on
whichever conformer you are looking at.

> The conformer search honours any `FixAtoms` constraints on the structure, and
> the advanced `Extra constraints (JSON)` field takes extra distance, angle or
> torsion restraints, e.g.
> `[{"kind":"distance","atoms":[0,3],"value":3.9}]`.

## 6. Export

`File ▸ Export XYZ` downloads the current structure as plain XYZ:

```
14

C      -1.921578072424589     -0.154904866140144      0.164976578474664
C      -0.460779674172146     -0.164114879391557      0.586137182573106
C       0.461366478781484      0.164698852117563     -0.586132801781087
C       1.922174842168972      0.155285917666950     -0.165030804893543
H      ...
```

`File ▸ Export extended XYZ` writes the same coordinates plus a
`Properties=species:S:1:pos:R:3` line and an `atomscope=` field carrying the
things plain XYZ cannot express — bonds, formal charges, atom uids, charge and
multiplicity — so a round trip through extended XYZ is lossless.

`File ▸ Export CIF` is greyed out here, because butane has no unit cell.

To write a chemistry format that carries bond orders — MOL, SDF or MOL2 —
use the export endpoint with a path on the backend machine:

```console
$ curl -s -X POST http://127.0.0.1:8765/api/io/export \
    -H 'content-type: application/json' \
    -d "{\"structure\": $(cat butane.json), \"format\": \"sdf\", \"path\": \"/tmp/butane.sdf\"}"
```

(The RDKit and Open Babel writers can only write to a file, not return text
inline; the ASE-backed formats can do both.)

The whole trajectory — the three conformers — goes out through the trajectory
player's **Export XYZ** button, as an extended-XYZ file with the energy of each
frame in its comment line. That is a convenient hand-off to anything that reads
multi-frame XYZ.

## 7. Identifiers and charges

Two more things the backend can do that have no menu item yet, useful when you
are cataloguing structures:

```console
$ curl -s -X POST http://127.0.0.1:8765/api/chem/identifiers \
    -H 'content-type: application/json' -d "{\"structure\": $(cat butane.json)}"
{"smiles": "CCCC",
 "inchi": "InChI=1S/C4H10/c1-3-4-2/h3-4H2,1-2H3",
 "inchikey": "IJDNQMDRQITEOD-UHFFFAOYSA-N"}
```

`POST /api/chem/partial-charges` assigns partial charges with any of
`gasteiger` (the default), `mmff94`, `qeq`, `eem` or `qtpie`, returning the
structure with a `partial_charges` per-atom scalar property attached.
`POST /api/chem/aromaticity` reports ring and aromatic-ring counts,
`POST /api/chem/invert-chirality` flips a stereocentre, and
`POST /api/chem/h-to-methyl` turns hydrogens into methyl groups.

## 8. Where this fits

A force field is the right tool when you need a reasonable geometry quickly, a
starting point for something more expensive, or a conformer ensemble. It is the
wrong tool for electronic structure — no orbitals, no band gap, no charge
transfer, no bond breaking.

The natural continuation is to take the best conformer into a quantum
calculation:

* **With CP-PAW**: change the backend to `CP-PAW`, pick the preset
  `Molecule: geometry optimization`, and run — see
  [tutorial 1](01-water-cppaw.md).
* **Without**: switch to `Quantum chemistry input generators` and produce an
  ORCA, Gaussian, NWChem or GAMESS-US deck for the optimized geometry. Pressing
  `Run` is refused on purpose (`this backend only generates input files`);
  take the file from the `Generated input` tab.
* **ASE**: the `ASE workflows` backend can also drive an Open Babel force field
  through ASE's own BFGS optimizer and Langevin thermostat, if you want an MD
  trajectory rather than a conformer list.

Because the optimized geometry was saved into the project as
`butane MMFF94 optimization (result)`, any of these can start from it directly:
select it in the project panel, then set up the next calculation.

## Where to go next

* [Tutorial 1 — Water with CP-PAW](01-water-cppaw.md)
* [Tutorial 2 — Silicon](02-silicon-crystal.md)
* [User guide §8.6](../user-guide.md#86-force-fields)
