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
    // the total is an outline; the hand-built sp3 orbital partitions nothing; the COOP is not here
    expect(outlines.map((s) => s.id)).toEqual([
      'total-none',
      'O_1-none',
      'H_2-none',
      'H_3-none',
      'o-sp3-none',
    ]);
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
