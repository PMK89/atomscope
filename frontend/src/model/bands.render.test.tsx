/**
 * Does a band structure actually reach the screen? `bandSeries` is unit-tested against synthetic
 * arrays elsewhere; this renders the real thing -- silicon's ten bands along the fcc path, as
 * `paw_bands.x` wrote them for the course's ch. 6 exercise -- through the chart the Bands section
 * uses, because the user guide has been claiming the plot comes out empty.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { BandStructure } from '../api/client';
import { bandSeries } from './bands';
import { LineChart } from '../ui/charts/LineChart';
import silicon from './__fixtures__/silicon-bands.json';

const bands = silicon as unknown as BandStructure;

describe('band structure rendering', () => {
  it('draws one polyline per band', () => {
    const series = bandSeries(bands, ['#4488ff', '#ff8844']);
    expect(series).toHaveLength(10);

    const { container } = render(
      <LineChart
        series={series}
        xTicks={bands.labels.map((l) => ({ value: l.distance, label: l.label }))}
        markers={bands.labels.map((l) => ({ x: l.distance }))}
        xLabel="k"
        yLabel="E [eV]"
        title="Band structure"
        height={260}
      />,
    );

    const curves = [...container.querySelectorAll('polyline')];
    expect(curves).toHaveLength(10);
    for (const c of curves) {
      const points = (c.getAttribute('points') ?? '').split(' ');
      expect(points).toHaveLength(bands.k_distance.length);
      // every vertex a real coordinate pair: a NaN anywhere silently erases the whole polyline
      for (const pt of points) expect(pt).toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
    }
  });

  it('spans the whole k path and the occupied and empty bands', () => {
    const series = bandSeries(bands, ['#4488ff']);
    const ys = series.flatMap((s) => s.y);
    // silicon's valence-band top and the empty bands above it both have to be inside the range
    expect(Math.min(...ys)).toBeLessThan(0);
    expect(Math.max(...ys)).toBeGreaterThan(bands.homo_energy!);
    expect(series.every((s) => s.x.length === bands.k_distance.length)).toBe(true);
  });
});
