/**
 * The stacked DOS, against the real thing: water's density of states as `paw_dos.x` wrote it for
 * the course's ch. 2/3 exercise, with per-atom weights, their s and p channels, a hand-built sp3
 * orbital weight and a COOP all in the same file.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { DosSpectrum } from '../api/client';
import { stackedDosSeries } from './dosStack';
import { LineChart } from '../ui/charts/LineChart';
import water from './__fixtures__/water-dos.json';

const dos = water as unknown as DosSpectrum;
const level = dos.fermi_level ?? dos.homo_energy ?? undefined;
const color = (): string => '#4488ff';

describe('stackedDosSeries', () => {
  it('stacks the finest requested partition and nothing else', () => {
    const { stacked, outlines } = stackedDosSeries(dos, level, color);

    // O has s and p, both hydrogens only s -- so the l channels are the partition, not the atoms
    expect(stacked.map((s) => s.id)).toEqual([
      'O_1_s-none',
      'O_1_p-none',
      'H_2_s-none',
      'H_3_s-none',
    ]);
    // the whole-atom weights would double-count against their own channels
    expect(stacked.map((s) => s.id)).not.toContain('O_1-none');
    // the total is an outline, and so is the hand-built sp3 orbital, which partitions nothing
    expect(outlines.map((s) => s.id)).toEqual(['total-none', 'o-sp3-none']);
    // the whole-atom weights are the sums of the channels being stacked: drawing them as well
    // would put the same states on the chart twice
    expect(outlines.map((s) => s.id)).not.toContain('O_1-none');
    expect([...stacked, ...outlines].map((s) => s.id)).not.toContain('o-h-none');
  });

  it('each band sits on the one below it', () => {
    const { stacked } = stackedDosSeries(dos, level, color);
    expect(stacked[0]!.baseline!.every((v) => v === 0)).toBe(true);
    for (let i = 1; i < stacked.length; i++) {
      expect(stacked[i]!.baseline).toEqual(stacked[i - 1]!.y);
    }
    // and the cumulative top never exceeds the total it partitions
    const total = dos.series.find((s) => s.id === 'total')!;
    const top = stacked[stacked.length - 1]!.y;
    for (let k = 0; k < top.length; k++) {
      expect(top[k]!).toBeLessThanOrEqual(total.dos[k]! + 1e-6);
    }
  });

  it('shades the occupied side solid and the empty side faint', () => {
    const { stacked } = stackedDosSeries(dos, level, color);
    const { container } = render(<LineChart series={stacked} height={240} />);
    const fills = [...container.querySelectorAll('path')];
    // two spans per stacked series: below the Fermi level and above it
    expect(fills).toHaveLength(2 * stacked.length);

    const faint = fills.filter((p) => Number(p.getAttribute('fill-opacity')) < 0.5);
    expect(faint).toHaveLength(stacked.length);
    for (const p of fills) {
      expect(p.getAttribute('d')).toMatch(/^M[\d.]+ [\d.]+(L[\d.]+ [\d.]+)+Z$/);
    }
  });

  it('does not split when there is no Fermi level to split at', () => {
    const { stacked } = stackedDosSeries(dos, undefined, color);
    expect(stacked.every((s) => s.fillSplitX === undefined)).toBe(true);
    const { container } = render(<LineChart series={stacked} height={240} />);
    expect(container.querySelectorAll('path')).toHaveLength(stacked.length);
  });
});

describe('stackedDosSeries, spin polarized', () => {
  /**
   * Fig. 7.1 (iron) and 7.3 (NiO) are mirrored stacks: majority spin up, minority down. No
   * polarized course run exists yet, so the water DOS is mirrored into two channels here --
   * CP-PAW writes spin down negative, which is the convention `DosSeries` keeps.
   */
  const polarized = {
    ...dos,
    series: dos.series.flatMap((s) => [
      { ...s, spin: 'up' as const },
      { ...s, spin: 'down' as const, dos: s.dos.map((v) => -v) },
    ]),
  };

  it('accumulates each spin channel on its own side of zero', () => {
    const { stacked } = stackedDosSeries(polarized, level, color);
    expect(stacked).toHaveLength(8); // four weights, two spins

    const up = stacked.filter((s) => s.id.endsWith('-up'));
    const down = stacked.filter((s) => s.id.endsWith('-down'));
    expect(up).toHaveLength(4);
    expect(down).toHaveLength(4);

    // both stacks start at zero and grow away from it, never crossing
    expect(up[0]!.baseline!.every((v) => v === 0)).toBe(true);
    expect(down[0]!.baseline!.every((v) => v === 0)).toBe(true);
    expect(up.at(-1)!.y.some((v) => v > 0)).toBe(true);
    expect(down.at(-1)!.y.every((v) => v <= 0)).toBe(true);
    // and each band still sits on the one below it, within its own channel
    for (let i = 1; i < up.length; i++) expect(up[i]!.baseline).toEqual(up[i - 1]!.y);
    for (let i = 1; i < down.length; i++) expect(down[i]!.baseline).toEqual(down[i - 1]!.y);
  });

  it('gives the two spins of one projection the same colour', () => {
    const palette = ['#a00', '#0a0', '#00a', '#aa0'];
    const { stacked } = stackedDosSeries(polarized, level, (_s, i) => palette[i % 4]!);
    const of = (id: string): string => stacked.find((s) => s.id === id)!.color;

    // the mirrored halves of one projection are one region of the figure, so one colour
    expect(of('O_1_s-up')).toBe(of('O_1_s-down'));
    expect(of('O_1_p-up')).toBe(of('O_1_p-down'));
    // and different projections stay distinguishable
    expect(of('O_1_s-up')).not.toBe(of('O_1_p-up'));
    expect(new Set(stacked.map((s) => s.color)).size).toBe(4);
  });

  it('shades both sides at the Fermi level', () => {
    const { stacked } = stackedDosSeries(polarized, level, color);
    const { container } = render(<LineChart series={stacked} height={240} />);
    // two spans per band on both sides of zero
    expect(container.querySelectorAll('path')).toHaveLength(2 * 8);
    expect(container.querySelectorAll('path[fill-opacity="0.35"]')).toHaveLength(8);
  });

  it('does not collide the total outline with the first band', () => {
    const palette = ['#a00', '#0a0', '#00a', '#aa0', '#000', '#555'];
    const { stacked, outlines } = stackedDosSeries(dos, level, (_s, i) => palette[i]!);
    const stackColours = new Set(stacked.map((s) => s.color));
    for (const o of outlines) expect(stackColours.has(o.color)).toBe(false);
  });
});
