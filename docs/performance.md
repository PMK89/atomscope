# Performance

Every number in this document comes from the harness in `backend/benchmarks/` or from
`frontend/e2e/perf.spec.ts`. Nothing here is an estimate; where something is *not* measured it
says so.

## How to reproduce

```bash
make bench                     # quick: 1e3/1e4 atoms, 80^3 grids, 200 frames  (~5 min)
make bench-full                # every size, including 1e5 atoms and 256^3 grids (~35 min)
make test-perf                 # renderer benchmark; needs dev-backend and dev-frontend running
```

Results land in `.scratch/bench/` as `results-<tag>.json` plus `summary-<tag>.md`.
`python -m benchmarks.run --full --tag after --compare .scratch/bench/results-baseline.json`
renders the after/before table used below; `--report <json>` re-renders a summary without
re-running anything. (The `Makefile` uses `$(ROOT)/.venv`, which exists in the main checkout,
not inside a worktree; from a worktree call `python -m benchmarks.run` directly with
`PYTHONPATH=backend/src`.)

## Hardware and software

| | |
| --- | --- |
| CPU | Intel Core i7-6800K, 6 cores / 12 threads, 3.4 GHz (4.0 GHz turbo) |
| RAM | 62 GiB |
| Disk | NVMe SSD |
| GPU | NVIDIA RTX 3090, 24 GB — **not used by any measurement here** |
| OS | Ubuntu 26.04.1, kernel 7.0.0-30 |
| Python | 3.12.13, NumPy 2.5.2, pydantic 2.13.5, ASE 3.26.0, SciPy 1.18.1 |
| Browser | headless Chromium 1234 (Playwright 1.62) with `--use-gl=swiftshader` |

**The frontend numbers are software-rasterised WebGL.** SwiftShader runs the whole pipeline on
the CPU, so the absolute frame rates below are far lower than what the RTX 3090 would produce.
They are still useful as *relative* numbers between structure sizes and between geometry
variants, and one conclusion (see "Renderer") is hardware-independent because it is about
triangle counts, not fill rate.

## Method

* **One child process per case.** `resource.getrusage` reports a process-lifetime high-water
  mark, so measuring several cases in one process would report the maximum over everything run
  before. Each case is executed by `python -m benchmarks.run --child --case <name>`, which
  prints one JSON line; the parent collects it, applies a per-case timeout and a 24 GiB
  address-space cap (a runaway case must not swap the machine).
* **Setup is not timed.** A case factory prepares its inputs and returns the callable to time.
  Fixtures (files, grids, trajectories) are generated once into `.scratch/bench/fixtures/`
  before the run, so a timeout measures work rather than fixture generation.
* **Repeats**: 5 at 1e3 atoms, 3 at 1e4, 1 at 1e5; 3 / 2 / 1 for the 80³ / 160³ / 256³ grids;
  3 for 200-frame and 1 for 1000-frame trajectories. The reported wall time is the median; the
  JSON also carries the minimum.
* **Peak RSS** is the child's `ru_maxrss`. Importing the model and IO stack alone is ~90 MB and
  importing the API stack ~166 MB (`baseline.imports`); subtract that from any row.
* **Data.** Periodic: `ase.build.bulk("Cu", cubic=True).repeat(r)` with r = 6/14/29, giving
  864 / 10 976 / 97 556 atoms of dense FCC copper (12 neighbours per atom — the worst case for
  bond perception). Molecular: 3 / 31 / 306 copies of `1CRN.pdb` (crambin, 327 atoms) from the
  Avogadro 1 test files, placed on a 30 Å lattice: 981 / 10 137 / 100 062 atoms with a realistic
  element mix and bond density. Grids: sums of four Gaussians at 80³, 160³ and 256³.
  Trajectories: 200 and 1000 frames of 100 atoms, both as a synthetic CP-PAW `_r.tra` (Fortran
  sequential records) and as extended XYZ with per-frame energies.
* **Caveat on single-repeat rows.** At 1e5 atoms each case runs once. Two baseline runs of the
  same unchanged code gave 636 ms and 864 ms for `api.get_structure.1e5` — a 36 % spread. Treat
  differences below ~1.4x at 1e5 as noise; the wins claimed below are far larger, except where
  explicitly called out.
* **Frontend.** The spec drives the real application: it creates a project through the API,
  PUTs the structures, opens them by clicking the entry in the project panel, and measures
  inside the page with `performance.now()`. "First render" ends on the first frame in which the
  atom `InstancedMesh` has the full instance count, detected from the `Renderer.onFrame` hook;
  the start timestamp is set one CDP round trip before the click, which biases it by a few ms.
  The API fetch is subtracted using `performance.getEntriesByType('resource')` so backend and
  renderer costs are separated. Orbiting is driven by `CameraController.orbit()` inside a
  `requestAnimationFrame` loop rather than by synthetic pointer events, so the rate measures
  rendering and not input plumbing; the window runs for at least 4 s *and* at least 5 frames
  (capped at 120 s) so that a system drawing one frame every 50 s still yields a number.
* **Production instrumentation.** The only additions to shipped code are `Renderer.frameCount`
  (one integer increment per frame) and `Renderer.onFrame` (a null check per frame, never set by
  the application). `window.__atomscopeRenderer` is guarded by `import.meta.env.DEV`; the string
  does not appear anywhere in `dist/assets/*.js` after `pnpm build`.

## Backend: measured before and after

`before` is commit `170d692` (the branch point), `after` is this branch; both were produced
by `python -m benchmarks.run --full` on an otherwise idle machine. Ratios below ~1.4x at 1e5
atoms are within run-to-run noise -- the rows that matter are re-measured back to back in
"A/B rows" below.

