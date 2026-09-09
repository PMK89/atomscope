/**
 * Loaded volumetric grids (metadata + float32 values + statistics) and the isosurface
 * definitions drawn from them. Meshing itself happens in the renderer layer, not here.
 */
import { create } from 'zustand';
import { api, type GridStats, type VolumetricGrid } from '../api/client';
import type { SurfaceRenderMode, SurfaceSpec } from '../renderer/layers/IsosurfaceLayer';
import type { GridGeometry } from '../renderer/marchingCubes';

export interface LoadedGrid {
  meta: VolumetricGrid;
  values: Float32Array;
  stats: GridStats;
  calculationId: string | null;
}

export interface SurfaceDef {
  id: string;
  gridId: string;
  isovalue: number;
  color: string;
  /** colour of the negative lobe when `pair` is on */
  negativeColor: string;
  opacity: number;
  visible: boolean;
  /** draw +isovalue and -isovalue (orbitals, spin densities) */
  pair: boolean;
  /** downsample factor 1, 2 or 4 */
  step: number;
  /** paint the surface with the values of this grid (an ESP on a density), or null for one colour */
  colorGridId: string | null;
  /** colour scale bounds, or null to use the range found on the surface */
  colorRange: [number, number] | null;
  /** Fill, Lines (the triangulation) or Points (the vertices) -- Avogadro's `renderCombo`. */
  renderMode: SurfaceRenderMode;
  /** draw the bounding box of the grid the surface came from (Avogadro's `drawBoxCheck`) */
  drawBox: boolean;
}

export const DENSITY_COLOR = '#3d7be0';
export const POSITIVE_COLOR = '#2b6cff';
export const NEGATIVE_COLOR = '#e03a3a';
export const STEP_OPTIONS = [1, 2, 4] as const;
/** grids above this many points default to a coarser step */
const LARGE_GRID_POINTS = 128 ** 3;

export const isDensityKind = (kind: VolumetricGrid['kind']): boolean =>
  kind === 'electron_density' || kind === 'orbital_density';

export function gridGeometry(meta: VolumetricGrid): GridGeometry {
  return { shape: meta.shape, origin: meta.origin, axes: meta.axes };
}

let counter = 0;
const nextId = (): string => `surf-${++counter}`;

export function defaultSurface(grid: LoadedGrid): SurfaceDef {
  const signed = grid.stats.has_negative;
  const n = grid.meta.shape[0] * grid.meta.shape[1] * grid.meta.shape[2];
  return {
    id: nextId(),
    gridId: grid.meta.id,
    isovalue: grid.stats.suggested_isovalue,
    color: signed ? POSITIVE_COLOR : DENSITY_COLOR,
    negativeColor: NEGATIVE_COLOR,
    // 0.75, as Avogadro's surface engine defaults its `m_alpha`: an opaque surface hides the
    // molecule it belongs to, which is usually not what you want to see first
    opacity: 0.75,
    visible: true,
    pair: signed,
    step: n > LARGE_GRID_POINTS ? 2 : 1,
    colorGridId: null,
    colorRange: null,
    renderMode: 'fill',
    drawBox: false,
  };
}

/** Rendered surfaces for a definition: one, or a +/- pair for signed fields. */
export function surfaceSpecs(
  def: SurfaceDef,
  grids: Record<string, LoadedGrid> = {},
): SurfaceSpec[] {
  const source = def.colorGridId ? grids[def.colorGridId] : undefined;
  const colorSource: SurfaceSpec['colorSource'] = source
    ? {
        gridId: source.meta.id,
        values: source.values,
        geometry: gridGeometry(source.meta),
        range: def.colorRange,
      }
    : null;
  const base = {
    step: def.step,
    opacity: def.opacity,
    visible: def.visible,
    colorSource,
    renderMode: def.renderMode,
    drawBox: def.drawBox,
  };
  const positive: SurfaceSpec = {
    ...base,
    id: def.id,
    isovalue: def.isovalue,
    inside: 'above',
    color: def.color,
  };
  if (!def.pair) return [positive];
  return [
    positive,
    {
      ...base,
      id: `${def.id}-neg`,
      isovalue: -def.isovalue,
      inside: 'below',
      color: def.negativeColor,
    },
  ];
}

export interface SliderRange {
  lo: number;
  hi: number;
  log: boolean;
}

