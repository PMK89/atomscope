/**
 * Marching cubes (Lorensen & Cline, SIGGRAPH 1987) on a regular, possibly non-orthogonal grid.
 *
 * The grid is a Float32Array in C order matching `shape` (index (i, j, k) at
 * `(i * n1 + j) * n2 + k`), and sample (i, j, k) sits at `origin + i*a0 + j*a1 + k*a2`. The
 * output is an indexed mesh with shared vertices (one per intersected cell edge), so it is
 * watertight wherever the field is; vertex normals come from the interpolated field gradient
 * (mapped from index space to world space with the inverse axis matrix) and point away from
 * the enclosed region. Lookup tables: see ./marchingCubesTables.ts.
 */
import { EDGE_TABLE, TRI_TABLE } from './marchingCubesTables';

export type Vec3 = [number, number, number];

export interface GridGeometry {
  shape: [number, number, number];
  origin: Vec3;
  /** step vectors: row d is the displacement for one step along index d */
  axes: [Vec3, Vec3, Vec3];
}

export interface MarchingCubesOptions {
  isovalue: number;
  /** downsample factor: use every `step`-th sample along each axis (1 = full resolution) */
  step?: number;
  /**
   * Which side of the isosurface is "inside". `above` (default) encloses `f >= isovalue`, the
   * right choice for densities and positive orbital lobes; `below` encloses `f <= isovalue`,
   * used for negative lobes so that normals and winding still face outward.
   */
  inside?: 'above' | 'below';
}

export interface IsosurfaceMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

/** Corner offsets in Bourke's order (see marchingCubesTables.ts). */
const CORNERS: ReadonlyArray<Vec3> = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];
/** Corner pairs of the 12 edges. */
const EDGES: ReadonlyArray<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

function invert3(m: [Vec3, Vec3, Vec3]): { inv: number[]; det: number } {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const s = 1 / det;
  // inverse as row-major flat array
  return {
    det,
    inv: [
      A * s,
      -(b * i - c * h) * s,
      (b * f - c * e) * s,
      B * s,
      (a * i - c * g) * s,
      -(a * f - c * d) * s,
      C * s,
      -(a * h - b * g) * s,
      (a * e - b * d) * s,
    ],
  };
}

/**
 * Fine-grid indices sampled along one axis for a downsample factor: `0, step, 2*step, …` always
 * closed by `n - 1`, so the last (possibly shorter) slab is meshed instead of being dropped.
 */
export function sampledIndices(n: number, step: number): Int32Array {
  if (n <= 1) return Int32Array.of(0);
  const s = Math.max(1, Math.floor(step));
  const out: number[] = [];
  for (let i = 0; i < n - 1; i += s) out.push(i);
  out.push(n - 1);
  return Int32Array.from(out);
}