#### structure IO

| case | items | before | after | ratio | peak RSS (after) | note |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `io.ase_read.xyz.1e3` | 864 | 1 ms | 1 ms | 1.02x | 91 MB | ase.io.read only, 0.1 MB file |
| `io.read.xyz.1e3` | 864 | 11 ms | 5 ms | 2.38x | 143 MB | read_structure, no perception |
| `io.write.xyz.1e3` | 864 | 3 ms | 3 ms | 0.93x | 143 MB | write_structure -> .xyz |
| `io.ase_read.extxyz.1e3` | 864 | 2 ms | 2 ms | 0.96x | 91 MB | ase.io.read only, 0.0 MB file |
| `io.read.extxyz.1e3` | 864 | 8 ms | 5 ms | 1.61x | 143 MB | read_structure, no perception |
| `io.write.extxyz.1e3` | 864 | 4 ms | 4 ms | 0.92x | 143 MB | write_structure -> .extxyz |
| `io.ase_read.cif.1e3` | 864 | 3.03 s | 3.47 s | 0.87x | 92 MB | ase.io.read only, 0.1 MB file |
| `io.read.cif.1e3` | 864 | 2.87 s | 2.75 s | 1.04x | 145 MB | read_structure, no perception |
| `io.write.cif.1e3` | 864 | 5 ms | 6 ms | 0.76x | 144 MB | write_structure -> .cif |
| `io.ase_read.pdb.1e3` | 981 | 8 ms | 6 ms | 1.19x | 91 MB | ase.io.read only, 0.1 MB file |
| `io.read.pdb.1e3` | 981 | 13 ms | 9 ms | 1.40x | 143 MB | read_structure, no perception |
| `io.write.pdb.1e3` | 981 | 3 ms | 3 ms | 1.00x | 143 MB | write_structure -> .pdb |
| `io.read_perceive.xyz.1e3` | 864 | 509 ms | 15 ms | 33x | 146 MB | read_structure with bond perception |
| `io.ase_read.xyz.1e4` | 10,976 | 30 ms | 33 ms | 0.92x | 94 MB | ase.io.read only, 0.8 MB file |
| `io.read.xyz.1e4` | 10,976 | 164 ms | 100 ms | 1.65x | 153 MB | read_structure, no perception |
| `io.write.xyz.1e4` | 10,976 | 39 ms | 33 ms | 1.17x | 152 MB | write_structure -> .xyz |
| `io.ase_read.extxyz.1e4` | 10,976 | 42 ms | 19 ms | 2.16x | 95 MB | ase.io.read only, 0.6 MB file |
| `io.read.extxyz.1e4` | 10,976 | 136 ms | 87 ms | 1.56x | 153 MB | read_structure, no perception |
| `io.write.extxyz.1e4` | 10,976 | 70 ms | 45 ms | 1.56x | 154 MB | write_structure -> .extxyz |
| `io.ase_read.cif.1e4` | 0 | **timed out (>60 s)** | **timed out (>60 s)** | - | - |  |
| `io.read.cif.1e4` | 0 | **timed out (>60 s)** | **timed out (>60 s)** | - | - |  |
| `io.write.cif.1e4` | 10,976 | 59 ms | 59 ms | 0.99x | 157 MB | write_structure -> .cif |
| `io.ase_read.pdb.1e4` | 10,137 | 104 ms | 64 ms | 1.61x | 98 MB | ase.io.read only, 0.8 MB file |
| `io.read.pdb.1e4` | 10,137 | 149 ms | 108 ms | 1.38x | 153 MB | read_structure, no perception |
| `io.write.pdb.1e4` | 10,137 | 31 ms | 32 ms | 0.97x | 152 MB | write_structure -> .pdb |
| `io.read_perceive.xyz.1e4` | 10,976 | **timed out (>180 s)** | 356 ms | **was impossible** | 196 MB | read_structure with bond perception |
| `io.ase_read.xyz.1e5` | 97,556 | 1.61 s | 1.58 s | 1.02x | 123 MB | ase.io.read only, 7.0 MB file |
| `io.read.xyz.1e5` | 97,556 | 3.05 s | 2.26 s | 1.35x | 236 MB | read_structure, no perception |
| `io.write.xyz.1e5` | 97,556 | 356 ms | 350 ms | 1.02x | 236 MB | write_structure -> .xyz |
| `io.ase_read.extxyz.1e5` | 97,556 | 191 ms | 178 ms | 1.07x | 124 MB | ase.io.read only, 5.3 MB file |
| `io.read.extxyz.1e5` | 97,556 | 1.23 s | 864 ms | 1.43x | 235 MB | read_structure, no perception |
| `io.write.extxyz.1e5` | 97,556 | 458 ms | 439 ms | 1.04x | 246 MB | write_structure -> .extxyz |
| `io.ase_read.cif.1e5` | 0 | **timed out (>60 s)** | **timed out (>60 s)** | - | - |  |
| `io.read.cif.1e5` | 0 | **timed out (>60 s)** | **timed out (>60 s)** | - | - |  |
| `io.write.cif.1e5` | 97,556 | 590 ms | 554 ms | 1.06x | 258 MB | write_structure -> .cif |
| `io.ase_read.pdb.1e5` | 100,062 | 639 ms | 640 ms | 1.00x | 157 MB | ase.io.read only, 8.1 MB file |
| `io.read.pdb.1e5` | 100,062 | 1.95 s | 1.32 s | 1.47x | 247 MB | read_structure, no perception |
| `io.write.pdb.1e5` | 100,062 | 409 ms | 329 ms | 1.24x | 239 MB | write_structure -> .pdb |
| `io.read_perceive.xyz.1e5` | 97,556 | **MemoryError** | 4.97 s | **was impossible** | 620 MB | read_structure with bond perception |

