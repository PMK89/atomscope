import {
  marchingCubes,
  sampledIndices,
  type GridGeometry,
  type IsosurfaceMesh,
  type Vec3,
} from './marchingCubes';

const N = 41;
const H = 0.1; // grid spans [-2, 2]^3

function worldPoint(g: GridGeometry, i: number, j: number, k: number): Vec3 {
  const [a0, a1, a2] = g.axes;
  return [
    g.origin[0] + i * a0[0] + j * a1[0] + k * a2[0],
    g.origin[1] + i * a0[1] + j * a1[1] + k * a2[1],
    g.origin[2] + i * a0[2] + j * a1[2] + k * a2[2],
  ];
}

function sampleField(g: GridGeometry, f: (p: Vec3) => number): Float32Array {
  const [n0, n1, n2] = g.shape;
  const out = new Float32Array(n0 * n1 * n2);
  for (let i = 0; i < n0; i++)
    for (let j = 0; j < n1; j++)
      for (let k = 0; k < n2; k++) out[(i * n1 + j) * n2 + k] = f(worldPoint(g, i, j, k));
  return out;
}

const orthogonal: GridGeometry = {
  shape: [N, N, N],
  origin: [-2, -2, -2],
  axes: [
    [H, 0, 0],
    [0, H, 0],
    [0, 0, H],
  ],
};
const sheared: GridGeometry = {
  shape: [N, N, N],
  origin: [-2.5, -2.4, -2],
  axes: [
    [H, 0, 0],
    [0.3 * H, H, 0],
    [0, 0.2 * H, H],
  ],
};
const norm = (p: Vec3): number => Math.hypot(p[0], p[1], p[2]);
/** high inside: f >= 2 is the unit ball */
const ballField = (p: Vec3): number => 3 - norm(p);

