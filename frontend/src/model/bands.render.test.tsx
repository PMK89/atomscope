/**
 * Does a band structure actually reach the screen? `bandSeries` is unit-tested against synthetic
 * arrays elsewhere; this renders the real thing -- silicon's ten bands along the fcc path, as
 * `paw_bands.x` wrote them for the course's ch. 6 exercise -- through the chart the Bands section
 * uses, because the user guide has been claiming the plot comes out empty.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { BandStructure } from '../api/client';
import { bandSeries, type BandPalette } from './bands';
import { LineChart } from '../ui/charts/LineChart';
import silicon from './__fixtures__/silicon-bands.json';

const bands = silicon as unknown as BandStructure;
const PALETTE: BandPalette = { occupied: '#333', partial: '#3cb371', empty: '#9aa6b8' };

describe('band structure rendering', () => {
  it('draws one polyline per band', () => {
    const series = bandSeries(bands, PALETTE);
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

  it('splits silicon into four filled bands and six empty ones', () => {
    // Fig. 6.4. Eight valence electrons fill four bands, and silicon is a semiconductor, so no
    // band may be cut by the level: the counts are the figure's whole content. The valence bands
    // top out 0.17 meV under the reference here, which is why the tolerance exists.
    const series = bandSeries(bands, PALETTE);
    const groups = series.map((s) => s.legendGroup);
    expect(groups.filter((g) => g === 'fully occupied')).toHaveLength(4);
    expect(groups.filter((g) => g === 'partially filled')).toHaveLength(0);
    expect(groups.filter((g) => g === 'empty')).toHaveLength(6);
    // and they are the first four, in order, not four scattered ones
    expect(groups.slice(0, 4).every((g) => g === 'fully occupied')).toBe(true);
  });

  it('names the classes once each, however many bands there are', () => {
    const { container } = render(
      <LineChart series={bandSeries(bands, PALETTE)} yMarkers={[{ y: 7.398, label: 'HOMO' }]} />,
    );
    const legend = container.querySelector('.chart-legend');
    expect([...legend!.querySelectorAll('span')].map((s) => s.textContent)).toEqual([
      'fully occupied',
      'empty',
    ]);
    // the two classes have to be visibly different or the figure says nothing
    const strokes = new Set(
      [...container.querySelectorAll('polyline')].map((c) => c.getAttribute('stroke')),
    );
    expect(strokes.size).toBe(2);
    // and the level itself is on the chart, labelled for which level it is
    expect(container.textContent).toContain('HOMO');
  });

  it('picks out the bands a Fermi level runs through', () => {
    // Fig. 6.9 is a metal, and no metallic band structure has been run yet -- the iron and
    // aluminium chapters compute no path. So the level is moved into silicon's band 2 instead,
    // which is the situation the figure draws: bands the level crosses are neither full nor
    // empty. Band 1 (max -0.309) stays below it, bands 2 and 3 straddle it, and bands 4-10
    // (band 4 starts at 3.713) stay above.
    const metallic = { ...bands, fermi_level: 3 };
    const series = bandSeries(metallic, PALETTE);
    const groups = series.map((s) => s.legendGroup);
    expect(groups.filter((g) => g === 'fully occupied')).toHaveLength(1);
    expect(groups.filter((g) => g === 'partially filled')).toHaveLength(2);
    expect(groups.filter((g) => g === 'empty')).toHaveLength(7);

    const { container } = render(
      <LineChart series={series} yMarkers={[{ y: 3, label: 'E_F' }]} height={260} />,
    );
    expect([...container.querySelectorAll('.chart-legend span')].map((s) => s.textContent)).toEqual(
      ['fully occupied', 'partially filled', 'empty'],
    );
    expect(container.textContent).toContain('E_F');
  });

  it('spans the whole k path and the occupied and empty bands', () => {
    const series = bandSeries(bands, PALETTE);
    const ys = series.flatMap((s) => s.y);
    // silicon's valence-band top and the empty bands above it both have to be inside the range
    expect(Math.min(...ys)).toBeLessThan(0);
    expect(Math.max(...ys)).toBeGreaterThan(bands.homo_energy!);
    expect(series.every((s) => s.x.length === bands.k_distance.length)).toBe(true);
  });
});
