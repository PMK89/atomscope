import type { BandStructure } from '../api/client';
import type { ChartSeries } from '../ui/charts/LineChart';

/**
 * One chart series per band, from the backend's `energies[spin][k][band]`.
 *
 * The array is indexed by k-point first because that is how a band file is written, while a band
 * structure is drawn as one line per band across the path -- so the two inner indices have to be
 * transposed. Reading them in file order instead draws one short line per k-point.
 */
export function bandSeries(bands: BandStructure, colors: readonly string[]): ChartSeries[] {
  const out: ChartSeries[] = [];
  bands.energies.forEach((perSpin, spinIndex) => {
    const nBands = Math.min(...perSpin.map((row) => row.length));
    for (let band = 0; band < nBands; band++) {
      out.push({
        id: `s${spinIndex}b${band}`,
        label: `band ${band + 1}`,
        x: bands.k_distance,
        y: perSpin.map((row) => row[band]!),
        color: colors[spinIndex % colors.length]!,
        quiet: true,
      });
    }
  });
  return out;
}

/**
 * A k-path as one readable string. A "," entry is not a point but a break in the path (the next
 * segment starts somewhere else in the zone), so it becomes a separator rather than a label.
 */
export function formatKPath(path: readonly { label: string }[]): string {
  const parts: string[] = [];
  let segment: string[] = [];
  for (const point of path) {
    if (point.label === ',') {
      if (segment.length) parts.push(segment.join(' – '));
      segment = [];
    } else {
      segment.push(point.label);
    }
  }
  if (segment.length) parts.push(segment.join(' – '));
  return parts.join(' | ');
}
