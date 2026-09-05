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
export type SymmetryInfo = components['schemas']['SymmetryInfo'];
export type LibraryEntry = components['schemas']['LibraryEntry'];
export type ScalarSeries = components['schemas']['ScalarSeries'];
export type AnalysisJob = components['schemas']['AnalysisJob'];
export type OrbitalEntry = components['schemas']['OrbitalEntry'];
export type OrbitalList = components['schemas']['OrbitalList'];
export type DosSpectrum = components['schemas']['DosSpectrum'];
export type DosSeries = components['schemas']['DosSeries'];
export type DosOptions = components['schemas']['DosOptions'];
export type BandStructure = components['schemas']['BandStructure'];
export type BandOptions = components['schemas']['BandOptions'];
export type KPathPoint = components['schemas']['KPathPoint'];
export type KPath = components['schemas']['KPath'];
export type WavefunctionInfo = components['schemas']['WavefunctionInfo'];
export type WavefunctionOrbital = components['schemas']['WavefunctionOrbital'];
export type SurfaceRequest = components['schemas']['SurfaceRequest'];
export type Spectrum = components['schemas']['Spectrum'];
export type SpectrumPeak = components['schemas']['SpectrumPeak'];
export type SpectrumAxis = components['schemas']['SpectrumAxis'];
export type VibrationalMode = components['schemas']['VibrationalMode'];
export type VibrationalSpectrum = components['schemas']['VibrationalSpectrum'];
export type VibrationsResponse = components['schemas']['VibrationsResponse'];
export type VibrationImport = components['schemas']['VibrationImport'];
export type NmrShielding = components['schemas']['NmrShielding'];
export type ElectronicTransition = components['schemas']['ElectronicTransition'];
export type SmartsResult = components['schemas']['SmartsResult'];
export type FFConstraint = components['schemas']['FFConstraint'];
export type FragmentInfo = components['schemas']['FragmentInfo'];
export type PeptidePresets = components['schemas']['PeptidePresets'];
export type ChargesResult = components['schemas']['ChargesResult'];
export type Identifiers = components['schemas']['Identifiers'];
export type OptimizeResult = components['schemas']['OptimizeResult'];
export type ForceFieldInfo = components['schemas']['ForceFieldInfo'];
export type PointGroupResult = components['schemas']['PointGroupResult'];
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