#### bond perception

| case | items | before | after | ratio | peak RSS (after) | note |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `bonds.periodic.1e3` | 864 | 32 ms | 28 ms | 1.17x | 108 MB | periodic FCC Cu, 5184 bonds |
| `bonds.molecular.1e3` | 981 | 604 ms | 5 ms | 115x | 94 MB | molecular crambin copies, 1899 bonds |
| `bonds.periodic.1e4` | 10,976 | 599 ms | 511 ms | 1.17x | 254 MB | periodic FCC Cu, 65856 bonds |
| `bonds.molecular.1e4` | 10,137 | **timed out (>180 s)** | 78 ms | **was impossible** | 114 MB | molecular crambin copies, 19623 bonds |
| `bonds.periodic.1e5` | 97,556 | 6.48 s | 7.03 s | 0.92x | 1277 MB | periodic FCC Cu, 585336 bonds |
| `bonds.molecular.1e5` | 100,062 | **MemoryError** | 975 ms | **was impossible** | 311 MB | molecular crambin copies, 193698 bonds |

#### ASE bridge

| case | items | before | after | ratio | peak RSS (after) | note |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `bridge.to_atoms.1e3` | 864 | 404 us | 418 us | 0.97x | 91 MB | Structure -> ase.Atoms |
| `bridge.from_atoms.1e3` | 864 | 6 ms | 4 ms | 1.82x | 91 MB | ase.Atoms -> Structure |
| `bridge.roundtrip.1e3` | 864 | 4 ms | 4 ms | 0.98x | 92 MB | Structure -> Atoms -> Structure |
| `bridge.to_atoms.1e4` | 10,976 | 5 ms | 5 ms | 1.01x | 101 MB | Structure -> ase.Atoms |
| `bridge.from_atoms.1e4` | 10,976 | 90 ms | 52 ms | 1.72x | 101 MB | ase.Atoms -> Structure |
| `bridge.roundtrip.1e4` | 10,976 | 84 ms | 80 ms | 1.05x | 114 MB | Structure -> Atoms -> Structure |
| `bridge.to_atoms.1e5` | 97,556 | 80 ms | 62 ms | 1.30x | 184 MB | Structure -> ase.Atoms |
| `bridge.from_atoms.1e5` | 97,556 | 934 ms | 766 ms | 1.22x | 184 MB | ase.Atoms -> Structure |
| `bridge.roundtrip.1e5` | 97,556 | 774 ms | 819 ms | 0.95x | 299 MB | Structure -> Atoms -> Structure |

#### model + project store

| case | items | before | after | ratio | peak RSS (after) | note |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `model.validate_bonded.1e3` | 864 | 11 ms | 10 ms | 1.10x | 104 MB | structure with 5,184 bonds (Structure._consistent runs over all of them) |
| `model.assign_bonds.1e3` | 864 | 2 ms | 2 ms | 1.42x | 104 MB | validate_assignment re-check of 5,184 bonds |
| `bridge.to_atoms_bonded.1e3` | 864 | 13 ms | 4 ms | 2.91x | 104 MB | Structure -> ase.Atoms with 5,184 bonds |
| `model.validate_dict.1e3` | 864 | 2 ms | 2 ms | 1.23x | 91 MB | from a plain dict |
| `model.model_dump.1e3` | 864 | 919 us | 763 us | 1.20x | 91 MB | model_dump(mode='json') |
| `model.dump_json.1e3` | 864 | 554 us | 591 us | 0.94x | 91 MB | pydantic JSON, 0.1 MB |
| `model.store_dump_json.1e3` | 864 | 7 ms | 991 us | 6.62x | 91 MB | sorted+indented project JSON, 0.2 MB |
| `model.validate_json.1e3` | 864 | 2 ms | 3 ms | 0.62x | 92 MB | parse 0.1 MB of JSON |
| `project.save_structure.1e3` | 864 | 7 ms | 1 ms | 4.91x | 92 MB | ProjectStore.save_structure (disk) |
| `project.load_structure.1e3` | 864 | 3 ms | 4 ms | 0.61x | 93 MB | ProjectStore.load_structure (disk) |
| `model.validate_bonded.1e4` | 10,976 | 326 ms | 295 ms | 1.11x | 241 MB | structure with 65,856 bonds (Structure._consistent runs over all of them) |
| `model.assign_bonds.1e4` | 10,976 | 58 ms | 30 ms | 1.91x | 241 MB | validate_assignment re-check of 65,856 bonds |
| `bridge.to_atoms_bonded.1e4` | 10,976 | 114 ms | 34 ms | 3.40x | 241 MB | Structure -> ase.Atoms with 65,856 bonds |
| `model.validate_dict.1e4` | 10,976 | 28 ms | 26 ms | 1.08x | 108 MB | from a plain dict |
| `model.model_dump.1e4` | 10,976 | 9 ms | 9 ms | 1.04x | 103 MB | model_dump(mode='json') |
| `model.dump_json.1e4` | 10,976 | 7 ms | 8 ms | 0.97x | 103 MB | pydantic JSON, 1.1 MB |
| `model.store_dump_json.1e4` | 10,976 | 87 ms | 15 ms | 5.98x | 106 MB | sorted+indented project JSON, 2.0 MB |
| `model.validate_json.1e4` | 10,976 | 65 ms | 65 ms | 0.99x | 115 MB | parse 1.1 MB of JSON |
| `project.save_structure.1e4` | 10,976 | 116 ms | 15 ms | 7.55x | 106 MB | ProjectStore.save_structure (disk) |
| `project.load_structure.1e4` | 10,976 | 71 ms | 75 ms | 0.95x | 124 MB | ProjectStore.load_structure (disk) |
| `model.validate_bonded.1e5` | 97,556 | 3.29 s | 2.82 s | 1.17x | 1254 MB | structure with 585,336 bonds (Structure._consistent runs over all of them) |
| `model.assign_bonds.1e5` | 97,556 | 570 ms | 336 ms | 1.70x | 1254 MB | validate_assignment re-check of 585,336 bonds |
| `bridge.to_atoms_bonded.1e5` | 97,556 | 912 ms | 322 ms | 2.83x | 1254 MB | Structure -> ase.Atoms with 585,336 bonds |
| `model.validate_dict.1e5` | 97,556 | 515 ms | 497 ms | 1.03x | 246 MB | from a plain dict |
| `model.model_dump.1e5` | 97,556 | 108 ms | 107 ms | 1.01x | 190 MB | model_dump(mode='json') |
| `model.dump_json.1e5` | 97,556 | 83 ms | 73 ms | 1.13x | 200 MB | pydantic JSON, 10.3 MB |
| `model.store_dump_json.1e5` | 97,556 | 822 ms | 123 ms | 6.69x | 224 MB | sorted+indented project JSON, 18.5 MB |
| `model.validate_json.1e5` | 97,556 | 538 ms | 564 ms | 0.95x | 309 MB | parse 10.3 MB of JSON |
| `project.save_structure.1e5` | 97,556 | 863 ms | 188 ms | 4.60x | 211 MB | ProjectStore.save_structure (disk) |
| `project.load_structure.1e5` | 97,556 | 638 ms | 629 ms | 1.01x | 385 MB | ProjectStore.load_structure (disk) |

