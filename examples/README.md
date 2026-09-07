# Example projects

Atomscope projects you can open directly: `Project path` in the left dock (or
`POST /api/project/open`) pointed at one of the directories here.

## `cppaw-handson-course/`

The 22 calculations of the CP-PAW hands-on course, run through Atomscope's own CP-PAW schema and
left as a project. Water (wave functions, relaxation, orbitals and DOS), an iron reference, an
eight-point plane-wave cutoff sweep, a five-point density-cutoff sweep and a five-point silicon
k-point sweep. `docs/course/inventory.md` maps them to the course's chapters and
`docs/course/figures.md` to its figures.

Three published numbers are reproduced here: water's geometry (0.9815 Å / 105.07° against the
course's 0.981 / 105.2°), silicon's indirect gap (0.776 eV against "about 0.8"), and the shape of
iron's cutoff convergence, which settles from 40 Ry. Absolute energies sit about 45 mH from the
course's, which is the installed code and setups rather than the deck — established by running
the course's own literal input file.

**What it does not contain.** The full project is 926 MB. This copy is 37 MB, because three kinds
of file are left out — `EXPORT.md` inside it has the byte counts:

| left out | why |
|----------|-----|
| restart files (`*.rstrt`, 683 MB) | the wave functions; needed only to continue a run or extract a new orbital |
| setup reports (`*.myxml`, 92 MB) | identical between runs sharing a setup, and regenerable from the setups file |
| volumetric grids (`*.cub`, `*.f32`, 114 MB) | the densities and orbitals — see below |

So everything **reads and plots**: energies, geometries, convergence traces, the densities of
states, the COOP, the band structures, and the whole set is queryable in the `Database` tab
(`Fe` → 14, `Si,epwpsi=30` → 5). What it cannot do without more work is **draw a surface** — the
grids are the pictures, and they are the one omission that costs one. Re-running an example
regenerates them:

```bash
cd backend
PYTHONPATH=src:../scripts/course ../.venv/bin/python -m run water-orbitals
```

That needs a working CP-PAW (found through `$PAWDIR`; see `docs/user-guide.md` § 7). Grids are
excluded rather than kept because, unlike the restart file they came from, they can be recomputed
— and 114 MB of binary blobs is not what a repository is for.

## Regenerating

```bash
make course-export                  # 37 MB, what is committed here
make course-export EXCLUDE=restart  # 151 MB, keeps the grids so surfaces draw at once
make course-export EXCLUDE=         # everything, restart files included
```

It reads `.scratch/course-runs/course/`, the project the exercise runners build, which is not in
this repository. `make course-export` fails with a pointer if it is not there.
