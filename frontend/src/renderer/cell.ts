import type { Vec3 } from '../model/structure';

export type Mat3 = [Vec3, Vec3, Vec3];

/** Corner index pairs of the 12 edges of a parallelepiped; corner bits = (i, j, k) along a, b, c. */
const EDGES: readonly [number, number][] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7], // along a
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7], // along b
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7], // along c
];

/**
 * Line-segment endpoints (x, y, z per point, 2 points per edge) for the cell and its periodic
 * images 0..nx-1, 0..ny-1, 0..nz-1: 12 * nx * ny * nz edges, 72 floats per cell.
 */
export function cellEdgePositions(
  [a, b, c]: Mat3,
  repeat: [number, number, number] = [1, 1, 1],
): Float32Array {
  const [nx, ny, nz] = repeat.map((n) => Math.max(1, Math.floor(n))) as [number, number, number];
  const out = new Float32Array(nx * ny * nz * 12 * 2 * 3);
  let o = 0;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      for (let k = 0; k < nz; k++) {
        for (const [p, q] of EDGES) {
          for (const corner of [p, q]) {
            const fa = i + (corner & 1);
            const fb = j + ((corner >> 1) & 1);
            const fc = k + ((corner >> 2) & 1);
            out[o++] = fa * a[0] + fb * b[0] + fc * c[0];
            out[o++] = fa * a[1] + fb * b[1] + fc * c[1];
            out[o++] = fa * a[2] + fb * b[2] + fc * c[2];
          }
        }
      }
  return out;
}

/** Number of edges `cellEdgePositions` produces for a repeat count. */
export function cellEdgeCount(repeat: [number, number, number]): number {
  return 12 * repeat.reduce((n, r) => n * Math.max(1, Math.floor(r)), 1);
}
