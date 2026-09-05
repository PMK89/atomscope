# Provenance

Every file or idea taken from outside this repository is recorded here.
"Reimplemented from documentation/observation" means no source code was copied.

## Reference material on this workstation (read-only, never modified)

| Resource | Path | License | Use |
|---|---|---|---|
| CP-PAW distribution (dev version, hash aa467ef, built 2025-05-07) | `/home/pmk/cp-paw` (bin/fast, doc/manual.pdf, src/Docs/manual.tex) | GPL-3.0 | Executables, manual (input schema), tools |
| Prior "CP-PAW Web Workbench" (user-authored, inside the same repo) | `/home/pmk/cp-paw/backend`, `/home/pmk/cp-paw/frontend`, `/home/pmk/cp-paw/docs` | user's own work, in a GPL-3.0 repo | Domain knowledge, parser fixtures, known traps (see audit) |
| Historical ASE/CP-PAW interface `asecppaw` | `/home/pmk/ase-cp-paw` | declared MIT in `pyproject.toml`/`setup.cfg`, **no LICENSE file present**; author is the user | Calculator design, input generation, protocol parsing |
| Avogadro 1 source tree (`avogadro-master`) | `/media/pmk/SysEx/cs/paw/avogadro/avogadro-master` | GPL-2.0-or-later | Feature inventory; `fragments/` (382 CML) and `crystals/` (507 CIF) copied into `backend/src/atomscope/data/`, each with the Avogadro licence beside it; wavefunction and spectrum test fixtures copied from `testfiles/` into `backend/tests/fixtures/`, provenance recorded in the README next to them |
| CP-PAW hands-on course material | `/media/pmk/SysEx/cs/paw/{handson2022,hoc2w,Handson_2ndweek,paw_hoc}`, PDFs in `~/Documents` and `~/ase-cp-paw/docs` | course material, private | Reference calculations, validation |
| Real CP-PAW output set (H2O) | `/home/pmk/ase-cp-paw/calculations/h2o` | user's own | Golden parser fixtures |

## Copied material

| Destination | Source | License | Notes |
|---|---|---|---|
| `LICENSE` | `/home/pmk/cp-paw/LICENSE` (verbatim GPL-3.0 text) | GPL-3.0 | standard license text |
| `frontend/src/model/elements.ts` | generated from ASE data tables (`ase.data`, `ase.data.colors.jmol_colors`) by `scripts/gen_element_data.py` | ASE is LGPL-2.1+; the numeric data (Jmol CPK colors, Cordero covalent radii, Bondi/Alvarez vdW radii, IUPAC masses) are published scientific constants | regenerate, do not edit |
| `backend/src/atomscope/backends/cppaw/data/si2.cntl`, `si2.strc` | `/home/pmk/cp-paw/src/Docs/Examples/si2.*` (CP-PAW distribution example) | GPL-3.0 | health-check deck, verbatim |
| `backend/src/atomscope/backends/cppaw/data/manual-schema.json` | extracted from `/home/pmk/cp-paw/src/Docs/manual.tex` by the Phase 0 investigation (`.scratch/cppaw/schema/build_schema.py`) | GPL-3.0 (derived from the CP-PAW manual) | machine-readable block/key reference with manual line numbers |
| `backend/tests/fixtures/cppaw/**` | produced locally by running the installed CP-PAW on decks derived from the distribution example and the historical asecppaw water deck | outputs of a GPL program (not copyrighted program text); inputs derived from GPL-3.0 example | golden parser fixtures |
| `frontend/.playwright-browsers` (not committed) | Playwright Chromium download | BSD-3 (Chromium) | dev/test only, ignored by git |
| `backend/tests/fixtures/qc_outputs/{benzene.g03,methane.g03,methane.nwo}` | Avogadro 1 `testfiles/` | GPL-2.0-or-later | parser test fixtures |