#### volumetric grids

| case | items | before | after | ratio | peak RSS (after) | note |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `grid.read_cube.80` | 512,000 | 64 ms | 65 ms | 0.99x | 110 MB | 80^3 ASCII cube, 7 MB |
| `grid.write_cube.80` | 512,000 | 451 ms | 192 ms | 2.35x | 113 MB | 80^3 ASCII cube |
| `grid.write_sidecar.80` | 512,000 | 2 ms | 2 ms | 0.95x | 117 MB | 80^3 float32 sidecar, 2 MB |
| `grid.load_values.80` | 512,000 | 234 us | 244 us | 0.96x | 117 MB | 80^3 sidecar read |
| `grid.stats.80` | 512,000 | 14 ms | 14 ms | 0.99x | 117 MB | 80^3 isovalue statistics |
| `grid.read_cube.160` | 4,096,000 | 559 ms | 553 ms | 1.01x | 199 MB | 160^3 ASCII cube, 57 MB |
| `grid.write_cube.160` | 4,096,000 | 4.09 s | 1.55 s | 2.63x | 278 MB | 160^3 ASCII cube |
| `grid.write_sidecar.160` | 4,096,000 | 9 ms | 11 ms | 0.85x | 281 MB | 160^3 float32 sidecar, 16 MB |
| `grid.load_values.160` | 4,096,000 | 3 ms | 3 ms | 1.02x | 281 MB | 160^3 sidecar read |
| `grid.stats.160` | 4,096,000 | 106 ms | 105 ms | 1.01x | 281 MB | 160^3 isovalue statistics |
| `grid.read_cube.256` | 16,777,216 | 2.28 s | 2.24 s | 1.02x | 538 MB | 256^3 ASCII cube, 235 MB |
| `grid.write_cube.256` | 16,777,216 | 15.19 s | 6.44 s | 2.36x | 860 MB | 256^3 ASCII cube |
| `grid.write_sidecar.256` | 16,777,216 | 34 ms | 36 ms | 0.95x | 862 MB | 256^3 float32 sidecar, 67 MB |
| `grid.load_values.256` | 16,777,216 | 14 ms | 14 ms | 0.99x | 862 MB | 256^3 sidecar read |
| `grid.stats.256` | 16,777,216 | 477 ms | 447 ms | 1.07x | 862 MB | 256^3 isovalue statistics |

#### trajectories

| case | items | before | after | ratio | peak RSS (after) | note |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `traj.tra_read.200` | 200 | 2 ms | 2 ms | 1.26x | 96 MB | CP-PAW _r.tra, 200 frames x 100 atoms |
| `traj.ase_import.200` | 200 | 126 ms | 112 ms | 1.12x | 153 MB | extxyz via ASE, 200 frames x 100 atoms, 1 MB |
| `traj.export_extxyz.200` | 200 | 145 ms | 108 ms | 1.34x | 154 MB | Trajectory -> extxyz text, 200 frames |
| `traj.positions_stream.200` | 200 | 5 ms | 4 ms | 1.21x | 151 MB | binary positions endpoint payload build |
| `traj.tra_read.1000` | 1,000 | 17 ms | 15 ms | 1.12x | 104 MB | CP-PAW _r.tra, 1000 frames x 100 atoms |
| `traj.ase_import.1000` | 1,000 | 609 ms | 489 ms | 1.25x | 172 MB | extxyz via ASE, 1000 frames x 100 atoms, 6 MB |
| `traj.export_extxyz.1000` | 1,000 | 633 ms | 547 ms | 1.16x | 187 MB | Trajectory -> extxyz text, 1000 frames |
| `traj.positions_stream.1000` | 1,000 | 23 ms | 22 ms | 1.04x | 173 MB | binary positions endpoint payload build |

