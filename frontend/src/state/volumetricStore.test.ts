import { vi } from 'vitest';
import type { GridStats, VolumetricGrid } from '../api/client';

const meta: VolumetricGrid = {
  id: 'g1',
  name: 'density',
  kind: 'electron_density',
  origin: [0, 0, 0],
  axes: [
    [0.5, 0, 0],
    [0, 0.5, 0],
    [0, 0, 0.5],
  ],
  shape: [2, 2, 2],
  unit: 'e/bohr^3',
  dtype: 'float32',
  data_ref: 'datasets/g1.f32',
};
const densityStats: GridStats = {
  min: 0,
  max: 1,
  mean: 0.4,
  abs_max: 1,
  has_negative: false,
  suggested_isovalue: 0.2,
  rule: 'test',
};
const orbitalStats: GridStats = {
  ...densityStats,
  min: -0.4,
  has_negative: true,
  suggested_isovalue: 0.05,
};

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  stats: vi.fn(),
  data: vi.fn(),
}));
vi.mock('../api/client', () => ({
  api: { grids: { get: mocks.get, stats: mocks.stats, data: mocks.data } },
}));

import {
  defaultSurface,
  isoToSlider,
  sliderRange,
  sliderToIso,
  surfaceSpecs,
  useVolumetricStore,
} from './volumetricStore';

beforeEach(() => {
  useVolumetricStore.getState().clear();
  mocks.get.mockResolvedValue(meta);
  mocks.stats.mockResolvedValue(densityStats);
  mocks.data.mockResolvedValue(new Float32Array(8).fill(0.5));
});

test('loadGrid fetches metadata, stats and values once and caches the result', async () => {
  const store = useVolumetricStore.getState();
  const grid = await store.loadGrid('g1', 'calc-1');
  expect(grid.values).toHaveLength(8);
  expect(grid.calculationId).toBe('calc-1');
  expect(useVolumetricStore.getState().grids['g1']).toBe(grid);
  expect(useVolumetricStore.getState().loading['g1']).toBeUndefined();
  await useVolumetricStore.getState().loadGrid('g1');
  expect(mocks.data).toHaveBeenCalledTimes(1);
});

test('addSurface uses the suggested isovalue; unloadGrid drops its surfaces', async () => {
  await useVolumetricStore.getState().loadGrid('g1');
  expect(useVolumetricStore.getState().addSurface('missing')).toBeNull();
  const def = useVolumetricStore.getState().addSurface('g1')!;
  expect(def.isovalue).toBe(0.2);
  expect(def.pair).toBe(false);
  expect(def.step).toBe(1);
  useVolumetricStore.getState().updateSurface(def.id, { isovalue: 0.3, opacity: 0.5 });
  expect(useVolumetricStore.getState().surfaces[0]).toMatchObject({ isovalue: 0.3, opacity: 0.5 });
  useVolumetricStore.getState().removeSurface(def.id);
  expect(useVolumetricStore.getState().surfaces).toHaveLength(0);
  useVolumetricStore.getState().addSurface('g1');
  useVolumetricStore.getState().unloadGrid('g1');
  expect(useVolumetricStore.getState().surfaces).toHaveLength(0);
  expect(useVolumetricStore.getState().grids['g1']).toBeUndefined();
});

test('signed fields default to a +/- pair rendered as two surfaces', () => {
  const def = defaultSurface({
    meta: { ...meta, kind: 'orbital' },
    stats: orbitalStats,
    values: new Float32Array(8),
    calculationId: null,
  });
  expect(def.pair).toBe(true);
  const specs = surfaceSpecs(def);
  expect(specs).toHaveLength(2);
  expect(specs[0]).toMatchObject({ isovalue: 0.05, inside: 'above', color: def.color });
  expect(specs[1]).toMatchObject({
    id: `${def.id}-neg`,
    isovalue: -0.05,
    inside: 'below',
    color: def.negativeColor,
  });
  expect(surfaceSpecs({ ...def, pair: false })).toHaveLength(1);
});

test('large grids default to a coarser step', () => {
  const def = defaultSurface({
    meta: { ...meta, shape: [200, 200, 200] },
    stats: densityStats,
    values: new Float32Array(0),
    calculationId: null,
  });
  expect(def.step).toBe(2);
});

test('isovalue slider is logarithmic for densities and linear for signed fields', () => {
  const dens = sliderRange(densityStats, 'electron_density');
  expect(dens.log).toBe(true);
  expect(isoToSlider(dens.lo, dens)).toBe(0);
  expect(isoToSlider(dens.hi, dens)).toBe(1);
  expect(isoToSlider(1e-2, dens)).toBeCloseTo(0.5);
  expect(sliderToIso(isoToSlider(0.037, dens), dens)).toBeCloseTo(0.037);
  const orb = sliderRange(orbitalStats, 'orbital');
  expect(orb.log).toBe(false);
  expect(sliderToIso(0.25, orb)).toBeCloseTo(0.25);
  expect(isoToSlider(5, orb)).toBe(1); // clamped
});
