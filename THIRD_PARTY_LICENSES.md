# Third-party licenses and reused material

This file lists every external component whose code or data is redistributed
inside this repository, and the license under which it is used. Runtime
dependencies installed from PyPI/npm are listed by the lockfiles; this file
covers material copied into the tree. See `docs/provenance.md` for the
file-level record.

| Component | License | Used for | Location in tree |
|---|---|---|---|
| CP-PAW example deck si2 (P. E. Blöchl) | GPL-3.0 | CP-PAW health check | `backend/src/atomscope/backends/cppaw/data/si2.{cntl,strc}` |
| CP-PAW manual (schema extraction) | GPL-3.0 | machine-readable input reference | `backend/src/atomscope/backends/cppaw/data/manual-schema.json` |
| ASE data tables (Jmol colors, covalent/vdW radii, masses) | LGPL-2.1+ (ASE); scientific constants | element data for the renderer | `frontend/src/model/elements.ts` (generated) |
| Avogadro 1 crystal library (507 CIF files, mostly COD/AMCSD public-domain data) | GPL-2.0-or-later (Avogadro); see `LICENSE-avogadro.txt` and `README.md` there | crystal library browser | `backend/src/atomscope/data/crystals/` |