export type Body<P extends keyof paths, M extends 'post' | 'put'> = paths[P][M] extends {
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
    importSpectrumUpload: (file: File) => {
      const form = new FormData();
      form.append('file', file, file.name);
      return request<Spectrum>('/api/io/import/spectrum/upload', { method: 'POST', body: form });
    },
    importVibrationsUpload: (file: File) => {
      const form = new FormData();
      form.append('file', file, file.name);
      return request<VibrationImport>('/api/io/import/vibrations/upload', {
        method: 'POST',
        body: form,
      });
    },
  },
  analysis: {
    vibrations: (body: Body<'/api/analysis/vibrations', 'post'>) =>
      request<VibrationsResponse>('/api/analysis/vibrations', json(body)),
    vibrationalSpectrum: (body: Body<'/api/analysis/vibrations/spectrum', 'post'>) =>
      request<Spectrum>('/api/analysis/vibrations/spectrum', json(body)),
    spectrum: (body: Body<'/api/analysis/spectrum', 'post'>) =>
      request<Spectrum>('/api/analysis/spectrum', json(body)),
    nmr: (body: Body<'/api/analysis/nmr', 'post'>) =>
      request<Spectrum>('/api/analysis/nmr', json(body)),
    electronic: (body: Body<'/api/analysis/electronic', 'post'>) =>
      request<Spectrum>('/api/analysis/electronic', json(body)),
  },
  crystal: {
    symmetry: (body: Body<'/api/crystal/symmetry', 'post'>) =>
      request<SymmetryInfo>('/api/crystal/symmetry', json(body)),
    setCell: (body: Body<'/api/crystal/cell/set', 'post'>) =>
      request<Structure>('/api/crystal/cell/set', json(body)),
    addCell: (body: Body<'/api/crystal/cell/add', 'post'>) =>
      request<Structure>('/api/crystal/cell/add', json(body)),
    removeCell: (body: Body<'/api/crystal/cell/remove', 'post'>) =>
      request<Structure>('/api/crystal/cell/remove', json(body)),
    wrap: (body: Body<'/api/crystal/wrap', 'post'>) =>
      request<Structure>('/api/crystal/wrap', json(body)),
    translate: (body: Body<'/api/crystal/translate', 'post'>) =>
      request<Structure>('/api/crystal/translate', json(body)),
    standardOrientation: (body: Body<'/api/crystal/standard-orientation', 'post'>) =>
      request<Structure>('/api/crystal/standard-orientation', json(body)),
    scaleVolume: (body: Body<'/api/crystal/scale-volume', 'post'>) =>
      request<Structure>('/api/crystal/scale-volume', json(body)),
    symmetrize: (body: Body<'/api/crystal/symmetrize', 'post'>) =>
      request<Structure>('/api/crystal/symmetrize', json(body)),
    primitive: (body: Body<'/api/crystal/primitive', 'post'>) =>
      request<Structure>('/api/crystal/primitive', json(body)),
    primitiveStandardized: (body: Body<'/api/crystal/primitive-standardized', 'post'>) =>
      request<Structure>('/api/crystal/primitive-standardized', json(body)),
    niggli: (body: Body<'/api/crystal/niggli', 'post'>) =>
      request<Structure>('/api/crystal/niggli', json(body)),
    fill: (body: Body<'/api/crystal/fill', 'post'>) =>
      request<Structure>('/api/crystal/fill', json(body)),
    asymmetricUnit: (body: Body<'/api/crystal/asymmetric-unit', 'post'>) =>
      request<Structure>('/api/crystal/asymmetric-unit', json(body)),
    supercell: (body: Body<'/api/crystal/supercell', 'post'>) =>
      request<Structure>('/api/crystal/supercell', json(body)),
    slab: (body: Body<'/api/crystal/slab', 'post'>) =>
      request<Structure>('/api/crystal/slab', json(body)),
    bulk: (body: Body<'/api/crystal/bulk', 'post'>) =>
      request<Structure>('/api/crystal/bulk', json(body)),
    library: () => request<LibraryEntry[]>('/api/crystal/library'),
    libraryEntry: (category: string, name: string) =>
      request<Structure>(
        `/api/crystal/library/${encodeURIComponent(category)}/${encodeURIComponent(name)}`,
      ),
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
  build: {
    fragments: () => request<FragmentInfo[]>('/api/build/fragments'),
    insert: (body: Body<'/api/build/insert', 'post'>) =>
      request<Structure>('/api/build/insert', json(body)),
    peptidePresets: () => request<PeptidePresets>('/api/build/peptide/presets'),
    peptide: (body: Body<'/api/build/peptide', 'post'>) =>
      request<Structure>('/api/build/peptide', json(body)),
    nucleic: (body: Body<'/api/build/nucleic', 'post'>) =>
      request<Structure>('/api/build/nucleic', json(body)),
    nanotube: (body: Body<'/api/build/nanotube', 'post'>) =>
      request<Structure>('/api/build/nanotube', json(body)),
    graphene: (body: Body<'/api/build/graphene', 'post'>) =>
      request<Structure>('/api/build/graphene', json(body)),
  },
  chem: {
    forceFields: () => request<ForceFieldInfo>('/api/chem/force-fields'),
    optimize: (body: Body<'/api/chem/optimize', 'post'>) =>
      request<OptimizeResult>('/api/chem/optimize', json(body)),
    addHydrogens: (body: Body<'/api/chem/add-hydrogens', 'post'>) =>
      request<Structure>('/api/chem/add-hydrogens', json(body)),
    removeHydrogens: (body: Body<'/api/chem/remove-hydrogens', 'post'>) =>
      request<Structure>('/api/chem/remove-hydrogens', json(body)),
    perceiveBonds: (body: Body<'/api/chem/perceive-bonds', 'post'>) =>
      request<Structure>('/api/chem/perceive-bonds', json(body)),
    partialCharges: (body: Body<'/api/chem/partial-charges', 'post'>) =>
      request<ChargesResult>('/api/chem/partial-charges', json(body)),
    identifiers: (body: Body<'/api/chem/identifiers', 'post'>) =>
      request<Identifiers>('/api/chem/identifiers', json(body)),
    invertChirality: (body: Body<'/api/chem/invert-chirality', 'post'>) =>
      request<Structure>('/api/chem/invert-chirality', json(body)),
    hToMethyl: (body: Body<'/api/chem/h-to-methyl', 'post'>) =>
      request<Structure>('/api/chem/h-to-methyl', json(body)),
    smarts: (body: Body<'/api/chem/smarts', 'post'>) =>
      request<SmartsResult>('/api/chem/smarts', json(body)),
    pointGroup: (body: Body<'/api/chem/point-group', 'post'>) =>
      request<PointGroupResult>('/api/chem/point-group', json(body)),
    symmetrize: (body: Body<'/api/chem/symmetrize', 'post'>) =>
      request<Structure>('/api/chem/symmetrize', json(body)),
  },
  wavefunction: {
    load: (body: Body<'/api/wavefunction/load', 'post'>) =>
      request<WavefunctionInfo>('/api/wavefunction/load', json(body)),
    surface: (body: Body<'/api/wavefunction/surface', 'post'>) =>
      request<VolumetricGrid>('/api/wavefunction/surface', json(body)),
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
  /** CP-PAW post-processing of a completed calculation (jobs run in its work directory). */
  cppaw: {
    orbitals: (id: string) =>
      request<OrbitalList>(`/api/cppaw/calculations/${encodeURIComponent(id)}/orbitals`),
    exportOrbitals: (
      id: string,
      body: Body<'/api/cppaw/calculations/{calc_id}/orbitals/export', 'post'>,
    ) =>
      request<Calculation>(
        `/api/cppaw/calculations/${encodeURIComponent(id)}/orbitals/export`,
        json(body),
      ),
    requestDos: (id: string, body: DosOptions) =>
      request<Calculation>(`/api/cppaw/calculations/${encodeURIComponent(id)}/dos`, json(body)),
    dos: (id: string) =>
      request<DosSpectrum>(`/api/cppaw/calculations/${encodeURIComponent(id)}/dos`),
    requestBands: (id: string, body: BandOptions) =>
      request<Calculation>(`/api/cppaw/calculations/${encodeURIComponent(id)}/bands`, json(body)),
    bands: (id: string) =>
      request<BandStructure>(`/api/cppaw/calculations/${encodeURIComponent(id)}/bands`),
    bandPath: (id: string) =>
      request<KPath>(`/api/cppaw/calculations/${encodeURIComponent(id)}/bands/path`),
  },
};
