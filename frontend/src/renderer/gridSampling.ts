/**
 * Sampling a volumetric grid at arbitrary points, and turning those values into vertex colours.
 *
 * This is what "colour a surface by a second grid" needs: the electrostatic potential mapped onto
 * an electron-density isosurface is the standard picture of a molecule's reactivity, and it is
 * two grids -- the shape from one, the colour from the other.
 */
import { invert3, type Mat3 } from '../model/geometry';
import type { GridGeometry } from './marchingCubes';

/** Samples one grid at a world point. Three numbers, not a vector: it runs once per vertex. */
export type Sampler = (x: number, y: number, z: number) => number;

/** Sample `values` at a world point by trilinear interpolation; outside the grid, the edge. */
export function makeSampler(values: Float32Array, geometry: GridGeometry): Sampler {
  const [nx, ny, nz] = geometry.shape;
  // the grid axes need not be orthogonal (a triclinic cell), so go through the inverse basis
  const inverse = invert3(geometry.axes as unknown as Mat3);
  const [[m00, m10, m20], [m01, m11, m21], [m02, m12, m22]] = inverse;
  const [ox, oy, oz] = geometry.origin;
  const at = (i: number, j: number, k: number): number => values[(i * ny + j) * nz + k] ?? 0;

  return (x: number, y: number, z: number): number => {
    const dx = x - ox;
    const dy = y - oy;
    const dz = z - oz;
    // row vector times the inverse basis, written out so nothing is allocated per vertex
    const u = Math.min(nx - 1, Math.max(0, dx * m00 + dy * m01 + dz * m02));
    const v = Math.min(ny - 1, Math.max(0, dx * m10 + dy * m11 + dz * m12));
    const w = Math.min(nz - 1, Math.max(0, dx * m20 + dy * m21 + dz * m22));
    const i = Math.min(nx - 2, Math.floor(u));
    const j = Math.min(ny - 2, Math.floor(v));
    const k = Math.min(nz - 2, Math.floor(w));
    const fi = u - i;
    const fj = v - j;
    const fk = w - k;
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
  sampler: Sampler,
): { values: Float32Array; min: number; max: number } {
  const n = positions.length / 3;
  const values = new Float32Array(n);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = sampler(positions[3 * i]!, positions[3 * i + 1]!, positions[3 * i + 2]!);
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

/**
 * Default scale for a signed field: symmetric about zero, so white always means zero. An
 * electrostatic potential running from -0.08 to +0.03 would otherwise put white at -0.025 and
 * paint the neutral part of the surface as if it were positive.
 */
export function symmetricRange(min: number, max: number): [number, number] {
  const m = Math.max(Math.abs(min), Math.abs(max));
  return [-m, m];
}
