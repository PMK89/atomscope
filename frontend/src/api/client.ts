/**
 * Thin typed HTTP client. Types come from the generated OpenAPI schema (make contracts);
 * never hand-write backend data types here.
 */
import type { components, paths } from './schema';

export type Structure = components['schemas']['Structure'];
export type StructureSummary = components['schemas']['StructureSummary'];
export type ProjectInfo = components['schemas']['ProjectInfo'];
export type HealthResponse = components['schemas']['HealthResponse'];

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

type CreateBody = paths['/api/project/create']['post']['requestBody']['content']['application/json'];
type OpenBody = paths['/api/project/open']['post']['requestBody']['content']['application/json'];

export const api = {
  health: () => request<HealthResponse>('/api/health'),
  project: {
    current: () => request<ProjectInfo | null>('/api/project'),
    create: (body: CreateBody) =>
      request<ProjectInfo>('/api/project/create', { method: 'POST', body: JSON.stringify(body) }),
    open: (body: OpenBody) =>
      request<ProjectInfo>('/api/project/open', { method: 'POST', body: JSON.stringify(body) }),
    close: () => request<void>('/api/project/close', { method: 'POST' }),
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
      request<void>(`/api/structures/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
};
