import { renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { GridStats, VolumetricGrid } from '../api/client';
import type { Renderer } from '../renderer/Renderer';

const created = vi.hoisted(() => ({ layers: [] as { id: string; setSurfaces: () => void }[] }));
vi.mock('../renderer/layers/IsosurfaceLayer', () => ({
  IsosurfaceLayer: class {
    onChange: (() => void) | null = null;
    setSurfaces = vi.fn();
    dispose = vi.fn();
    constructor(readonly id: string) {
      created.layers.push(this as unknown as { id: string; setSurfaces: () => void });
    }
  },
}));

import { useIsosurfaceLayers } from './useIsosurfaceLayers';
import { defaultSurface, useVolumetricStore, type LoadedGrid } from '../state/volumetricStore';

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
const stats: GridStats = {
  min: 0,
  max: 1,
  mean: 0.4,
  abs_max: 1,
  has_negative: false,
  suggested_isovalue: 0.2,
  rule: 'test',
};
const grid: LoadedGrid = {
  meta,
  stats,
  values: new Float32Array(8).fill(0.5),
  calculationId: null,
};

const fakeRenderer = (): Renderer =>
  ({ addLayer: vi.fn(), removeLayer: vi.fn(), invalidate: vi.fn() }) as unknown as Renderer;

beforeEach(() => {
  created.layers.length = 0;
  useVolumetricStore.getState().clear();
});

test('surfaces that already exist mount into a renderer that appears later', () => {
  useVolumetricStore.setState({ grids: { g1: grid }, surfaces: [defaultSurface(grid)] });
  const { rerender } = renderHook(({ r }: { r: Renderer | null }) => useIsosurfaceLayers(r), {
    initialProps: { r: null as Renderer | null },
  });
  expect(created.layers).toHaveLength(0);

  const renderer = fakeRenderer();
  rerender({ r: renderer });
  expect(created.layers).toHaveLength(1);
  expect(renderer.addLayer).toHaveBeenCalledTimes(1);
  expect(created.layers[0]!.setSurfaces).toHaveBeenCalled();
});

test('a replacement renderer gets its own layers', () => {
  useVolumetricStore.setState({ grids: { g1: grid }, surfaces: [defaultSurface(grid)] });
  const first = fakeRenderer();
  const { rerender } = renderHook(({ r }: { r: Renderer | null }) => useIsosurfaceLayers(r), {
    initialProps: { r: first as Renderer | null },
  });
  expect(created.layers).toHaveLength(1);

  const second = fakeRenderer();
  rerender({ r: second });
  expect(created.layers).toHaveLength(2);
  expect(second.addLayer).toHaveBeenCalledTimes(1);
});
