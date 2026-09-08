/**
 * Contour lines over a regular grid, by marching squares.
 *
 * The course draws its ch. 3 field cuts with gnuplot's `set contour`; this is the same picture
 * from the same numbers. Each cell of the grid contributes at most two segments per level, found
 * by linear interpolation along the cell edges the level crosses -- so a line lands exactly where
 * the field reaches the level, rather than on a cell boundary.
 *
 * The ambiguous saddle case (two opposite corners above the level, two below) is resolved with
 * the cell's mean value, which is the standard choice and keeps neighbouring cells consistent.
 */

/** A polyline in data coordinates. Segments are emitted per cell and not stitched into loops. */
export type Segment = readonly [number, number, number, number];

/**
 * The CP-PAW colour scale, as `asecppaw` defines it (`visualize.py`, `cppawColors`; GPL-3.0, as
 * is Atomscope -- see docs/provenance.md). Blue through green and yellow to dark red.
 */
export const CPPAW_COLORS = [
  '#000090',
  '#000fff',
  '#0090ff',
  '#0fffee',
  '#90ff70',
  '#ffee00',
  '#ff7000',
  '#ee0000',
  '#7f0000',
] as const;

const hex = (c: string): [number, number, number] => [
  parseInt(c.slice(1, 3), 16),
  parseInt(c.slice(3, 5), 16),
  parseInt(c.slice(5, 7), 16),
];

/** `t` in [0,1] along the CP-PAW scale, linearly interpolated between its nine stops. */
export function cppawColor(t: number): string {
  const clamped = Math.min(Math.max(t, 0), 1);
  const pos = clamped * (CPPAW_COLORS.length - 1);
  const i = Math.min(Math.floor(pos), CPPAW_COLORS.length - 2);
  const f = pos - i;
  const a = hex(CPPAW_COLORS[i]!);
  const b = hex(CPPAW_COLORS[i + 1]!);
  const mix = a.map((v, k) => Math.round(v + (b[k]! - v) * f));
  return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
}

/**
 * `count` levels spanning [min, max].
 *
 * A field that is entirely one value has no contours to draw -- returning a level anyway would
 * paint a line along every cell edge.
 */
export function contourLevels(min: number, max: number, count: number): number[] {
  if (!(max > min) || count < 1) return [];
  const step = (max - min) / (count + 1);
  return Array.from({ length: count }, (_, i) => min + step * (i + 1));
}

/** Where `level` sits between `va` and `vb`, as a fraction of the way from a to b. */
const frac = (va: number, vb: number, level: number): number =>
  va === vb ? 0.5 : (level - va) / (vb - va);

/**
 * Segments of the `level` isoline of `values[ix][iy]`, in the coordinates given by `x` and `y`.
 */
export function marchingSquares(
  values: readonly (readonly number[])[],
  x: readonly number[],
  y: readonly number[],
  level: number,
): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i + 1 < x.length; i++) {
    for (let j = 0; j + 1 < y.length; j++) {
      // corners anticlockwise from the lower left, as the standard case numbering expects
      const bl = values[i]![j]!;
      const br = values[i + 1]![j]!;
      const tr = values[i + 1]![j + 1]!;
      const tl = values[i]![j + 1]!;
      let code =
        (bl > level ? 1 : 0) | (br > level ? 2 : 0) | (tr > level ? 4 : 0) | (tl > level ? 8 : 0);
      if (code === 0 || code === 15) continue;

      const x0 = x[i]!;
      const x1 = x[i + 1]!;
      const y0 = y[j]!;
      const y1 = y[j + 1]!;
      // the crossing on each edge, named for the edge it lies on
      const bottom: [number, number] = [x0 + (x1 - x0) * frac(bl, br, level), y0];
      const right: [number, number] = [x1, y0 + (y1 - y0) * frac(br, tr, level)];
      const top: [number, number] = [x0 + (x1 - x0) * frac(tl, tr, level), y1];
      const left: [number, number] = [x0, y0 + (y1 - y0) * frac(bl, tl, level)];

      // the saddles: pick the pairing the cell's own mean supports, so that two cells sharing an
      // edge cannot disagree about which way the line turns
      if (code === 5 || code === 10) {
        const mean = (bl + br + tr + tl) / 4;
        if (mean > level) code = code === 5 ? 10 : 5;
      }

      const push = (a: [number, number], b: [number, number]): void => {
        out.push([a[0], a[1], b[0], b[1]]);
      };
      switch (code) {
        case 1:
        case 14:
          push(left, bottom);
          break;
        case 2:
        case 13:
          push(bottom, right);
          break;
        case 3:
        case 12:
          push(left, right);
          break;
        case 4:
        case 11:
          push(right, top);
          break;
        case 6:
        case 9:
          push(bottom, top);
          break;
        case 7:
        case 8:
          push(left, top);
          break;
        case 5:
          push(left, top);
          push(bottom, right);
          break;
        case 10:
          push(left, bottom);
          push(right, top);
          break;
        default:
          break;
      }
    }
  }
  return out;
}
