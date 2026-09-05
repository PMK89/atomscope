/**
 * Thin typed HTTP client. Types come from the generated OpenAPI schema (make contracts);
 * never hand-write backend data types here.
 */
import type { components, paths } from './schema';

export type Structure = components['schemas']['Structure'] & { id: string };
export type StructureSummary = components['schemas']['StructureSummary'];
export type ProjectInfo = components['schemas']['ProjectInfo'];
export type HealthResponse = components['schemas']['HealthResponse'];
export type FormatDescription = components['schemas']['FormatDescription'];
export type ExportResponse = components['schemas']['ExportResponse'];
export type BackendInfo = components['schemas']['BackendInfo'];
export type ParameterSchema = components['schemas']['ParameterSchema'];
export type ParameterSpec = components['schemas']['ParameterSpec'];
export type Preset = components['schemas']['Preset'];
// pydantic default_factory ids appear optional in OpenAPI; the backend always sets them.
export type Calculation = components['schemas']['Calculation'] & { id: string };
export type GeneratedInputs = components['schemas']['GeneratedInputs'];
export type ResultBundle = components['schemas']['ResultBundle'];
export type ValidationReport = components['schemas']['ValidationReport'];
export type LogResponse = components['schemas']['LogResponse'];
export type VolumetricGrid = components['schemas']['VolumetricGrid'];
export type GridStats = components['schemas']['GridStats'];
export type GridRef = components['schemas']['GridRef'];
export type ImportCubeResponse = components['schemas']['ImportCubeResponse'];
export type Trajectory = components['schemas']['Trajectory'];
export type TrajectoryScalars = components['schemas']['TrajectoryScalars'];
export type TrajectoryImport = components['schemas']['TrajectoryImport'];
export type ExportTrajectoryResponse = components['schemas']['ExportTrajectoryResponse'];
export type ParameterValues = Record<string, unknown>;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData;
  const res = await fetch(url, {
    ...init,
    headers: isForm
      ? (init?.headers ?? {})
      : { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string | { msg: string }[] };
      if (typeof body.detail === 'string') detail = body.detail;
      else if (Array.isArray(body.detail)) detail = body.detail.map((d) => d.msg).join('; ');
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

type Body<P extends keyof paths, M extends 'post' | 'put'> = paths[P][M] extends {
  requestBody: { content: { 'application/json': infer B } };
}
  ? B
  : never;

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const api = {
  health: () => request<HealthResponse>('/api/health'),
  project: {
    current: () => request<ProjectInfo | null>('/api/project'),
    create: (body: Body<'/api/project/create', 'post'>) =>
      request<ProjectInfo>('/api/project/create', json(body)),
    open: (body: Body<'/api/project/open', 'post'>) =>
      request<ProjectInfo>('/api/project/open', json(body)),
    close: () => request<undefined>('/api/project/close', { method: 'POST' }),
    getViewSettings: () => request<Record<string, unknown>>('/api/project/view-settings'),
    putViewSettings: (settings: Record<string, unknown>) =>
      request<Record<string, unknown>>('/api/project/view-settings', {
        method: 'PUT',
        body: JSON.stringify({ settings }),
      }),
  },
  structures: {
    list: () => request<StructureSummary[]>('/api/structures'),
    get: (id: string) => request<Structure>(`/api/structures/${encodeURIComponent(id)}`),
    put: (s: Structure) =>
      request<StructureSummary>(`/api/structures/${encodeURIComponent(s.id ?? '')}`, {
        method: 'PUT',
        body: JSON.stringify(s),
      }),
    delete: (id: string) =>
      request<undefined>(`/api/structures/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
  io: {
    formats: () => request<FormatDescription[]>('/api/io/formats'),
    importPath: (body: Body<'/api/io/import/path', 'post'>) =>
      request<Structure>('/api/io/import/path', json(body)),
    importUpload: (file: File) => {
      const form = new FormData();
      form.append('file', file, file.name);
      return request<Structure>('/api/io/import/upload', { method: 'POST', body: form });
    },
    smiles: (body: Body<'/api/io/smiles', 'post'>) =>
      request<Structure>('/api/io/smiles', json(body)),
    export: (body: Body<'/api/io/export', 'post'>) =>
      request<ExportResponse>('/api/io/export', json(body)),
    importCube: (body: Body<'/api/io/import/cube', 'post'>) =>
      request<ImportCubeResponse>('/api/io/import/cube', json(body)),
    importTrajectoryPath: (body: Body<'/api/io/import/trajectory', 'post'>) =>
      request<TrajectoryImport>('/api/io/import/trajectory', json(body)),
    importTrajectoryUpload: (file: File) => {
      const form = new FormData();
      form.append('file', file, file.name);
      return request<TrajectoryImport>('/api/io/import/trajectory/upload', {
        method: 'POST',
        body: form,
      });
    },
    exportTrajectory: (body: Body<'/api/io/export/trajectory', 'post'>) =>
      request<ExportTrajectoryResponse>('/api/io/export/trajectory', json(body)),
  },
  grids: {
    list: () => request<GridRef[]>('/api/grids'),
    get: (id: string) => request<VolumetricGrid>(`/api/grids/${encodeURIComponent(id)}`),
    stats: (id: string) => request<GridStats>(`/api/grids/${encodeURIComponent(id)}/stats`),
    /** Raw little-endian float32 values in C order; browsers are little-endian, so no swap. */
    data: async (id: string): Promise<Float32Array> => {
      const res = await fetch(`/api/grids/${encodeURIComponent(id)}/data`);
      if (!res.ok) throw new ApiError(res.status, res.statusText);
      return new Float32Array(await res.arrayBuffer());
    },
  },
  backends: {
    list: () => request<BackendInfo[]>('/api/backends'),
    schema: (id: string) =>
      request<ParameterSchema>(`/api/backends/${encodeURIComponent(id)}/schema`),
    presets: (id: string) => request<Preset[]>(`/api/backends/${encodeURIComponent(id)}/presets`),
  },
  calculations: {
    list: () => request<Calculation[]>('/api/calculations'),
    create: (body: Body<'/api/calculations', 'post'>) =>
      request<Calculation>('/api/calculations', json(body)),
    get: (id: string) => request<Calculation>(`/api/calculations/${encodeURIComponent(id)}`),
    updateValues: (id: string, values: ParameterValues) =>
      request<Calculation>(`/api/calculations/${encodeURIComponent(id)}/values`, {
        method: 'PUT',
        body: JSON.stringify({ values }),
      }),
    validate: (id: string) =>
      request<ValidationReport>(`/api/calculations/${encodeURIComponent(id)}/validate`),
    generate: (id: string) =>
      request<GeneratedInputs>(`/api/calculations/${encodeURIComponent(id)}/generate`, {
        method: 'POST',
      }),
    run: (id: string) =>
      request<Calculation>(`/api/calculations/${encodeURIComponent(id)}/run`, { method: 'POST' }),
    cancel: (id: string) =>
      request<Calculation>(`/api/calculations/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
      }),
    fork: (id: string, body: Body<'/api/calculations/{calc_id}/fork', 'post'>) =>
      request<Calculation>(`/api/calculations/${encodeURIComponent(id)}/fork`, json(body)),
    results: (id: string) =>
      request<ResultBundle>(`/api/calculations/${encodeURIComponent(id)}/results`),
    log: (id: string, stream = 'stdout', tail = 500) =>
      request<LogResponse>(
        `/api/calculations/${encodeURIComponent(id)}/log?stream=${encodeURIComponent(stream)}&tail=${tail}`,
      ),
    trajectory: (id: string) =>
      request<Trajectory>(`/api/calculations/${encodeURIComponent(id)}/trajectory`),
    trajectoryScalars: (id: string) =>
      request<TrajectoryScalars>(`/api/calculations/${encodeURIComponent(id)}/trajectory/scalars`),
    /** Little-endian float32 positions, frames x atoms x 3; dimensions come from the scalars. */
    trajectoryPositions: async (id: string): Promise<Float32Array> => {
      const res = await fetch(`/api/calculations/${encodeURIComponent(id)}/trajectory/positions`);
      if (!res.ok) throw new ApiError(res.status, res.statusText);
      return new Float32Array(await res.arrayBuffer());
    },
    /** WebSocket URL for job events (relative to the page origin; Vite proxies /api). */
    eventsUrl: () =>
      `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/calculations/ws`,
  },
};