/** Isovalue slider range: log scale over four decades for densities, linear otherwise. */
export function sliderRange(stats: GridStats, kind: VolumetricGrid['kind']): SliderRange {
  const hi = stats.abs_max > 0 ? stats.abs_max : 1;
  if (isDensityKind(kind) && !stats.has_negative) return { lo: hi * 1e-4, hi, log: true };
  return { lo: 0, hi, log: false };
}

/** Map an isovalue to the slider position in [0, 1]. */
export function isoToSlider(value: number, r: SliderRange): number {
  const v = Math.min(r.hi, Math.max(r.lo, value));
  const t = r.log ? Math.log(v / r.lo) / Math.log(r.hi / r.lo) : (v - r.lo) / (r.hi - r.lo);
  return Math.min(1, Math.max(0, t));
}

/** Inverse of `isoToSlider`. */
export function sliderToIso(t: number, r: SliderRange): number {
  const s = Math.min(1, Math.max(0, t));
  return r.log ? r.lo * Math.pow(r.hi / r.lo, s) : r.lo + s * (r.hi - r.lo);
}

const omit = <T>(rec: Record<string, T>, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(rec).filter(([k]) => k !== key));

interface VolumetricState {
  grids: Record<string, LoadedGrid>;
  surfaces: SurfaceDef[];
  loading: Record<string, boolean>;
  /** Renderer feedback per rendered surface spec id (e.g. a resolution the budget forced). */
  warnings: Record<string, string>;
  /** Range of the colour values actually found on each rendered surface. */
  colorRanges: Record<string, [number, number]>;
  setSurfaceWarning: (specId: string, message: string | null) => void;
  setSurfaceColorRange: (specId: string, range: [number, number]) => void;
  loadGrid: (gridId: string, calculationId?: string | null) => Promise<LoadedGrid>;
  unloadGrid: (gridId: string) => void;
  addSurface: (gridId: string) => SurfaceDef | null;
  updateSurface: (id: string, patch: Partial<Omit<SurfaceDef, 'id' | 'gridId'>>) => void;
  removeSurface: (id: string) => void;
  clear: () => void;
}

export const useVolumetricStore = create<VolumetricState>((set, get) => ({
  grids: {},
  surfaces: [],
  loading: {},
  warnings: {},
  colorRanges: {},
  setSurfaceColorRange: (specId, range) =>
    set((s) => ({ colorRanges: { ...s.colorRanges, [specId]: range } })),
  setSurfaceWarning: (specId, message) =>
    set((s) =>
      message === null
        ? s.warnings[specId] === undefined
          ? s
          : { warnings: omit(s.warnings, specId) }
        : { warnings: { ...s.warnings, [specId]: message } },
    ),
  loadGrid: async (gridId, calculationId = null) => {
    const cached = get().grids[gridId];
    if (cached) return cached;
    set((s) => ({ loading: { ...s.loading, [gridId]: true } }));
    try {
      const [meta, stats, values] = await Promise.all([
        api.grids.get(gridId),
        api.grids.stats(gridId),
        api.grids.data(gridId),
      ]);
      const grid: LoadedGrid = { meta, stats, values, calculationId };
      set((s) => ({ grids: { ...s.grids, [gridId]: grid } }));
      return grid;
    } finally {
      set((s) => ({ loading: omit(s.loading, gridId) }));
    }
  },
  unloadGrid: (gridId) =>
    set((s) => {
      const gone = s.surfaces.filter((d) => d.gridId === gridId).map((d) => d.id);
      let warnings = s.warnings;
      for (const id of gone) warnings = omit(omit(warnings, id), `${id}-neg`);
      return {
        grids: omit(s.grids, gridId),
        surfaces: s.surfaces.filter((d) => d.gridId !== gridId),
        warnings,
      };
    }),
  addSurface: (gridId) => {
    const grid = get().grids[gridId];
    if (!grid) return null;
    const def = defaultSurface(grid);
    set((s) => ({ surfaces: [...s.surfaces, def] }));
    return def;
  },
  updateSurface: (id, patch) =>
    set((s) => ({ surfaces: s.surfaces.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),
  removeSurface: (id) =>
    set((s) => ({
      surfaces: s.surfaces.filter((d) => d.id !== id),
      warnings: omit(omit(s.warnings, id), `${id}-neg`),
    })),
  clear: () => set({ grids: {}, surfaces: [], loading: {}, warnings: {} }),
}));
