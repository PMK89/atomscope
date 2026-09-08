import { expect, test } from 'vitest';
import { bandOccupation, bandSeries, formatKPath, type BandPalette } from './bands';

const PALETTE: BandPalette = { occupied: '#000', partial: '#0f0', empty: '#ccc' };

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
  const series = bandSeries(BANDS, PALETTE);
  expect(series).toHaveLength(2);
  expect(series[0]!.y).toEqual([-5, -4, -3]);
  expect(series[1]!.y).toEqual([1, 2, 3]);
  // every series must line up with the k-point axis, or the chart draws nothing
  expect(series.every((s) => s.y.length === BANDS.k_distance.length)).toBe(true);
});

test('spin channels stay apart once colour means occupation', () => {
  const spinPolarized = { ...BANDS, energies: [BANDS.energies[0], BANDS.energies[0]] } as never;
  const series = bandSeries(spinPolarized, PALETTE);
  expect(series).toHaveLength(4);
  // colour is the occupation class now, so spin down is the dashed channel instead
  expect(series.map((s) => s.dashed ?? false)).toEqual([false, false, true, true]);
  expect(series.map((s) => s.label)).toEqual([
    'band 1 up',
    'band 2 up',
    'band 1 down',
    'band 2 down',
  ]);
});

test('classifies a band by where the level cuts it', () => {
  // wholly below, wholly above, and crossing
  expect(bandOccupation([-5, -4, -3], 0)).toBe('occupied');
  expect(bandOccupation([1, 2, 3], 0)).toBe('empty');
  expect(bandOccupation([-1, 0.5, 2], 0)).toBe('partial');
});

test('a band touching the level is still whole', () => {
  // the reference is rounded to fewer digits than the band file, so a full band can read a
  // fraction of a meV over its own HOMO -- without the tolerance a semiconductor becomes a metal
  expect(bandOccupation([-5, 7.39786], 7.398)).toBe('occupied');
  expect(bandOccupation([7.3999, 9], 7.398)).toBe('empty');
  // and a real crossing is still a crossing: 1 meV is far below any band feature
  expect(bandOccupation([-5, 7.41], 7.398)).toBe('partial');
});

test('classifies nothing when the run reported no level', () => {
  const series = bandSeries({ ...BANDS, fermi_level: null, homo_energy: null } as never, PALETTE);
  expect(series.every((s) => s.legendGroup === undefined)).toBe(true);
  expect(series.every((s) => s.color === PALETTE.occupied)).toBe(true);
});

test('a comma in the k-path is a break, not a point', () => {
  const path = [{ label: 'Γ' }, { label: 'X' }, { label: ',' }, { label: 'K' }, { label: 'Γ' }];
  expect(formatKPath(path)).toBe('Γ – X | K – Γ');
  expect(formatKPath([{ label: 'Γ' }])).toBe('Γ');
});