export function marchingCubes(
  values: Float32Array,
  grid: GridGeometry,
  opts: MarchingCubesOptions,
): IsosurfaceMesh {
  const [n0, n1, n2] = grid.shape;
  const step = Math.max(1, Math.floor(opts.step ?? 1));
  const iso = opts.isovalue;
  const below = opts.inside === 'below';
  if (values.length !== n0 * n1 * n2) throw new Error('values length does not match shape');
  // sampled fine-grid indices per axis; the final stride may be shorter than `step`
  const idx0 = sampledIndices(n0, step);
  const idx1 = sampledIndices(n1, step);
  const idx2 = sampledIndices(n2, step);
  const m0 = idx0.length;
  const m1 = idx1.length;
  const m2 = idx2.length;
  const { inv, det } = invert3(grid.axes);
  const swapWinding = det < 0;
  const sample = (I: number, J: number, K: number): number =>
    values[(idx0[I]! * n1 + idx1[J]!) * n2 + idx2[K]!]!;

  /** Central difference along one axis, one-sided at the borders, per fine-index unit. */
  const derivative = (
    at: number,
    m: number,
    ix: Int32Array,
    f: (offset: number) => number,
  ): number => {
    const lo = at === 0 ? 0 : at - 1;
    const hi = at === m - 1 ? at : at + 1;
    const span = ix[hi]! - ix[lo]!;
    return span === 0 ? 0 : (f(hi - at) - f(lo - at)) / span;
  };

  // index-space gradient (per fine-grid index) by central differences
  const gradAt = (I: number, J: number, K: number, out: Vec3): void => {
    out[0] = derivative(I, m0, idx0, (d) => sample(I + d, J, K));
    out[1] = derivative(J, m1, idx1, (d) => sample(I, J + d, K));
    out[2] = derivative(K, m2, idx2, (d) => sample(I, J, K + d));
  };

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const edgeVertex = new Map<number, number>();
  const ga: Vec3 = [0, 0, 0];
  const gb: Vec3 = [0, 0, 0];
  const cornerValues = new Float64Array(8);
  const cornerVertex = new Int32Array(12);

  const vertexOnEdge = (I: number, J: number, K: number, e: number): number => {
    const [ca, cb] = EDGES[e]!;
    const A = CORNERS[ca]!;
    const B = CORNERS[cb]!;
    // canonical key: lower corner of the edge + axis
    const axis = A[0] !== B[0] ? 0 : A[1] !== B[1] ? 1 : 2;
    const lo: Vec3 = [I + Math.min(A[0], B[0]), J + Math.min(A[1], B[1]), K + Math.min(A[2], B[2])];
    const key = ((lo[0] * m1 + lo[1]) * m2 + lo[2]) * 3 + axis;
    const cached = edgeVertex.get(key);
    if (cached !== undefined) return cached;
    const va = cornerValues[ca]!;
    const vb = cornerValues[cb]!;
    let t = vb === va ? 0.5 : (iso - va) / (vb - va);
    t = Math.min(1, Math.max(0, t));
    // index-space position (fine-grid units)
    const lerpIdx = (ix: Int32Array, base: number, a: number, b: number): number => {
      const ia = ix[base + a]!;
      return ia + t * (ix[base + b]! - ia);
    };
    const pi = lerpIdx(idx0, I, A[0], B[0]);
    const pj = lerpIdx(idx1, J, A[1], B[1]);
    const pk = lerpIdx(idx2, K, A[2], B[2]);
    const [a0, a1, a2] = grid.axes;
    positions.push(
      grid.origin[0] + pi * a0[0] + pj * a1[0] + pk * a2[0],
      grid.origin[1] + pi * a0[1] + pj * a1[1] + pk * a2[1],
      grid.origin[2] + pi * a0[2] + pj * a1[2] + pk * a2[2],
    );
    gradAt(I + A[0], J + A[1], K + A[2], ga);
    gradAt(I + B[0], J + B[1], K + B[2], gb);
    const gi = ga[0] + t * (gb[0] - ga[0]);
    const gj = ga[1] + t * (gb[1] - ga[1]);
    const gk = ga[2] + t * (gb[2] - ga[2]);
    // world gradient = inv(A) * grad_idx (A has the axes as rows); grad_idx is per fine-grid
    // index on every axis, so a shorter final stride does not skew the direction.
    let nx = inv[0]! * gi + inv[1]! * gj + inv[2]! * gk;
    let ny = inv[3]! * gi + inv[4]! * gj + inv[5]! * gk;
    let nz = inv[6]! * gi + inv[7]! * gj + inv[8]! * gk;
    const len = Math.hypot(nx, ny, nz) || 1;
    // normals point from the enclosed region outward: down the gradient for `above`
    const sign = below ? 1 / len : -1 / len;
    nx *= sign;
    ny *= sign;
    nz *= sign;
    normals.push(nx, ny, nz);
    const idx = positions.length / 3 - 1;
    edgeVertex.set(key, idx);
    return idx;
  };

  for (let I = 0; I < m0 - 1; I++) {
    for (let J = 0; J < m1 - 1; J++) {
      for (let K = 0; K < m2 - 1; K++) {
        let cubeIndex = 0;
        for (let c = 0; c < 8; c++) {
          const o = CORNERS[c]!;
          const v = sample(I + o[0], J + o[1], K + o[2]);
          cornerValues[c] = v;
          // Bourke: bit set for corners inside the surface
          if (below ? v > iso : v < iso) cubeIndex |= 1 << c;
        }
        const bits = EDGE_TABLE[cubeIndex]!;
        if (bits === 0) continue;
        for (let e = 0; e < 12; e++) {
          if (bits & (1 << e)) cornerVertex[e] = vertexOnEdge(I, J, K, e);
        }
        const base = cubeIndex * 16;
        for (let t = 0; t < 16; t += 3) {
          const e0 = TRI_TABLE[base + t]!;
          if (e0 < 0) break;
          const e1 = TRI_TABLE[base + t + 1]!;
          const e2 = TRI_TABLE[base + t + 2]!;
          const v0 = cornerVertex[e0]!;
          const v1 = cornerVertex[e1]!;
          const v2 = cornerVertex[e2]!;
          if (swapWinding) indices.push(v0, v2, v1);
          else indices.push(v0, v1, v2);
        }
      }
    }
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  };
}
