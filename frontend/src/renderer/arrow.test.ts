import { Matrix4, Quaternion, Vector3 } from 'three';
import { arrowMatrices } from './arrow';

const dims = { shaftRadius: 0.1, headRadius: 0.25, headLength: 0.5 };

function decompose(m: Matrix4): { p: Vector3; s: Vector3; q: Quaternion } {
  const p = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  m.decompose(p, q, s);
  return { p, q, s };
}

test('arrow along +z: shaft and head are placed end to end', () => {
  const shaft = new Matrix4();
  const head = new Matrix4();
  const len = arrowMatrices(new Vector3(1, 0, 0), new Vector3(0, 0, 2), dims, 0, shaft, head);
  expect(len).toBeCloseTo(2);
  const s = decompose(shaft);
  expect(s.s.y).toBeCloseTo(1.5); // 2 - headLength
  expect(s.s.x).toBeCloseTo(0.1);
  expect(s.p.toArray()).toEqual([1, 0, expect.closeTo(0.75, 6)]);
  const h = decompose(head);
  expect(h.s.y).toBeCloseTo(0.5);
  expect(h.s.x).toBeCloseTo(0.25);
  expect(h.p.z).toBeCloseTo(1.75);
  // unit +Y maps onto the arrow direction
  const tip = new Vector3(0, 0.5, 0).applyMatrix4(head);
  expect(tip.toArray()).toEqual([expect.closeTo(1, 6), expect.closeTo(0, 6), expect.closeTo(2, 6)]);
});

test('short arrows shrink their head and tiny ones collapse', () => {
  const shaft = new Matrix4();
  const head = new Matrix4();
  arrowMatrices(new Vector3(), new Vector3(0.4, 0, 0), dims, 0, shaft, head);
  expect(decompose(head).s.y).toBeCloseTo(0.2); // half the length
  expect(decompose(shaft).s.y).toBeCloseTo(0.2);
  arrowMatrices(new Vector3(), new Vector3(0.01, 0, 0), dims, 0.05, shaft, head);
  expect(decompose(shaft).s.length()).toBe(0);
  expect(decompose(head).s.length()).toBe(0);
});

test('arrow pointing straight down (antiparallel to +Y) keeps a proper rotation', () => {
  const shaft = new Matrix4();
  const head = new Matrix4();
  arrowMatrices(new Vector3(), new Vector3(0, -3, 0), dims, 0, shaft, head);
  const tip = new Vector3(0, 0.5, 0).applyMatrix4(head);
  expect(tip.y).toBeCloseTo(-3);
  expect(Math.abs(tip.x) + Math.abs(tip.z)).toBeLessThan(1e-6);
});
