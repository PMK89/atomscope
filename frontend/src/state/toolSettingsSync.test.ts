import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useToolStore } from '../editor/toolStore';
import { readLocal, writeLocal } from './localSettings';
import { applyToolSettings, pickToolSettings, startToolSettingsSync } from './toolSettingsSync';

const DEFAULTS = {
  active: 'navigate' as const,
  draw: { element: 'C', bondOrder: 1 as const, adjustHydrogens: true },
  select: { mode: 'atoms' as const, rect: null },
  bondCentric: { bond: null },
  measure: { atoms: [] },
  autoRotate: { running: false, x: 0, y: 20, z: 0 },
  autoOptimize: {
    running: false,
    forceField: 'MMFF94',
    algorithm: 'steepest_descent' as const,
    steps: 4,
    energy: null,
    energyUnit: 'eV',
    message: null,
  },
};

beforeEach(() => {
  window.localStorage.clear();
  useToolStore.setState(DEFAULTS);
});
afterEach(() => vi.restoreAllMocks());

test('only the knobs are stored: nothing that points at the open document or a live gesture', () => {
  useToolStore.setState({
    active: 'draw',
    draw: { element: 'N', bondOrder: 2, adjustHydrogens: false },
    select: { mode: 'residues', rect: { x0: 1, y0: 2, x1: 3, y1: 4 } },
    bondCentric: { bond: 7 },
    measure: { atoms: [1, 2, 3] },
    autoRotate: { running: true, x: 1, y: 2, z: 3 },
  });
  const stored = pickToolSettings(useToolStore.getState());

  expect(stored).toEqual({
    active: 'draw',
    draw: { element: 'N', bondOrder: 2, adjustHydrogens: false },
    select: { mode: 'residues' },
    autoRotate: { x: 1, y: 2, z: 3 },
    autoOptimize: { forceField: 'MMFF94', algorithm: 'steepest_descent', steps: 4 },
  });
  expect(JSON.stringify(stored)).not.toContain('rect');
  expect(JSON.stringify(stored)).not.toContain('running');
});

test('what is restored is applied; a run is never restored as running', () => {
  applyToolSettings({
    active: 'draw',
    draw: { element: 'O', bondOrder: 3, adjustHydrogens: false },
    autoOptimize: { forceField: 'UFF', algorithm: 'conjugate_gradients', steps: 12 },
  });
  const s = useToolStore.getState();
  expect(s.active).toBe('draw');
  expect(s.draw).toEqual({ element: 'O', bondOrder: 3, adjustHydrogens: false });
  expect(s.autoOptimize.forceField).toBe('UFF');
  expect(s.autoOptimize.steps).toBe(12);
  expect(s.autoOptimize.running).toBe(false);
});

test('a stored value of the wrong type is left alone, and an unknown tool is not judged here', () => {
  applyToolSettings({
    active: 'wire-cutters',
    draw: { element: 42, bondOrder: 2 },
    autoRotate: 'fast',
  } as never);
  const s = useToolStore.getState();
  // which ids exist is the plugin registry's to say, and it may not be built yet when the
  // settings load; ToolHost is what puts an unknown id right, in the store as well as in itself
  expect(s.active).toBe('wire-cutters');
  expect(s.draw.element).toBe('C'); // a number is not an element symbol
  expect(s.draw.bondOrder).toBe(2); // the field beside it is still taken
  expect(s.autoRotate.y).toBe(20);
});

test('a change is written to this browser and read back on the next start', () => {
  vi.useFakeTimers();
  const stop = startToolSettingsSync();
  useToolStore.getState().update('draw', { element: 'S' });
  vi.advanceTimersByTime(600);
  stop();
  vi.useRealTimers();

  expect(readLocal('tools', {})).toMatchObject({ draw: { element: 'S' } });
  useToolStore.setState(DEFAULTS);
  const stopAgain = startToolSettingsSync();
  expect(useToolStore.getState().draw.element).toBe('S');
  stopAgain();
});

test('a browser that refuses storage costs nothing but the memory of the settings', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('access denied');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  expect(() => writeLocal('tools', { active: 'draw' })).not.toThrow();
  expect(readLocal('tools', { active: 'navigate' })).toEqual({ active: 'navigate' });
  const stop = startToolSettingsSync();
  expect(useToolStore.getState().active).toBe('navigate');
  stop();
});
