import { describe, expect, it } from 'vitest';
import type { OrbitalEntry } from '../../api/client';
import { channelOrbitals, channels, homoIndex, lumoIndex, stepIndex } from './orbitals';

const o = (band: number, occupation: number, kpoint = 1, spin = 1): OrbitalEntry => ({
  band,
  kpoint,
  spin,
  energy: band,
  occupation,
  label: occupation > 0 ? 'HOMO' : 'LUMO',
  grid_id: null,
});

describe('orbital list helpers', () => {
  const all = [o(2, 2), o(1, 2), o(3, 0), o(1, 1, 2, 1), o(1, 1, 1, 2), o(2, 0, 1, 2)];

  it('filters one k-point/spin channel sorted by band', () => {
    expect(channelOrbitals(all, 1, 1).map((x) => x.band)).toEqual([1, 2, 3]);
    expect(channelOrbitals(all, 1, 2).map((x) => x.band)).toEqual([1, 2]);
    expect(channelOrbitals(all, 3, 1)).toEqual([]);
  });

  it('locates HOMO and LUMO', () => {
    const rows = channelOrbitals(all, 1, 1);
    expect(homoIndex(rows)).toBe(1);
    expect(lumoIndex(rows)).toBe(2);
    expect(homoIndex([o(1, 0)])).toBe(-1);
    expect(lumoIndex([o(1, 2)])).toBe(-1);
    expect(lumoIndex([])).toBe(-1);
  });

  it('steps with clamping', () => {
    expect(stepIndex(1, 1, 3)).toBe(2);
    expect(stepIndex(2, 1, 3)).toBe(2);
    expect(stepIndex(0, -1, 3)).toBe(0);
    expect(stepIndex(-1, 1, 3)).toBe(0);
    expect(stepIndex(-1, -1, 3)).toBe(2);
    expect(stepIndex(0, 1, 0)).toBe(-1);
  });

  it('lists the available channels', () => {
    expect(channels(all)).toEqual({ kpoints: [1, 2], spins: [1, 2] });
    expect(channels([])).toEqual({ kpoints: [], spins: [] });
  });
});
