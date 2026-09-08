import { describe, expect, it } from 'vitest';

import { contourLevels, cppawColor, marchingSquares, CPPAW_COLORS } from './contour';

/** A plane tilted along x: the level `L` isoline must be the vertical line x = L. */
const ramp = (nx: number, ny: number): number[][] =>
  Array.from({ length: nx }, (_, i) => Array.from({ length: ny }, () => i));

describe('marchingSquares', () => {
  it('puts the isoline exactly where the field reaches the level', () => {
    const values = ramp(4, 3);
    const x = [0, 1, 2, 3];
    const y = [0, 1, 2];
    const segs = marchingSquares(values, x, y, 1.5);
    expect(segs.length).toBeGreaterThan(0);
    // the field is i, so the 1.5 isoline is the line x = 1.5 -- interpolated, not snapped to a
    // cell edge, which is the whole point of interpolating along the edge
    for (const [x0, , x1] of segs) {
      expect(x0).toBeCloseTo(1.5, 10);
      expect(x1).toBeCloseTo(1.5, 10);
    }
  });

  it('draws nothing where the field never reaches the level', () => {
    const values = ramp(4, 3);
    expect(marchingSquares(values, [0, 1, 2, 3], [0, 1, 2], 99)).toEqual([]);
    expect(marchingSquares(values, [0, 1, 2, 3], [0, 1, 2], -1)).toEqual([]);
  });

  it('closes a peak into a loop of segments around it', () => {
    // a single high cell in the middle: the isoline below it must enclose it
    const values = [
      [0, 0, 0],
      [0, 10, 0],
      [0, 0, 0],
    ];
    const segs = marchingSquares(values, [0, 1, 2], [0, 1, 2], 5);
    // four cells each cut once => four segments forming a ring around the peak
    expect(segs).toHaveLength(4);
    // every endpoint lies strictly inside the grid, never on its outer border
    for (const [x0, y0, x1, y1] of segs) {
      for (const [a, b] of [
        [x0, y0],
        [x1, y1],
      ]) {
        expect(a).toBeGreaterThan(0);
        expect(a).toBeLessThan(2);
        expect(b!).toBeGreaterThan(0);
        expect(b!).toBeLessThan(2);
      }
    }
  });

  it('resolves a saddle consistently rather than crossing the lines', () => {
    // two opposite corners high: the ambiguous case. Either pairing is defensible, but the two
    // segments must not intersect, which is what picking by the cell mean guarantees.
    const values = [
      [10, 0],
      [0, 10],
    ];
    const segs = marchingSquares(values, [0, 1], [0, 1], 5);
    expect(segs).toHaveLength(2);
    // the midpoints of the two segments must be on opposite sides of the cell centre
    const mid = (s: readonly number[]): [number, number] => [
      (s[0]! + s[2]!) / 2,
      (s[1]! + s[3]!) / 2,
    ];
    const [ax, ay] = mid(segs[0]!);
    const [bx, by] = mid(segs[1]!);
    expect(Math.hypot(ax - bx, ay - by)).toBeGreaterThan(0.4);
  });
});

describe('contourLevels', () => {
  it('spaces levels strictly inside the range', () => {
    const levels = contourLevels(0, 4, 3);
    expect(levels).toEqual([1, 2, 3]);
    // never the extremes themselves: a level at the minimum runs along every flat region
    expect(Math.min(...levels)).toBeGreaterThan(0);
    expect(Math.max(...levels)).toBeLessThan(4);
  });

  it('has nothing to draw on a constant field', () => {
    expect(contourLevels(1, 1, 10)).toEqual([]);
    expect(contourLevels(0, 1, 0)).toEqual([]);
  });
});

describe('cppawColor', () => {
  it('runs from the first stop to the last', () => {
    expect(cppawColor(0)).toBe('rgb(0,0,144)');
    expect(cppawColor(1)).toBe('rgb(127,0,0)');
    expect(CPPAW_COLORS[0]).toBe('#000090');
  });

  it('interpolates between stops and clamps outside', () => {
    expect(cppawColor(0.5)).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    expect(cppawColor(-5)).toBe(cppawColor(0));
    expect(cppawColor(5)).toBe(cppawColor(1));
    // midway between the first two stops, halfway in each channel
    expect(cppawColor(1 / 16)).toBe('rgb(0,8,200)');
  });
});
