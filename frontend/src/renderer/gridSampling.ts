/**
 * Sampling a volumetric grid at arbitrary points, and turning those values into vertex colours.
 *
 * This is what "colour a surface by a second grid" needs: the electrostatic potential mapped onto
 * an electron-density isosurface is the standard picture of a molecule's reactivity, and it is
 * two grids -- the shape from one, the colour from the other.
 */
import { invert3, mulRow } from '../model/geometry';
import type { Mat3, Vec3 } from '../model/structure';
import type { GridGeometry } from './marchingCubes';

/** Sample `values` at world point `p` by trilinear interpolation; outside the grid, the edge. */
export function makeSampler(values: Float32Array, geometry: GridGeometry): (p: Vec3) => number {
  const [nx, ny, nz] = geometry.shape;
  // the grid axes need not be orthogonal (a triclinic cell), so go through the inverse basis
  const inverse = invert3(geometry.axes as unknown as Mat3);
  const origin = geometry.origin;
  const at = (i: number, j: number, k: number): number => values[(i * ny + j) * nz + k] ?? 0;

  return (p: Vec3): number => {
    const fractional = mulRow([p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]], inverse);
    const clamped = [
      Math.min(nx - 1, Math.max(0, fractional[0])),
      Math.min(ny - 1, Math.max(0, fractional[1])),
      Math.min(nz - 1, Math.max(0, fractional[2])),
    ];
    const i = Math.min(nx - 2, Math.floor(clamped[0]!));
    const j = Math.min(ny - 2, Math.floor(clamped[1]!));
    const k = Math.min(nz - 2, Math.floor(clamped[2]!));
    const fi = clamped[0]! - i;
    const fj = clamped[1]! - j;
    const fk = clamped[2]! - k;
    // a grid with a single plane along an axis has nothing to interpolate along it
    const i1 = nx > 1 ? i + 1 : i;
    const j1 = ny > 1 ? j + 1 : j;
    const k1 = nz > 1 ? k + 1 : k;
    const c00 = at(i, j, k) * (1 - fi) + at(i1, j, k) * fi;
    const c01 = at(i, j, k1) * (1 - fi) + at(i1, j, k1) * fi;
    const c10 = at(i, j1, k) * (1 - fi) + at(i1, j1, k) * fi;
    const c11 = at(i, j1, k1) * (1 - fi) + at(i1, j1, k1) * fi;
    const c0 = c00 * (1 - fj) + c10 * fj;
    const c1 = c01 * (1 - fj) + c11 * fj;
    return c0 * (1 - fk) + c1 * fk;
  };
}

/** Blue for the low end, white in the middle, red for the high end: the electrostatic convention. */
export function divergingColor(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  if (x < 0.5) {
    const u = x * 2;
    return [u, u, 1];
  }
  const u = (x - 0.5) * 2;
  return [1, 1 - u, 1 - u];
}

/** Values sampled at every vertex, and the range they span. */
export function sampleAtVertices(
  positions: Float32Array,
  sampler: (p: Vec3) => number,
): { values: Float32Array; min: number; max: number } {
  const n = positions.length / 3;
  const values = new Float32Array(n);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = sampler([positions[3 * i]!, positions[3 * i + 1]!, positions[3 * i + 2]!]);
    values[i] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { values, min: n ? min : 0, max: n ? max : 0 };
}

/** Vertex colours from sampled values over `[low, high]`; equal bounds give the middle colour. */
export function colorsFromValues(values: Float32Array, low: number, high: number): Float32Array {
  const out = new Float32Array(values.length * 3);
  const span = high - low;
  for (let i = 0; i < values.length; i++) {
    const t = span > 0 ? (values[i]! - low) / span : 0.5;
    const [r, g, b] = divergingColor(t);
    out[3 * i] = r;
    out[3 * i + 1] = g;
    out[3 * i + 2] = b;
  }
  return out;
}
