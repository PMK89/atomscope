# Atomscope

Atomscope is an open molecular modeling, computational chemistry, simulation
setup, execution, analysis and visualization environment. Its functional
reference is Avogadro 1.2, extended with deep integration of CP-PAW and the
Atomic Simulation Environment (ASE) through a plugin-based backend
architecture.

Status: Phase 0 (investigation). See `ROADMAP.md`, `docs/STATE.md` and
`docs/avogadro1-feature-parity.md`.

## Layout

- `backend/`  Python scientific backend (data model, ASE bridge, CP-PAW adapter, jobs, parsers, API)
- `frontend/` TypeScript/React application (renderer, editor, calculation forms)
- `docs/`     architecture, decisions (ADRs), investigation reports, parity matrix
- `tests/`    cross-cutting fixtures and integration tests

## License

GPL-3.0-or-later (provisional, see `docs/decisions/0001-license.md`).
