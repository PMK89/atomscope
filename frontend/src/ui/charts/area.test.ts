import { describe, expect, it } from 'vitest';

import { areaPath, areaSpans } from './area';

const x = [0, 1, 2, 3, 4];
const y = [1, 2, 3, 4, 5];
const base = [0, 0, 0, 0, 0];

describe('areaSpans', () => {
  it('is one span when there is no split', () => {
    const [span, ...rest] = areaSpans(x, y, base);
    expect(rest).toHaveLength(0);
    expect(span!.solid).toBe(true);
    expect(span!.x).toEqual(x);
  });

  it('interpolates the boundary onto the split so the edge is vertical', () => {
    const [lo, hi] = areaSpans(x, y, base, 1.5);
    // 1.5 falls between samples: both halves get the interpolated point, neither the raw one
    expect(lo!.x).toEqual([0, 1, 1.5]);
    expect(lo!.top).toEqual([1, 2, 2.5]);
    expect(hi!.x).toEqual([1.5, 2, 3, 4]);
    expect(hi!.top).toEqual([2.5, 3, 4, 5]);
    expect(lo!.solid).toBe(true);
    expect(hi!.solid).toBe(false);
    // they meet exactly: no seam, no overlap
    expect(lo!.x.at(-1)).toBe(hi!.x[0]);
    expect(lo!.top.at(-1)).toBe(hi!.top[0]);
  });

  it('interpolates the baseline too, not just the top', () => {
    const sloped = [0, 1, 2, 3, 4];
    const [lo, hi] = areaSpans(x, y, sloped, 2.5);
    expect(lo!.base.at(-1)).toBeCloseTo(2.5);
    expect(hi!.base[0]).toBeCloseTo(2.5);
  });

  it('is a single span when the split is at or outside either end', () => {
    expect(areaSpans(x, y, base, 0)).toHaveLength(1);
    expect(areaSpans(x, y, base, 0)[0]!.solid).toBe(false); // everything is above it
    expect(areaSpans(x, y, base, 4)).toHaveLength(1);
    expect(areaSpans(x, y, base, 4)[0]!.solid).toBe(true); // everything is below it
    expect(areaSpans(x, y, base, -10)[0]!.solid).toBe(false);
    expect(areaSpans(x, y, base, 99)[0]!.solid).toBe(true);
  });

  it('draws nothing from a degenerate series', () => {
    expect(areaSpans([0], [1], [0])).toEqual([]);
    expect(areaSpans([], [], [])).toEqual([]);
  });
});

describe('areaPath', () => {
  it('closes the polygon: top edge forward, baseline back', () => {
    const [span] = areaSpans([0, 1], [2, 3], [0, 1]);
    const d = areaPath(
      span!,
      (v) => v * 10,
      (v) => 100 - v * 10,
    );
    expect(d).toBe('M0.0 80.0L10.0 70.0L10.0 90.0L0.0 100.0Z');
  });
});
