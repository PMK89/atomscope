# ADR 0004: Typed contracts between frontend and backend

Status: ACCEPTED

## Decision

All request/response bodies, WebSocket events and on-disk project documents are pydantic v2
models under `atomscope.model` and `atomscope.api.schemas`. FastAPI exposes the OpenAPI document;
`make contracts` writes `frontend/src/api/openapi.json` and generates `schema.d.ts` with
openapi-typescript. Hand-written TS types for backend data are forbidden. Contract tests in
`backend/tests/api/` snapshot the OpenAPI document so unintended changes fail CI.

Numerical arrays that would be too large for JSON (volumetric grids, trajectories) are served as
binary (little-endian float32/float64 with a small JSON header) from dedicated endpoints; the
header is itself a pydantic model.
