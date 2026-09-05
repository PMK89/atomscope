/**
 * Thin typed HTTP client. Types come from the generated OpenAPI schema (make contracts);
 * never hand-write backend data types here.
 */
import type { components, paths } from './schema';

export type Structure = components['schemas']['Structure'];
export type StructureSummary = components['schemas']['StructureSummary'];
export type ProjectInfo = components['schemas']['ProjectInfo'];
export type HealthResponse = components['schemas']['HealthResponse'];
export type FormatDescription = components['schemas']['FormatDescription'];
export type ExportResponse = components['schemas']['ExportResponse'];

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
  },
};