#### API round trip

| case | items | before | after | ratio | peak RSS (after) | note |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `api.put_structure.1e3` | 864 | 19 ms | 13 ms | 1.49x | 191 MB | PUT /api/structures (parse + validate + save), 0.1 MB body |
| `api.get_structure.1e3` | 864 | 6 ms | 9 ms | 0.71x | 191 MB | GET /api/structures (load + response_model), 0.1 MB body |
| `api.list_structures.1e3` | 864 | 8 ms | 6 ms | 1.24x | 191 MB | GET /api/structures (summaries; loads every structure) |
| `api.put_structure.1e4` | 10,976 | 220 ms | 141 ms | 1.57x | 223 MB | PUT /api/structures (parse + validate + save), 1.1 MB body |
| `api.get_structure.1e4` | 10,976 | 69 ms | 55 ms | 1.26x | 226 MB | GET /api/structures (load + response_model), 1.1 MB body |
| `api.list_structures.1e4` | 10,976 | 49 ms | 51 ms | 0.96x | 226 MB | GET /api/structures (summaries; loads every structure) |
| `api.put_structure.1e5` | 97,556 | 1.90 s | 1.21 s | 1.58x | 504 MB | PUT /api/structures (parse + validate + save), 10.3 MB body |
| `api.get_structure.1e5` | 97,556 | 864 ms | 723 ms | 1.20x | 518 MB | GET /api/structures (load + response_model), 10.3 MB body |
| `api.list_structures.1e5` | 97,556 | 677 ms | 678 ms | 1.00x | 515 MB | GET /api/structures (summaries; loads every structure) |

## What was fixed

Ordered by the size of the measured effect.

### 1. Bond perception for non-periodic structures: O(N^2) memory in ASE

`ase.neighborlist.neighbor_list` falls back to an all-pairs search when the `Atoms` object has
no cell, and allocates an `(2, N, N)` int64 index array. Measured:

| atoms | before | after |
| ---: | --- | --- |
| 981 | 604 ms | 5 ms (115x) |
| 10 137 | did not finish in 180 s | 78 ms |
| 100 062 | `MemoryError: unable to allocate 149 GiB for shape (2, 100062, 100062)` | 975 ms |

`atomscope.chem.bonds` now uses `scipy.spatial.cKDTree.query_pairs` for non-periodic structures
and keeps ASE's neighbour list for periodic ones, where its minimum-image handling of triclinic
cells is worth having. `tests/chem/test_bonds.py::test_molecular_and_periodic_paths_agree` pins
that the two paths return the same bonds for the same molecule (once free, once inside a 100 Å
periodic box).

The same defect made reading any large molecular file impossible, because `read_structure`
perceives bonds when the format carries none:

| case | before | after |
| --- | --- | --- |
| `io.read_perceive.xyz.1e3` | 509 ms | 15 ms (33x) |
| `io.read_perceive.xyz.1e4` | did not finish in 180 s | 356 ms |
| `io.read_perceive.xyz.1e5` | `MemoryError` (142 GiB) | 4.97 s |

### 2. Placing one atom in a large document froze the browser for a minute

`model/connectivity.ts::perceiveBondsForAtom` called `findBond()` (a linear scan of the bond
list) inside its loop over all atoms, so it was O(atoms x bonds). It runs on every atom placed
by the draw tool and once per atom in the Cartesian editor. Measured in Node with the harness's
`model helpers` case, 100 000 atoms and 97 872 bonds:

| | before | after |
| --- | ---: | ---: |
| `model.perceive_bonds_for_atom.1e5` | 58 471 ms | 25.9 ms (2260x) |

The partners of the atom are now collected into a `Set` once, before the loop.

### 3. Project JSON was serialised twice

`project/manifest.py::dump_json` produced `model.model_dump(mode="json")` and then ran the
result through `json.dumps(sort_keys=True, indent=2)`. pydantic can emit indented JSON directly;
its field order (declaration order) is as stable and as diff-friendly as sorting.

| case | before | after |
| --- | ---: | ---: |
| `model.store_dump_json.1e5` | 822 ms | 123 ms (6.7x) |
| `project.save_structure.1e5` | 863 ms | 188 ms (4.6x) |
| `api.put_structure.1e5` | 1.90 s | 1.21 s (1.6x) |

Files written by earlier versions still load; the first re-save reorders their keys once.
`tests/project/test_store.py` now pins the new byte layout and that identical content produces
identical bytes.

### 4. `to_atoms` called `model_dump()` once per bond

The ASE bridge stores bonds, residues and properties in `atoms.info["atomscope"]`. Bonds are
four plain scalars, so a full pydantic dump per bond was pure overhead.

| case | before | after |
| --- | ---: | ---: |
| `bridge.to_atoms_bonded.1e5` (585 336 bonds) | 912 ms | 322 ms (2.8x) |
| `bridge.to_atoms_bonded.1e4` | 114 ms | 34 ms (3.4x) |

### 5. The bond consistency check ran element-wise on every assignment

`Structure` has `validate_assignment=True`, so `structure.bonds = ...` and
`structure.provenance = ...` each re-run `_consistent` over the whole bond list.
`_check_bonds` is now vectorised (two `np.fromiter` passes plus one `np.unique` on a packed
key); the element-wise loop is kept only to produce the exact error message when the fast check
fails, so the existing "outside 0..N" and "duplicate bond" messages are unchanged.

