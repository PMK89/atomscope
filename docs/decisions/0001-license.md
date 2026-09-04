# ADR 0001: Project license

Status: PROVISIONAL (awaiting confirmation by the project owner)

## Context

Material the project wants to reuse carries these licenses:

- CP-PAW: GPL-3.0 (executables are invoked as separate processes; this alone does not constrain our license).
- Avogadro 1: GPL-2.0-or-later. Its fragment library, crystal CIF library and element data are useful to ship; any copied code or data pulls us to a GPL-compatible license.
- `asecppaw` (historical ASE/CP-PAW interface): declared MIT, no LICENSE file, authored by the project owner (relicensable by them).
- ASE: LGPL-2.1+. Open Babel: GPL-2.0. RDKit: BSD-3. These are runtime dependencies, not copied code.

## Options

1. **GPL-3.0-or-later** (chosen provisionally). Allows copying Avogadro 1 code/data (v2+ upgrades to v3), CP-PAW derived material, and MIT code. Cost: plugins linking to our Python/TS packages must be GPL-compatible.
2. **BSD-3/MIT permissive core.** Friendlier plugin ecosystem, but forbids copying any Avogadro 1 or CP-PAW GPL material; everything would have to be reimplemented from documentation.
3. **Permissive core + separate GPL "avogadro-data" plugin package.** Maximum flexibility, more packaging complexity.

## Decision

Start under GPL-3.0-or-later. Record file-level provenance so that a later move to option 3 remains possible: copied GPL material is kept in clearly separated directories.

## Consequences

- `LICENSE` contains the GPL-3.0 text.
- `THIRD_PARTY_LICENSES.md` and `docs/provenance.md` must be updated whenever external material is copied.
- The project owner should confirm or change this decision before a public release.
