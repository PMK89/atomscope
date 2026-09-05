import { expect, test } from 'vitest';
import { marchingCubes, type GridGeometry, type Vec3 } from './marchingCubes';
import { budgetedStep, estimateTriangles } from './marchingCubesBudget';

const grid = (n: number): GridGeometry => ({
  shape: [n, n, n],
  origin: [-2, -2, -2],
  axes: [
    [4 / (n - 1), 0, 0],
    [0, 4 / (n - 1), 0],
    [0, 0, 4 / (n - 1)],
  ],
});

function sample(g: GridGeometry, f: (p: Vec3) => number): Float32Array {
  const [n0, n1, n2] = g.shape;
  const [a0, a1, a2] = g.axes;
  const out = new Float32Array(n0 * n1 * n2);
  for (let i = 0; i < n0; i++)
    for (let j = 0; j < n1; j++)
      for (let k = 0; k < n2; k++) {
        const p: Vec3 = [
          g.origin[0] + i * a0[0] + j * a1[0] + k * a2[0],
          g.origin[1] + i * a0[1] + j * a1[1] + k * a2[1],
          g.origin[2] + i * a0[2] + j * a1[2] + k * a2[2],
        ];
        out[(i * n1 + j) * n2 + k] = f(p);
      }
  return out;
}

const ball = (p: Vec3): number => 3 - Math.hypot(p[0], p[1], p[2]);
/** many small closed lobes: worst case for the triangle count */
const ripples = (p: Vec3): number => Math.sin(6 * p[0]) * Math.sin(6 * p[1]) * Math.sin(6 * p[2]);

test('the estimate is within a factor of two of the real triangle count', () => {
  for (const n of [41, 65]) {
    const g = grid(n);
    for (const [field, isovalue] of [
      [ball, 2],
      [ripples, 0.2],
    ] as const) {
      const values = sample(g, field);
      const actual = marchingCubes(values, g, { isovalue }).triangleCount;
      const estimated = estimateTriangles(values, g, { isovalue });
      expect(estimated).toBeGreaterThan(actual / 2);
      expect(estimated).toBeLessThan(actual * 2);
    }
  }
});

test('an empty field is estimated at zero triangles', () => {
  const g = grid(17);
  expect(estimateTriangles(new Float32Array(17 ** 3), g, { isovalue: 5 })).toBe(0);
});

test('budgetedStep coarsens until the estimate fits and never below the request', () => {
  const g = grid(65);
  const values = sample(g, ripples);
  const full = marchingCubes(values, g, { isovalue: 0.2 });
  expect(full.step).toBe(1);
  expect(full.triangleCount).toBeGreaterThan(2000);

  const step = budgetedStep(values, g, { isovalue: 0.2 }, 2000);
  expect(step).toBeGreaterThan(1);
  expect(marchingCubes(values, g, { isovalue: 0.2, step }).triangleCount).toBeLessThan(
    full.triangleCount,
  );

  // a generous budget leaves the requested resolution alone
  expect(budgetedStep(values, g, { isovalue: 0.2 }, 10_000_000)).toBe(1);
  // an explicit coarser request is never made finer
  expect(budgetedStep(values, g, { isovalue: 0.2, step: 4 }, 10_000_000)).toBe(4);
});

test('the budget stops before the lattice becomes unmeshable', () => {
  const g = grid(9);
  const values = sample(g, ripples);
  const step = budgetedStep(values, g, { isovalue: 0 }, 1);
  // 9 samples per axis: step 4 still gives 3 samples, step 8 would give 2
  expect(step).toBe(4);
  expect(marchingCubes(values, g, { isovalue: 0, step }).step).toBe(4);
});