| case | before | after |
| --- | ---: | ---: |
| `model.assign_bonds.1e5` | 570 ms | 336 ms (1.7x) |
| `model.validate_bonded.1e5` | 3.33 s | 2.57 s (1.3x, A/B) |

### 6. The cube writer formatted every value separately

`write_cube` built each line with six f-strings and a `join`. One `%` format per line produces
byte-identical output; `tests/parsers/test_cube.py` compares the bytes against the old writer.

| case | before | after |
| --- | ---: | ---: |
| `grid.write_cube.256` (16.8M values) | 15.19 s | 6.44 s (2.4x) |
| `grid.write_cube.160` | 4.09 s | 1.55 s (2.6x) |
| `grid.write_cube.80` | 451 ms | 192 ms (2.4x) |

### 7. `new_uid` built a UUID object

`uuid.uuid4().hex[:12]` and `os.urandom(6).hex()` produce the same 48 random bits in the same
format; the first costs 2.3 us, the second 0.8 us. Over 100 000 atoms that is 0.23 s of the
0.93 s `from_atoms` took. Together with converting positions in one `tolist()` instead of three
`float()` calls per atom:

| case | before | after |
| --- | ---: | ---: |
| `bridge.from_atoms.1e5` | 904 ms | 699 ms (1.3x, A/B) |
| `io.read.xyz.1e5` | 3.05 s | 2.26 s (1.35x) |
| `io.read.pdb.1e5` | 1.95 s | 1.32 s (1.47x) |

### 8. Bond dedup and the periodic path

`np.unique(pairs, axis=0)` lexsorts a structured view; a packed `a * N + b` int64 key is twice
as fast and produces the same (a, b) ordering.

### 9. `GET /api/structures/{id}`: a memory win, not a speed win

Returning a `Structure` makes FastAPI dump the model, re-validate the dump against
`response_model` and encode it again. The route now returns `Response(model.model_dump_json())`;
`response_model` still documents the schema and the exported OpenAPI document is byte-identical
(verified against `frontend/src/api/openapi.json`).

Four back-to-back A/B pairs gave 641/689/721/764 ms before and 782/750/729/728 ms after: **no
measurable wall-time change**, because at 1e5 atoms the request is dominated by
`model_validate_json` of the file on disk (~620 ms). Peak RSS, however, drops from 631 MB to
518 MB (-18 %), reproducibly. The change is kept for that reason and reported honestly.

### 10. Secondary structure: the bridge search was a full residue pair loop

`_assign_codes` tested every residue pair for a beta bridge, which is O(residues^2) in Python.
Every bridge pattern needs a hydrogen bond between the pair or their immediate neighbours, so the
candidates now follow from the hydrogen bonds that were found. Measured on 1CRN (46 residues)
tiled to 1012 residues, 7194 atoms: **0.66 s -> 0.19 s** for `secondary.analyse`, with the same
assignment string for 1CRN. The remainder is the hydrogen-bond search itself, which is vectorised
per donor with a 9 A alpha-carbon prefilter.

### A/B rows

Some 1e5 rows in the big table are within run-to-run noise or were disturbed by the preceding
case's memory footprint. These were re-measured back to back, alternating the two versions of
`backend/src` via `PYTHONPATH` in an otherwise identical process:

| case | before | after | ratio |
| --- | ---: | ---: | ---: |
| `bonds.periodic.1e5` | 6.10 s | 4.49 s | 1.36x |
| `model.validate_bonded.1e5` | 3.33 s | 2.57 s | 1.30x |
| `bridge.from_atoms.1e5` | 904 ms | 699 ms | 1.29x |
| `api.put_structure.1e5` | 1.93 s | 1.20 s | 1.61x |
| `api.get_structure.1e5` | 641-764 ms | 728-782 ms | 1.0x (RSS 631 -> 518 MB) |
| `project.load_structure.1e5` | 605-640 ms | 620-667 ms | 1.0x |
| `model.validate_dict.1e5` | 504 ms | 537 ms | 1.0x |
| `grid.stats.256` | 444 ms | 440 ms | 1.0x |
| `traj.ase_import.1000` | 524 ms | 519 ms | 1.0x |

## Attempts that the measurements rejected

Kept here because they look obvious and are not:

* **`Bond.model_construct` instead of `Bond(...)`.** Skipping validation is *slower*: 2.67 s
  against 1.39 s for 500 000 bonds. `model_construct` is a Python-level loop over the field
  definitions, while `Bond(...)` goes straight into pydantic-core. Reverted.
* **`Atom.model_construct` plus bulk pre-validation in `from_atoms`.** 0.78 s against 0.74 s for
  100 000 atoms — no gain, and it moved `Atom`'s validators out of the reading path. Reverted;
  `from_atoms` validates every atom as before.
* **A `TypeAdapter(list[Bond])` bulk validation.** 1.22 s against 1.31 s for 500 000 bonds: the
  per-model cost is the floor, not the per-call overhead.
* **Optimising the marching cubes implementation.** A 128³ grid already meshes in 217 ms in the
  worker, which is not what makes a large structure slow. Left alone.

## What is still slow, and why

Each item has the measurement that says so.

* **ASE's CIF reader is O(N^2).** `ase.io.read(..., format="cif")` takes 2.9 s for 864 atoms and
  does not finish within 60 s for 10 976. A profile shows 4.1 s of 4.3 s inside
  `ase.spacegroup.spacegroup.equivalent_sites`, which compares every expanded site against every
  kept site to remove duplicates; it runs even for P1 cells. This is entirely inside ASE -- the
  same file read as extxyz takes 19 ms. Writing CIF is unaffected (59 ms at 1e4 atoms). Large
  periodic systems should be exchanged as extxyz until this is worked around.
