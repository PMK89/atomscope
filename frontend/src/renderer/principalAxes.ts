/**
 * Principal axes of a point cloud via Jacobi eigen-decomposition of the 3x3 covariance matrix.
 * Used to pick a default view: look along the axis of least extent so planar molecules face the
 * camera, with the axis of greatest extent horizontal.
 */
export interface PrincipalAxes {
  center: [number, number, number];
  /** eigenvectors sorted by descending variance (rows) */
  axes: [[number, number, number], [number, number, number], [number, number, number]];
  variances: [number, number, number];
}

export function principalAxes(positions: ArrayLike<number>, count: number): PrincipalAxes | null {
  if (count < 2) return null;
  const c = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    c[0]! += positions[3 * i]!;
    c[1]! += positions[3 * i + 1]!;
    c[2]! += positions[3 * i + 2]!;
  }
  c[0]! /= count;
  c[1]! /= count;
  c[2]! /= count;
  const m = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < count; i++) {
    const d = [
      positions[3 * i]! - c[0]!,
      positions[3 * i + 1]! - c[1]!,
      positions[3 * i + 2]! - c[2]!,
    ];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) m[a]![b]! += d[a]! * d[b]!;
  }
  const { values, vectors } = jacobi3(m as number[][]);
  const order = [0, 1, 2].sort((i, j) => values[j]! - values[i]!);
  return {
    center: [c[0]!, c[1]!, c[2]!],
    axes: order.map((k) => [
      vectors[0]![k]!,
      vectors[1]![k]!,
      vectors[2]![k]!,
    ]) as PrincipalAxes['axes'],
    variances: order.map((k) => values[k]! / count) as PrincipalAxes['variances'],
  };
}

/** Cyclic Jacobi rotations for a symmetric 3x3 matrix. Returns eigenvalues and column eigenvectors. */
export function jacobi3(a: number[][]): { values: number[]; vectors: number[][] } {
  const m = a.map((row) => row.slice());
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += m[p]![q]! * m[p]![q]!;
    if (off < 1e-22) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        const apq = m[p]![q]!;
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (m[q]![q]! - m[p]![p]!) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const cs = 1 / Math.sqrt(t * t + 1);
        const sn = t * cs;
        for (let k = 0; k < 3; k++) {
          const mkp = m[k]![p]!;
          const mkq = m[k]![q]!;
          m[k]![p] = cs * mkp - sn * mkq;
          m[k]![q] = sn * mkp + cs * mkq;
        }
        for (let k = 0; k < 3; k++) {
          const mpk = m[p]![k]!;
          const mqk = m[q]![k]!;
          m[p]![k] = cs * mpk - sn * mqk;
          m[q]![k] = sn * mpk + cs * mqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k]![p]!;
          const vkq = v[k]![q]!;
          v[k]![p] = cs * vkp - sn * vkq;
          v[k]![q] = sn * vkp + cs * vkq;
        }
      }
    }
  }
  return { values: [m[0]![0]!, m[1]![1]!, m[2]![2]!], vectors: v };
}
