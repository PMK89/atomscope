/**
 * Filled areas for stacked charts: a band between a baseline and a top edge, optionally split at
 * one x value so the two halves can be drawn at different opacities.
 *
 * The split exists for the density of states, where the course's figures shade the states below
 * the Fermi level solid and the empty ones above it faint. The boundary is *interpolated* onto
 * the split x rather than snapped to the nearest grid point, so the edge is vertical at E_F --
 * `asecppaw` duplicates the last occupied sample instead, which is an xmgrace workaround.
 */

export interface AreaSpan {
  x: number[];
  top: number[];
  base: number[];
  /** false for the part beyond the split, which is drawn faint */
  solid: boolean;
}

function at(xs: readonly number[], vs: readonly number[], i: number, x: number): number {
  const x0 = xs[i - 1]!;
  const x1 = xs[i]!;
  const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
  return vs[i - 1]! + t * (vs[i]! - vs[i - 1]!);
}

/**
 * One span, or two when `splitX` falls strictly inside the data. Both spans get the interpolated
 * boundary point, so the two fills meet exactly with no seam and no overlap.
 */
export function areaSpans(
  x: readonly number[],
  y: readonly number[],
  baseline: readonly number[],
  splitX?: number,
): AreaSpan[] {
  const n = Math.min(x.length, y.length, baseline.length);
  if (n < 2) return [];
  const whole = (solid: boolean): AreaSpan[] => [
    { x: [...x.slice(0, n)], top: [...y.slice(0, n)], base: [...baseline.slice(0, n)], solid },
  ];
  if (splitX === undefined || Number.isNaN(splitX)) return whole(true);
  // the split has to be strictly inside: at or beyond either end there is only one region
  if (splitX <= x[0]!) return whole(false);
  if (splitX >= x[n - 1]!) return whole(true);

  const cut = x.findIndex((v, i) => i < n && v > splitX);
  const lo: AreaSpan = {
    x: [...x.slice(0, cut), splitX],
    top: [...y.slice(0, cut), at(x, y, cut, splitX)],
    base: [...baseline.slice(0, cut), at(x, baseline, cut, splitX)],
    solid: true,
  };
  const hi: AreaSpan = {
    x: [splitX, ...x.slice(cut, n)],
    top: [at(x, y, cut, splitX), ...y.slice(cut, n)],
    base: [at(x, baseline, cut, splitX), ...baseline.slice(cut, n)],
    solid: false,
  };
  return [lo, hi];
}

/** `M`-`L`-`Z` polygon: the top edge forward, then the baseline back. */
export function areaPath(
  span: AreaSpan,
  sx: (v: number) => number,
  sy: (v: number) => number,
): string {
  const forward = span.x.map((x, i) => `${sx(x).toFixed(1)} ${sy(span.top[i]!).toFixed(1)}`);
  const back = span.x
    .map((x, i) => `${sx(x).toFixed(1)} ${sy(span.base[i]!).toFixed(1)}`)
    .reverse();
  return `M${forward.join('L')}L${back.join('L')}Z`;
}