* **Periodic bond perception is 4.5 s at 1e5 atoms.** The remaining time splits into ASE's
  `neighbor_list` (2.86 s for 1.17M pairs) and constructing 585 336 `Bond` models (1.76 s). The
  second number is the floor of the explicit data model: `Bond(...)`, `Bond.model_construct(...)`
  and `TypeAdapter(list[Bond]).validate_python(...)` all cost 2.4-5.3 us per bond. Replacing
  ASE's neighbour search with a `cKDTree(boxsize=...)` would help for orthorhombic cells only and
  needs positions wrapped into the cell first; it is not done here.
* **Validating a stored structure costs ~6 us per atom.** `project.load_structure.1e5` is 629 ms
  and `model.validate_json.1e5` is 564 ms, essentially all of it inside pydantic-core building
  97 556 `Atom` models. `model_dump_json` in the other direction is only 73 ms, so reading is
  the expensive direction. A binary positions endpoint like the trajectory one would avoid this
  for the *renderer*, but the browser's fetch is not the bottleneck at these sizes (see below),
  so it is not justified by the measurements yet.
* **`GET /api/structures` (the summary list) loads every structure in the project**: 678 ms for
  one 1e5-atom structure, and it scales with the total size of the project rather than with the
  number of entries. Caching name/formula/atom count in `project.json` would fix it, but that is
  a project-format change.
* **Reading a large cube is ASCII-parse bound**: 2.24 s for 256^3 (235 MB of text) at ~100 MB/s
  inside `np.fromstring(sep=" ")`. The binary sidecar path that grids use once imported is 160x
  faster (14 ms for the same 16.8M values), so this only affects the initial import.
* **`grid.stats` sorts the whole field** (440 ms at 256^3) to find the isovalue that encloses
  80 % of the integrated density. A histogram would be faster but would change the number.
* **Marching cubes needs no work**: a 128^3 grid meshes and reaches the screen in 217 ms.
* **`editor/cartesian.ts` still calls `perceiveBondsForAtom` once per atom**, so applying the
  Cartesian editor to a large structure remains O(N^2) even after the fix above. That file is
  outside the scope of this branch.

## Renderer

The renderer benchmark loads carbon/nitrogen/oxygen lattices of 1e3 / 1e4 / 1e5 atoms with
roughly one bond per atom into the real application, then orbits. `before` is the same spec run
against the branch point; `after` is this branch. Single measurements, headless Chromium with
SwiftShader.

| case | before | after | detail |
| --- | ---: | ---: | --- |
| `structure.open_total.1e3` | 305.9 ms | 682.8 ms | 1,000 atoms, 900 bonds, click -> first complete frame (fetch + normalise + build + draw) |
| `structure.api_fetch.1e3` | 224.1 ms | 598.5 ms | 1,000 atoms, 900 bonds, GET /api/structures/perf13 as seen by the browser |
| `structure.first_render.1e3` | 81.8 ms | 84.3 ms | 1,000 atoms, 900 bonds, open_total minus the API fetch: normalise + layer rebuild + first draw |
| `structure.orbit_fps.1e3` | 1.6 fps | 2.1 fps | 1,000 atoms, 900 bonds, 9 frames in 4.3 s of continuous orbit |
| `structure.orbit_fps_lowpoly.1e3` | - | 11.3 fps | 1472 -> 80 triangles per sphere (_SphereGeometry 1, 8, 6); 46 frames in 4.1 s |
| `structure.open_total.1e4` | 429.6 ms | 166.2 ms | 10,000 atoms, 9,516 bonds, click -> first complete frame (fetch + normalise + build + draw) |
| `structure.api_fetch.1e4` | 152.3 ms | 73.3 ms | 10,000 atoms, 9,516 bonds, GET /api/structures/perf14 as seen by the browser |
| `structure.first_render.1e4` | 277.3 ms | 92.9 ms | 10,000 atoms, 9,516 bonds, open_total minus the API fetch: normalise + layer rebuild + first draw |
| `structure.orbit_fps.1e4` | 0.1 fps | 0.2 fps | 10,000 atoms, 9,516 bonds, 5 frames in 20.4 s of continuous orbit |
| `structure.orbit_fps_lowpoly.1e4` | - | 1.5 fps | 1472 -> 80 triangles per sphere (_SphereGeometry 1, 8, 6); 7 frames in 4.6 s |
| `structure.open_total.1e5` | 1954.2 ms | 1598.3 ms | 100,000 atoms, 97,791 bonds, click -> first complete frame (fetch + normalise + build + draw) |
| `structure.api_fetch.1e5` | 1556.2 ms | 1186.3 ms | 100,000 atoms, 97,791 bonds, GET /api/structures/perf15 as seen by the browser |
| `structure.first_render.1e5` | 398.0 ms | 412.0 ms | 100,000 atoms, 97,791 bonds, open_total minus the API fetch: normalise + layer rebuild + first draw |
| `structure.orbit_fps.1e5` | 0.0 fps | 0.0 fps | 100,000 atoms, 97,791 bonds, 4 frames in 172.6 s of continuous orbit |
| `structure.orbit_fps_lowpoly.1e5` | - | 0.2 fps | 1472 -> 80 triangles per sphere (_SphereGeometry 1, 8, 6); 5 frames in 31.1 s |
| `model.perceive_bonds_for_atom.1e5` | 58471.2 ms | 25.9 ms | 100,000 atoms, 97,872 bonds |
| `model.adjacency.1e5` | 24.0 ms | 34.8 ms | 100,000 atoms, 97,872 bonds |
| `model.fragments.1e5` | 65.6 ms | 42.9 ms | 100,000 atoms, 97,872 bonds |
| `isosurface.grid_import.128` | 885.0 ms | 414.0 ms | backend cube parse + float32 transfer of 2,097,152 voxels |
| `isosurface.first_mesh.128` | 216.7 ms | 199.1 ms | Add surface -> first frame with mesh (worker marching cubes at step 1) |

