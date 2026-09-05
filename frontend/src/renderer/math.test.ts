import { Matrix4, Vector3 } from 'three';
import { bondOffsetAxis, cylinderMatrix } from './math';

test('cylinderMatrix maps unit cylinder endpoints onto the segment', () => {
  const a = new Vector3(1, 2, 3);
  const b = new Vector3(4, 2, 3);
  const m = cylinderMatrix(a, b, 0.2, new Matrix4());
  const top = new Vector3(0, 0.5, 0).applyMatrix4(m);
  const bottom = new Vector3(0, -0.5, 0).applyMatrix4(m);
  const ends = [top, bottom].sort((p, q) => p.x - q.x);
  expect(ends[0]!.distanceTo(a)).toBeLessThan(1e-6);
  expect(ends[1]!.distanceTo(b)).toBeLessThan(1e-6);
  const side = new Vector3(1, 0, 0).applyMatrix4(m);
  const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
  expect(side.distanceTo(mid)).toBeCloseTo(0.2, 6);
});

test('degenerate segment collapses to zero scale', () => {
  const m = cylinderMatrix(new Vector3(), new Vector3(), 0.2, new Matrix4());
  expect(new Vector3(1, 1, 1).applyMatrix4(m).length()).toBe(0);
});

test('bondOffsetAxis is perpendicular to the bond', () => {
  const a = new Vector3(0, 0, 0);
  const b = new Vector3(1, 0, 0);
  const axis = bondOffsetAxis(a, b, new Vector3(0, 0, 1), new Vector3());
  expect(Math.abs(axis.dot(new Vector3(1, 0, 0)))).toBeLessThan(1e-9);
  expect(axis.length()).toBeCloseTo(1, 9);
  // view direction parallel to the bond falls back to a valid axis
  const fallback = bondOffsetAxis(a, b, new Vector3(1, 0, 0), new Vector3());
  expect(fallback.length()).toBeCloseTo(1, 9);
});
