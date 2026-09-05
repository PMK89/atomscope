import { jacobi3, principalAxes } from './principalAxes';

test('jacobi3 diagonalizes a symmetric matrix', () => {
  const { values, vectors } = jacobi3([
    [2, 1, 0],
    [1, 2, 0],
    [0, 0, 5],
  ]);
  const sorted = [...values].sort((a, b) => a - b);
  expect(sorted[0]).toBeCloseTo(1, 9);
  expect(sorted[1]).toBeCloseTo(3, 9);
  expect(sorted[2]).toBeCloseTo(5, 9);
  // columns are orthonormal
  for (let i = 0; i < 3; i++) {
    let n = 0;
    for (let k = 0; k < 3; k++) n += vectors[k]![i]! ** 2;
    expect(n).toBeCloseTo(1, 9);
  }
});

test('planar molecule: smallest axis is the plane normal', () => {
  // water-like points in the yz plane
  const pos = [0, 0, 0.1, 0, 0.76, -0.47, 0, -0.76, -0.47, 0, 1.5, 0.3];
  const pa = principalAxes(pos, 4)!;
  expect(Math.abs(pa.axes[2][0])).toBeCloseTo(1, 6); // normal along x
  expect(pa.variances[2]).toBeCloseTo(0, 9);
  expect(pa.variances[0]).toBeGreaterThan(pa.variances[1]);
});

test('degenerate inputs return null', () => {
  expect(principalAxes([0, 0, 0], 1)).toBeNull();
});
