import { expect, test } from 'vitest';
import { bandSeries, formatKPath } from './bands';

const BANDS: Parameters<typeof bandSeries>[0] = {
  k_distance: [0, 0.5, 1],
  labels: [],
  // energies[spin][k][band]: three k-points, two bands
  energies: [
    [
      [-5, 1],
      [-4, 2],
      [-3, 3],
    ],
  ],
};

test('a band is a line across the path, not a line per k-point', () => {
  const series = bandSeries(BANDS, ['#000']);
  expect(series).toHaveLength(2);
  expect(series[0]!.y).toEqual([-5, -4, -3]);
  expect(series[1]!.y).toEqual([1, 2, 3]);
  // every series must line up with the k-point axis, or the chart draws nothing
  expect(series.every((s) => s.y.length === BANDS.k_distance.length)).toBe(true);
});

test('spin channels get their own colour', () => {
  const spinPolarized = { ...BANDS, energies: [BANDS.energies[0], BANDS.energies[0]] } as never;
  const series = bandSeries(spinPolarized, ['#a', '#b']);
  expect(series).toHaveLength(4);
  expect([series[0]!.color, series[2]!.color]).toEqual(['#a', '#b']);
});

test('a comma in the k-path is a break, not a point', () => {
  const path = [{ label: 'Γ' }, { label: 'X' }, { label: ',' }, { label: 'K' }, { label: 'Γ' }];
  expect(formatKPath(path)).toBe('Γ – X | K – Γ');
  expect(formatKPath([{ label: 'Γ' }])).toBe('Γ');
});
