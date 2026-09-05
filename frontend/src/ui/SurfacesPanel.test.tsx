import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { GridStats, VolumetricGrid } from '../api/client';
import {
  defaultSurface,
  sliderRange,
  sliderToIso,
  useVolumetricStore,
  type LoadedGrid,
} from '../state/volumetricStore';
import { ISOVALUE_DEBOUNCE_MS, SurfacesPanel } from './SurfacesPanel';

const meta: VolumetricGrid = {
  id: 'g1',
  name: 'homo',
  kind: 'orbital',
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
  min: -1,
  max: 1,
  mean: 0,
  abs_max: 1,
  has_negative: true,
  suggested_isovalue: 0.05,
  rule: 'test',
};
const grid: LoadedGrid = { meta, stats, values: new Float32Array(8), calculationId: null };

beforeEach(() => {
  vi.useFakeTimers();
  useVolumetricStore.getState().clear();
  useVolumetricStore.setState({ grids: { g1: grid }, surfaces: [defaultSurface(grid)] });
});
afterEach(() => vi.useRealTimers());

test('dragging the isovalue slider commits once, after it settles', () => {
  render(<SurfacesPanel onError={() => {}} />);
  const before = useVolumetricStore.getState().surfaces[0]!.isovalue;
  const slider = screen.getByLabelText(/Isovalue/);

  fireEvent.change(slider, { target: { value: '0.4' } });
  fireEvent.change(slider, { target: { value: '0.5' } });
  fireEvent.change(slider, { target: { value: '0.6' } });
  // nothing committed yet: the store still holds the original isovalue
  expect(useVolumetricStore.getState().surfaces[0]!.isovalue).toBe(before);

  act(() => void vi.advanceTimersByTime(ISOVALUE_DEBOUNCE_MS));
  const range = sliderRange(stats, meta.kind);
  expect(useVolumetricStore.getState().surfaces[0]!.isovalue).toBeCloseTo(
    sliderToIso(0.6, range),
    9,
  );
});

test('a resolution warning from the renderer is shown on the surface card', () => {
  const def = useVolumetricStore.getState().surfaces[0]!;
  render(<SurfacesPanel onError={() => {}} />);
  expect(screen.queryByText(/triangle budget/)).toBeNull();

  // the negative lobe of a +/- pair reports under its own spec id
  act(() =>
    useVolumetricStore
      .getState()
      .setSurfaceWarning(
        `${def.id}-neg`,
        'Reduced to 1/4 resolution to stay within the triangle budget (900k triangles).',
      ),
  );
  expect(screen.getByText(/1\/4 resolution/)).toBeInTheDocument();

  act(() => useVolumetricStore.getState().setSurfaceWarning(`${def.id}-neg`, null));
  expect(screen.queryByText(/triangle budget/)).toBeNull();
});

test('removing a surface forgets its warnings', () => {
  const def = useVolumetricStore.getState().surfaces[0]!;
  const vol = useVolumetricStore.getState();
  vol.setSurfaceWarning(def.id, 'too big');
  vol.setSurfaceWarning(`${def.id}-neg`, 'too big');
  useVolumetricStore.getState().removeSurface(def.id);
  expect(useVolumetricStore.getState().warnings).toEqual({});
});

test('a surface can be painted by another grid, and the scale can be set by hand', () => {
  const esp: LoadedGrid = {
    meta: { ...meta, id: 'g2', name: 'esp', kind: 'other' },
    stats,
    values: new Float32Array(8),
    calculationId: null,
  };
  useVolumetricStore.setState({ grids: { g1: grid, g2: esp } });
  render(<SurfacesPanel onError={() => {}} />);

  const def = useVolumetricStore.getState().surfaces[0]!;
  fireEvent.change(screen.getByLabelText('Colour by'), { target: { value: 'g2' } });
  expect(useVolumetricStore.getState().surfaces[0]!.colorGridId).toBe('g2');

  // the renderer reports what it found; the panel shows it until a range is typed
  act(() => useVolumetricStore.getState().setSurfaceColorRange(def.id, [-0.05, 0.05]));
  expect(screen.getByLabelText('colour scale low')).toHaveValue('-0.05000');

  fireEvent.change(screen.getByLabelText('colour scale low'), { target: { value: '-0.1' } });
  fireEvent.change(screen.getByLabelText('colour scale high'), { target: { value: '0.1' } });
  fireEvent.blur(screen.getByLabelText('colour scale high'));
  expect(useVolumetricStore.getState().surfaces[0]!.colorRange).toEqual([-0.1, 0.1]);

  // and switching the source off takes the range with it
  fireEvent.change(screen.getByLabelText('Colour by'), { target: { value: '' } });
  const after = useVolumetricStore.getState().surfaces[0]!;
  expect(after.colorGridId).toBeNull();
  expect(after.colorRange).toBeNull();
});

test('the grid a surface is made of is not offered as its own colour source', () => {
  render(<SurfacesPanel onError={() => {}} />);
  const options = [...screen.getByLabelText('Colour by').querySelectorAll('option')];
  expect(options.map((o) => o.textContent)).toEqual(['One colour']);
});
