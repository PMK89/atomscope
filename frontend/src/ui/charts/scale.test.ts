import { describe, expect, it, test } from 'vitest';
import {
  extent,
  formatTick,
  invertScale,
  linearTicks,
  logTicks,
  makeScale,
  nearestIndex,
  niceStep,
  padDomain,
  positiveOnly,
} from './scale';

describe('scale helpers', () => {
  it('computes extents ignoring non-finite values', () => {
    expect(extent([3, -1, NaN, 2, Infinity])).toEqual([-1, 3]);
    expect(extent([])).toBeNull();
  });

  it('pads degenerate domains', () => {
    expect(padDomain([0, 0])).toEqual([-1, 1]);
    expect(padDomain([5, 5])).toEqual([4.5, 5.5]);
    expect(padDomain([0, 10], 0.1)).toEqual([-1, 11]);
  });

  it('chooses 1-2-5 steps', () => {
    expect(niceStep(10, 5)).toBe(2);
    expect(niceStep(1, 5)).toBe(0.2);
    expect(niceStep(0.37, 5)).toBe(0.1);
    expect(niceStep(2500, 5)).toBe(500);
  });

  it('produces linear ticks inside the domain', () => {
    expect(linearTicks([0, 10])).toEqual([0, 2, 4, 6, 8, 10]);
    expect(linearTicks([-1.3, 1.3])).toEqual([-1, -0.5, 0, 0.5, 1]);
    expect(linearTicks([7, 7])).toEqual([7]);
  });

  it('produces decade ticks for log axes', () => {
    expect(logTicks([0.003, 20])).toEqual([0.01, 0.1, 1, 10]);
    expect(logTicks([0, 1])).toEqual([]);
  });

  it('scales linearly and logarithmically with inverses', () => {
    const lin = makeScale([0, 10], [100, 0]);
    expect(lin(0)).toBe(100);
    expect(lin(5)).toBe(50);
    expect(invertScale([0, 10], [100, 0])(50)).toBeCloseTo(5);
    const log = makeScale([1, 1000], [0, 300], true);
    expect(log(10)).toBeCloseTo(100);
    expect(invertScale([1, 1000], [0, 300], true)(200)).toBeCloseTo(100);
  });

  it('formats ticks compactly', () => {
    expect(formatTick(0)).toBe('0');
    expect(formatTick(2)).toBe('2');
    expect(formatTick(0.5)).toBe('0.5');
    expect(formatTick(-1234.5678)).toBe('-1235');
    expect(formatTick(1.5e-5)).toBe('1.5e-5');
    expect(formatTick(2.5e6)).toBe('2.5e6');
  });

  it('finds the nearest sorted index', () => {
    const xs = [0, 1, 2, 3];
    expect(nearestIndex(xs, 1.4)).toBe(1);
    expect(nearestIndex(xs, 1.6)).toBe(2);
    expect(nearestIndex(xs, -5)).toBe(0);
    expect(nearestIndex(xs, 9)).toBe(3);
    expect(nearestIndex([], 1)).toBe(-1);
  });

  it('keeps only positive values for log plots', () => {
    expect(positiveOnly([0, 1, 2, 3], [0, 0.1, -1, 5])).toEqual({ x: [1, 3], y: [0.1, 5] });
  });
});

test('a tick label is precise enough to tell it from the tick beside it', () => {
  // a narrow range at a large value: four significant digits made -471.05 and -471.10 both
  // read "-471.1", which is a chart with the same number twice up its axis
  const domain: [number, number] = [-471.15, -470.95];
  const step = niceStep(domain[1] - domain[0]);
  const labels = linearTicks(domain).map((v) => formatTick(v, step));
  expect(new Set(labels).size).toBe(labels.length);
  expect(labels).toContain('-471.10');
  expect(labels).toContain('-471.05');
});

test('the step decides the decimals, so whole numbers stay whole', () => {
  expect(formatTick(-471.05, 0.05)).toBe('-471.05');
  expect(formatTick(8, 2)).toBe('8');
  expect(formatTick(0.5, 0.5)).toBe('0.5');
  expect(formatTick(0, 0.5)).toBe('0.0');
  // very large and very small still go exponential, step or no step
  expect(formatTick(1.2e6, 1e5)).toBe('1.2e6');
  expect(formatTick(1e-5, 1e-6)).toBe('1.0e-5');
});

test('without a step it behaves as it did', () => {
  expect(formatTick(0)).toBe('0');
  expect(formatTick(8)).toBe('8');
  expect(formatTick(1.23456)).toBe('1.235');
});
