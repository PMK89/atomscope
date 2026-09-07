# Exported Atomscope project

Copied from `/home/pmk/Projects/atomscope/.scratch/course-runs/course`.

508 files, 36.9 MB.

## What was left out

| what | files | size | why |
|------|-------|------|-----|
| `grids` | 30 | 113.9 MB | the volumetric grids -- densities, orbitals, and their materialized form. These are the pictures, so leaving them out gives a project that reads but cannot draw a surface; re-running an example from its inputs regenerates them |
| `restart` | 23 | 683.0 MB | the wave functions; needed only to continue a run or extract a new orbital, and by far the largest thing in a project |
| `setup_reports` | 27 | 92.3 MB | the setup (pseudopotential) report, identical between every run that shares a setup and regenerable from the setups file |

Total left out: 889.2 MB.

## What that means

This copy opens, reads, plots and queries like any project. Everything already
computed is here: the inputs, the protocols, the parsed results and the grids.

It cannot be **continued from**, and no *new* orbital, band structure or density
can be extracted, because all of those read the restart file. Re-run the
calculation from its inputs if you need one.
