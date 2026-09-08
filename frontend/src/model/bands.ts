import type { BandStructure } from '../api/client';
import type { ChartSeries } from '../ui/charts/LineChart';

/** How full a band is along the whole path, relative to the reference level. */
export type BandOccupation = 'occupied' | 'partial' | 'empty';

/** What the course's ch. 6 figures call each class. */
export const OCCUPATION_LABELS: Record<BandOccupation, string> = {
  occupied: 'fully occupied',
  partial: 'partially filled',
  empty: 'empty',
};

/**
 * How close to the reference level still counts as touching it, in eV.
 *
 * Not cosmetic. The reference comes from the protocol's eigenvalue tables, printed to three
 * decimals, while the band file carries five -- so the same state is two slightly different
 * numbers, and silicon's valence bands top out 0.17 meV under their own HOMO. A strict comparison
 * calls them partially filled and draws a semiconductor as a metal. One meV covers the rounding
 * with room to spare and is far below any band feature worth seeing.
 */
export const LEVEL_TOLERANCE_EV = 1e-3;

/**
 * Whether a band is filled, empty, or cut by the reference level.
 *
 * This is the classification the course draws in Figs. 6.4 (silicon: every band wholly below or
 * wholly above the gap) and 6.9 (aluminium: bands the Fermi level runs through). `level` is a
 * Fermi level where the run has one and the top of the filled states otherwise; both are read
 * against the same rule, because a band that never reaches the level is full either way.
 */
export function bandOccupation(
  y: readonly number[],
  level: number,
  tolerance = LEVEL_TOLERANCE_EV,
): BandOccupation {
  let min = Infinity;
  let max = -Infinity;
  for (const v of y) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max <= level + tolerance) return 'occupied';
  if (min >= level - tolerance) return 'empty';
  return 'partial';
}

/** Colours for the three classes. Occupied reads as the solid line, empty as the faint one. */
export interface BandPalette {
  occupied: string;
  partial: string;
  empty: string;
}

/**
 * One chart series per band, from the backend's `energies[spin][k][band]`.
 *
 * The array is indexed by k-point first because that is how a band file is written, while a band
 * structure is drawn as one line per band across the path -- so the two inner indices have to be
 * transposed. Reading them in file order instead draws one short line per k-point.
 *
 * Each band is coloured by how full it is, which is the whole content of Figs. 6.4 and 6.9: the
 * point of the figure is which bands the Fermi level crosses. When the run reports no reference
 * level at all, nothing is classified -- every band keeps the occupied colour and the legend
 * stays empty, rather than asserting an occupation that was never measured. Spin, where there
 * are two channels, is the dash pattern, so it survives the recolouring.
 */
export function bandSeries(bands: BandStructure, palette: BandPalette): ChartSeries[] {
  const level = bands.fermi_level ?? bands.homo_energy ?? undefined;
  const polarized = bands.energies.length > 1;
  const out: ChartSeries[] = [];
  bands.energies.forEach((perSpin, spinIndex) => {
    const nBands = Math.min(...perSpin.map((row) => row.length));
    for (let band = 0; band < nBands; band++) {
      const y = perSpin.map((row) => row[band]!);
      const occupation = level === undefined ? undefined : bandOccupation(y, level);
      const spin = polarized ? (spinIndex === 0 ? ' up' : ' down') : '';
      out.push({
        id: `s${spinIndex}b${band}`,
        label: `band ${band + 1}${spin}`,
        x: bands.k_distance,
        y,
        color: palette[occupation ?? 'occupied'],
        dashed: polarized && spinIndex === 1,
        quiet: true,
        ...(occupation ? { legendGroup: OCCUPATION_LABELS[occupation] } : {}),
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