### Reading the table

* **Opening a structure is dominated by the API fetch, not by the renderer.** At 1e5 atoms:
  1.19 s of the 1.60 s from click to first frame is the `GET /api/structures/{id}` round trip,
  and 0.41 s is parsing the JSON body, normalising the document, building the instanced meshes
  and drawing (`PerformanceResourceTiming.duration` ends at `responseEnd`, so `response.json()`
  of the 10 MB body falls on the render side of the split). The backend work described above
  shows up here as 1.56 s -> 1.19 s on the fetch.
* **Ignore the 1e3 row when comparing before and after.** It is the first structure opened after
  `page.goto`, so it carries JIT warm-up and the first connection through the Vite proxy; the
  backend serves that same structure in 9 ms (`api.get_structure.1e3`). The 1e4 and 1e5 rows are
  the meaningful ones: 152 -> 73 ms and 1556 -> 1186 ms on the fetch.
* **First render is not the problem; the second frame is.** Building the scene for 100 000 atoms
  takes 0.41 s once. *Orbiting* then runs at 4 frames in 172.6 s -- one frame every 43 seconds.
  At 10 000 atoms it is 5 frames in 20.4 s (0.24 fps) and at 1 000 atoms 9 frames in 4.3 s
  (2.1 fps). A thousand-atom molecule already cannot be rotated smoothly.
* **The cause is triangle count, and that part is hardware-independent.**
  `StructureLayer` uses `SphereGeometry(1, 32, 24)` -- 1472 triangles per atom, measured from
  the geometry -- and `CylinderGeometry(1, 1, 1, 24, 1, true)` for each of the two halves of a
  bond, 48 triangles each. A 100 000-atom structure with 97 791 bonds is therefore
  100 000 x 1472 + 2 x 97 791 x 48 = **157 million triangles per frame**, every frame, with no
  level of detail and `frustumCulled = false` on both meshes. No GPU draws 157 M triangles at
  60 Hz; an RTX 3090 would be perhaps two orders of magnitude faster than SwiftShader here, which
  still leaves a 100 000-atom scene far from interactive.
* **The counterfactual confirms it.** Swapping the sphere for `SphereGeometry(1, 8, 6)`
  (80 triangles) *in the running page*, changing nothing else, gives 2.1 -> 11.3 fps at 1e3
  atoms (5.4x), 0.24 -> 1.52 fps at 1e4 (6.3x) and 0.023 -> 0.161 fps at 1e5 (7.0x). The
  swap is done by the benchmark through the renderer handle; no production code was changed.
* **Marching cubes is fine.** A 128^3 grid goes from "Add surface" to a drawn mesh in 199 ms,
  and importing the grid (backend cube parse plus the float32 transfer to the page) takes
  414 ms. Neither warranted work.
* **Placing an atom no longer freezes the tab**: `perceiveBondsForAtom` on a 100 000-atom
  document went from 58.5 s to 25.9 ms (2260x). `adjacency` (35 ms) and `fragments` (43 ms) on
  the same document were already linear.

### `StructureLayer` findings

The measurements above were taken before the level-of-detail fix; findings 2 and 3 still stand.

1. **Level of detail — fixed after the merge.** The sphere and cylinder tessellations used to be
   constants. `StructureLayer.geometryFor` now picks one of three tiers from the number of
   *visible* atoms (so toggling hydrogens re-picks, because that goes through `rebuild`):

   | atoms | sphere | triangles/atom | cylinder | triangles/bond half |
   | --- | --- | ---: | --- | ---: |
   | < 2 000 | 32x24 | 1472 | 24 sides | 48 |
   | < 20 000 | 16x12 | 352 | 12 sides | 24 |
   | >= 20 000 | 8x6 | 80 | 6 sides | 12 |

   Triangle counts read off the geometries themselves. The coarse tier is the swap the 5-7x
   counterfactual above was measured with, so **the orbit frame rates in the "Renderer" section
   describe the code before this fix**; they have not been re-measured since. The remaining step,
   if a hundred-thousand-atom system ever has to orbit smoothly, is impostor spheres (a
   camera-facing quad with a ray-traced normal in the fragment shader), which makes the cost
   independent of tessellation entirely.
2. **`applyColors` rewrites every instance colour on every hover change.** It loops over all
   visible atoms and both halves of every bond, calling `elementBySymbol` and `setColorAt` --
   about 300 000 operations and a full `instanceColor` upload per pointer move at 1e5 atoms.
   Caching the base colours in a `Float32Array` and only touching the atoms whose selection or
   hover state changed would make it O(changed).
3. **`frustumCulled = false`** on both meshes. Harmless when the whole structure is in view,
   but it removes any chance of culling when zoomed in on part of a large system.

Picking was not measured separately: with frames taking seconds, raycasting over 1e5 instanced
spheres is not what a user notices first. It is the natural next thing to measure once the
tessellation is fixed.

