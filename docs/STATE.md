# Project state (resume here)

Branch: main. Phase 0 finishing, Phase 1 (foundation) well under way.

## Resume commands

```bash
cd /home/pmk/Projects/atomscope && source env.sh
git status && git log --oneline | head -20
cat docs/STATE.md ROADMAP.md
make test          # backend pytest + frontend vitest
make lint typecheck
make dev-backend   # 127.0.0.1:8765 ; make dev-frontend -> 127.0.0.1:5173
```

## Completed
- Repository, licensing ADR (GPL-3.0-or-later provisional), provenance, toolchain (uv venv Python 3.12, pnpm store in-project).
- Investigation reports: `docs/avogadro1-feature-parity.md` (312 rows), `docs/ase-analysis.md`. `docs/cppaw-analysis.md` in progress (agent), fragments in `.scratch/cppaw/`.
- Backend: data model (Structure/Atom/Bond/Cell, constraints, grids, trajectories, vibrations), units, ASE bridge (lossless), project store, API skeleton (project + structures), IO registry (ASE/RDKit/Open Babel, SMILES), bond perception, CP-PAW deck syntax parser/writer, protocol parser, cube reader/writer, golden fixtures from local CP-PAW smoke runs.
- Frontend: Vite/React/TS strict scaffold, generated OpenAPI types + client, normalized structure model, undoable store, selection store, Three.js renderer (instanced atoms/bonds, trackball camera, ortho/perspective, picking), Viewport, element data generated from ASE.

## Known problems / open questions
- Installed `/usr/bin/avogadro` is Avogadro 2; live Avogadro 1 comparison BLOCKED (source tree is the reference).
- pnpm wrote to the global store `~/.local/share/pnpm/store` once before `.npmrc` was placed in `frontend/`; nothing else outside PROJECT_ROOT was modified. Not deleted (outside boundary).
- CP-PAW total-density cube integrates to ~42.6 e for water (expected ~8-10): normalization of paw_wave "total" density to be clarified in cppaw-analysis.
- `ase-cp-paw` declares MIT but has no LICENSE file (author = project owner).

## Next actions
1. Finish/commit `docs/cppaw-analysis.md`; write `docs/architecture/cppaw-adapter.md`, `ase-integration.md`, `calculation-schemas.md`, `job-execution.md`, `output-parsing.md`.
2. Parameter schema engine + job manager (in progress), then CP-PAW plugin (input generation from schema, run spec, result parsing), API routes, calculation forms in the UI.
3. Editor tools (draw/select/manipulate/measure), file open/save in the UI, representation controls.
