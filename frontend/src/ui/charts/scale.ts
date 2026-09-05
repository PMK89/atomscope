/** Pure scaling/tick helpers for the inline SVG charts (no chart library). */

export type Domain = [number, number];

/** [min, max] of the finite values, or null when there are none. */
export function extent(values: readonly number[]): Domain | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : null;
}

/** Widen a degenerate or too-narrow domain so that it can be drawn. */
export function padDomain([lo, hi]: Domain, fraction = 0.05): Domain {
  if (hi === lo) {
    const d = Math.abs(lo) > 0 ? Math.abs(lo) * 0.1 : 1;
    return [lo - d, hi + d];
  }
  const pad = (hi - lo) * fraction;
  return [lo - pad, hi + pad];
}

/** A "nice" step (1, 2, 5 x 10^n) giving about `count` intervals. */
export function niceStep(span: number, count = 5): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const frac = raw / mag;
  // classic 1-2-5 rule with geometric-mean breakpoints (sqrt(2), sqrt(10), sqrt(50))
  const nice = frac < Math.SQRT2 ? 1 : frac < Math.sqrt(10) ? 2 : frac < Math.sqrt(50) ? 5 : 10;
  return nice * mag;
}

/** Linear tick positions inside [lo, hi] at nice multiples. */
export function linearTicks([lo, hi]: Domain, count = 5): number[] {
  if (!(hi > lo)) return [lo];
  const step = niceStep(hi - lo, count);
  const first = Math.ceil(lo / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = first; v <= hi + step * 1e-9 && ticks.length < 50; v += step) {
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toFixed(12)));
  }
  return ticks;
}

/** Decade ticks inside a positive [lo, hi]. */
export function logTicks([lo, hi]: Domain): number[] {
  if (!(lo > 0) || !(hi >= lo)) return [];
  const ticks: number[] = [];
  for (let e = Math.ceil(Math.log10(lo) - 1e-9); e <= Math.floor(Math.log10(hi) + 1e-9); e++) {
    ticks.push(Math.pow(10, e));
  }
  return ticks;
}

/** Map a data value into a pixel range, linearly or logarithmically (positive domain only). */
export function makeScale(domain: Domain, range: Domain, log = false): (v: number) => number {
  const [d0, d1] = log ? [Math.log10(domain[0]), Math.log10(domain[1])] : domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v: number) => {
    const t = log ? Math.log10(v) : v;
    return r0 + ((t - d0) / span) * (r1 - r0);
  };
}

/** Inverse of `makeScale` for hover lookups. */
export function invertScale(domain: Domain, range: Domain, log = false): (p: number) => number {
  const [d0, d1] = log ? [Math.log10(domain[0]), Math.log10(domain[1])] : domain;
  const [r0, r1] = range;
  const span = r1 - r0 || 1;
  return (p: number) => {
    const t = d0 + ((p - r0) / span) * (d1 - d0);
    return log ? Math.pow(10, t) : t;
  };
}

/** Compact tick label: integers as is, otherwise up to 4 significant digits or exponent form. */
export function formatTick(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(1).replace('e+', 'e');
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(4)));
}

/** Index of the entry of a non-decreasing array closest to `x` (binary search). */
export function nearestIndex(xs: readonly number[], x: number): number {
  if (xs.length === 0) return -1;
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(xs[lo - 1]! - x) <= Math.abs(xs[lo]! - x)) return lo - 1;
  return lo;
}

/** Positive part of a series for log plots (non-positive values cannot be drawn). */
export function positiveOnly(
  x: readonly number[],
  y: readonly number[],
): { x: number[]; y: number[] } {
  const ox: number[] = [];
  const oy: number[] = [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const v = y[i]!;
    if (v > 0) {
      ox.push(x[i]!);
      oy.push(v);
    }
  }
  return { x: ox, y: oy };
}
