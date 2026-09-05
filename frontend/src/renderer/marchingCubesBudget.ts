/**
 * Triangle budget for marching cubes. A 10^7-voxel grid at a low isovalue can produce tens of
 * millions of triangles, which no browser survives, so the caller estimates the count first
 * (classifying a subset of the cubes) and coarsens the downsample step until the estimate fits.
 */
import {
  CORNERS,
  sampledIndices,
  type GridGeometry,
  type MarchingCubesOptions,
} from './marchingCubes';
import { TRI_TABLE } from './marchingCubesTables';

/** Default cap on the triangles a single surface may produce. */
export const MAX_TRIANGLES = 2_000_000;
/** Upper bound on the cubes classified for an estimate; the rest is extrapolated. */
const ESTIMATE_CUBES = 250_000;
/** Never coarsen past this factor. */
const MAX_STEP = 64;

/** Triangles emitted per marching-cubes case, derived from the triangle table. */
const TRIANGLES_PER_CASE = ((): Uint8Array => {
  const out = new Uint8Array(256);
  for (let c = 0; c < 256; c++) {
    let n = 0;
    while (n < 5 && TRI_TABLE[c * 16 + n * 3]! >= 0) n++;
    out[c] = n;
  }
  return out;
})();

/**
 * Approximate triangle count for meshing `values` with `opts`. Every `stride`-th cube along each
 * axis is classified and the result scaled up, so the cost is bounded regardless of grid size.
 */
export function estimateTriangles(
  values: Float32Array,
  grid: GridGeometry,
  opts: MarchingCubesOptions,
): number {
  const [n0, n1, n2] = grid.shape;
  const step = Math.max(1, Math.floor(opts.step ?? 1));
  const below = opts.inside === 'below';
  const iso = opts.isovalue;
  const idx0 = sampledIndices(n0, step);
  const idx1 = sampledIndices(n1, step);
  const idx2 = sampledIndices(n2, step);
  const c0 = idx0.length - 1;
  const c1 = idx1.length - 1;
  const c2 = idx2.length - 1;
  if (c0 <= 0 || c1 <= 0 || c2 <= 0) return 0;
  const cubes = c0 * c1 * c2;
  const stride = Math.max(1, Math.ceil(Math.cbrt(cubes / ESTIMATE_CUBES)));
  let triangles = 0;
  let counted = 0;
  for (let I = 0; I < c0; I += stride) {
    for (let J = 0; J < c1; J += stride) {
      for (let K = 0; K < c2; K += stride) {
        let cubeIndex = 0;
        for (let c = 0; c < 8; c++) {
          const o = CORNERS[c]!;
          const v = values[(idx0[I + o[0]]! * n1 + idx1[J + o[1]]!) * n2 + idx2[K + o[2]]!]!;
          if (below ? v > iso : v < iso) cubeIndex |= 1 << c;
        }
        triangles += TRIANGLES_PER_CASE[cubeIndex]!;
        counted++;
      }
    }
  }
  return counted === 0 ? 0 : Math.round((triangles / counted) * cubes);
}

/**
 * The downsample factor to mesh with: the requested one, doubled until the estimated triangle
 * count fits `maxTriangles` (or the lattice would get too small to mesh at all).
 */
export function budgetedStep(
  values: Float32Array,
  grid: GridGeometry,
  opts: MarchingCubesOptions,
  maxTriangles: number = MAX_TRIANGLES,
): number {
  let step = Math.max(1, Math.floor(opts.step ?? 1));
  while (step < MAX_STEP && estimateTriangles(values, grid, { ...opts, step }) > maxTriangles) {
    const next = step * 2;
    // a coarser lattice needs at least two cells per axis to still describe the field
    if (grid.shape.some((n) => sampledIndices(n, next).length < 3)) break;
    step = next;
  }
  return step;
}