function area(m: IsosurfaceMesh): number {
  let a = 0;
  const P = m.positions;
  for (let t = 0; t < m.indices.length; t += 3) {
    const [i, j, k] = [m.indices[t]! * 3, m.indices[t + 1]! * 3, m.indices[t + 2]! * 3];
    const ux = P[j]! - P[i]!;
    const uy = P[j + 1]! - P[i + 1]!;
    const uz = P[j + 2]! - P[i + 2]!;
    const vx = P[k]! - P[i]!;
    const vy = P[k + 1]! - P[i + 1]!;
    const vz = P[k + 2]! - P[i + 2]!;
    a += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return a;
}

/** every edge is shared by exactly two triangles */
function isWatertight(m: IsosurfaceMesh): boolean {
  const count = new Map<string, number>();
  for (let t = 0; t < m.indices.length; t += 3) {
    const tri = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!];
    for (let e = 0; e < 3; e++) {
      const a = tri[e]!;
      const b = tri[(e + 1) % 3]!;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  return [...count.values()].every((c) => c === 2);
}

/** fraction of vertices whose normal is within `cos` of the given direction field */
function normalAgreement(m: IsosurfaceMesh, dir: (p: Vec3) => Vec3, cos = 0.95): number {
  let ok = 0;
  for (let v = 0; v < m.vertexCount; v++) {
    const p: Vec3 = [m.positions[3 * v]!, m.positions[3 * v + 1]!, m.positions[3 * v + 2]!];
    const d = dir(p);
    const dl = norm(d);
    const dot =
      (m.normals[3 * v]! * d[0] + m.normals[3 * v + 1]! * d[1] + m.normals[3 * v + 2]! * d[2]) / dl;
    if (dot > cos) ok++;
  }
  return ok / m.vertexCount;
}

/**
 * fraction of non-degenerate triangles whose geometric (winding) normal agrees with the vertex
 * normals (zero-area triangles arise where a grid corner sits exactly on the isovalue)
 */
function windingAgreement(m: IsosurfaceMesh): number {
  let ok = 0;
  let total = 0;
  const P = m.positions;
  const Nn = m.normals;
  for (let t = 0; t < m.indices.length; t += 3) {
    const [i, j, k] = [m.indices[t]! * 3, m.indices[t + 1]! * 3, m.indices[t + 2]! * 3];
    const ux = P[j]! - P[i]!;
    const uy = P[j + 1]! - P[i + 1]!;
    const uz = P[j + 2]! - P[i + 2]!;
    const vx = P[k]! - P[i]!;
    const vy = P[k + 1]! - P[i + 1]!;
    const vz = P[k + 2]! - P[i + 2]!;
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    if (Math.hypot(fx, fy, fz) < 1e-12) continue;
    total++;
    const nx = Nn[i]! + Nn[j]! + Nn[k]!;
    const ny = Nn[i + 1]! + Nn[j + 1]! + Nn[k + 1]!;
    const nz = Nn[i + 2]! + Nn[j + 2]! + Nn[k + 2]!;
    if (fx * nx + fy * ny + fz * nz > 0) ok++;
  }
  return ok / total;
}

test('unit sphere: closed surface, area ~ 4 pi, outward normals, consistent winding', () => {
  const m = marchingCubes(sampleField(orthogonal, ballField), orthogonal, { isovalue: 2 });
  expect(m.triangleCount).toBeGreaterThan(1000);
  expect(Math.abs(area(m) - 4 * Math.PI) / (4 * Math.PI)).toBeLessThan(0.03);
  expect(isWatertight(m)).toBe(true);
  expect(normalAgreement(m, (p) => p)).toBeGreaterThan(0.99);
  expect(windingAgreement(m)).toBe(1);
  // vertices lie on the sphere
  for (let v = 0; v < m.vertexCount; v += 97) {
    const r = Math.hypot(m.positions[3 * v]!, m.positions[3 * v + 1]!, m.positions[3 * v + 2]!);
    expect(Math.abs(r - 1)).toBeLessThan(0.02);
  }
});

test('non-orthogonal axes: positions and normals are computed in world space', () => {
  const m = marchingCubes(sampleField(sheared, ballField), sheared, { isovalue: 2 });
  expect(Math.abs(area(m) - 4 * Math.PI) / (4 * Math.PI)).toBeLessThan(0.03);
  expect(isWatertight(m)).toBe(true);
  expect(normalAgreement(m, (p) => p)).toBeGreaterThan(0.99);
  expect(windingAgreement(m)).toBe(1);
});

test('left-handed axes keep outward winding', () => {
  const left: GridGeometry = {
    ...orthogonal,
    axes: [
      [H, 0, 0],
      [0, 0, H],
      [0, H, 0],
    ],
  };
  const m = marchingCubes(sampleField(left, ballField), left, { isovalue: 2 });
  expect(isWatertight(m)).toBe(true);
  expect(windingAgreement(m)).toBe(1);
  expect(normalAgreement(m, (p) => p)).toBeGreaterThan(0.99);
});

test('inside=below encloses the low side (negative orbital lobe) with outward normals', () => {
  // f = |p| - 3: the region f <= -2 is the unit ball
  const m = marchingCubes(
    sampleField(orthogonal, (p) => norm(p) - 3),
    orthogonal,
    { isovalue: -2, inside: 'below' },
  );
  expect(Math.abs(area(m) - 4 * Math.PI) / (4 * Math.PI)).toBeLessThan(0.03);
  expect(isWatertight(m)).toBe(true);
  expect(normalAgreement(m, (p) => p)).toBeGreaterThan(0.99);
  expect(windingAgreement(m)).toBe(1);
});

test('downsampling by step keeps a closed, coarser surface', () => {
  const field = sampleField(orthogonal, ballField);
  const fine = marchingCubes(field, orthogonal, { isovalue: 2 });
  const coarse = marchingCubes(field, orthogonal, { isovalue: 2, step: 2 });
  expect(coarse.triangleCount).toBeLessThan(fine.triangleCount / 2);
  expect(isWatertight(coarse)).toBe(true);
  expect(Math.abs(area(coarse) - 4 * Math.PI) / (4 * Math.PI)).toBeLessThan(0.08);
  expect(windingAgreement(coarse)).toBe(1);
});

test('sampled index arrays always close on n - 1', () => {
  expect([...sampledIndices(6, 4)]).toEqual([0, 4, 5]);
  expect([...sampledIndices(6, 2)]).toEqual([0, 2, 4, 5]);
  expect([...sampledIndices(9, 4)]).toEqual([0, 4, 8]);
  expect([...sampledIndices(5, 1)]).toEqual([0, 1, 2, 3, 4]);
  expect([...sampledIndices(1, 4)]).toEqual([0]);
});

test('downsampling meshes the final slab when the size is not divisible by the step', () => {
  // 6 samples per axis with step 4 samples fine indices 0, 4, 5: the last slab is 4..5
  const g: GridGeometry = {
    shape: [6, 6, 6],
    origin: [0, 0, 0],
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
  };
  const field = sampleField(g, (p) => p[0]);
  const m = marchingCubes(field, g, { isovalue: 4.5, step: 4 });
  expect(m.triangleCount).toBeGreaterThan(0);
  for (let v = 0; v < m.vertexCount; v++) {
    // the plane sits at x = 4.5, inside the shorter final stride
    expect(m.positions[3 * v]!).toBeCloseTo(4.5, 6);
    // `above` normals point down the gradient, i.e. towards -x
    expect(m.normals[3 * v]!).toBeCloseTo(-1, 6);
  }
});

test('an isovalue outside the data range yields no triangles', () => {
  const field = sampleField(orthogonal, ballField);
  for (const isovalue of [-10, 100]) {
    const m = marchingCubes(field, orthogonal, { isovalue });
    expect(m.triangleCount).toBe(0);
    expect(m.vertexCount).toBe(0);
    expect(m.positions).toHaveLength(0);
    expect(m.indices).toHaveLength(0);
  }
});

test('rejects a values array that does not match the shape', () => {
  expect(() => marchingCubes(new Float32Array(5), orthogonal, { isovalue: 0 })).toThrow();
});
