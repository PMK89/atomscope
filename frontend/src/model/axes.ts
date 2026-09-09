/**
 * The three axis vectors Avogadro's Axes engine draws, in its three modes
 * (`axesengine.cpp`, `axesType`): Cartesian, Orthogonal and Custom.
 *
 * **Avogadro's Orthogonal mode does not work.** Its `updateVectors` switch has no `break` before
 * `default:`, so `case 1` computes the orthogonalised second axis and the cross-product third one
 * and then falls through and overwrites all three from the spin boxes -- and the third row's boxes
 * are disabled in that mode, so the third axis stays at whatever they held. What is implemented
 * here is the evident intent: the second axis is made perpendicular to the first, and the third is
 * their cross product.
 */

import type { Vec3 } from './structure';

export type AxesType = 'cartesian' | 'orthogonal' | 'custom';

export interface AxesVectors {
  type: AxesType;
  /** Axis length for `cartesian`, where the three are the unit axes scaled by it. */
  length: number;
  /** The three vectors, used by `orthogonal` (first two) and `custom` (all three). */
  vectors: [Vec3, Vec3, Vec3];
}

export const DEFAULT_AXES_VECTORS: AxesVectors = {
  type: 'cartesian',
  length: 2,
  vectors: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
};

const norm = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Below this a vector is zero and cannot give a direction. */
const EPSILON = 1e-9;

const withLength = (v: Vec3, length: number): Vec3 => {
  const n = norm(v);
  return n < EPSILON ? [0, 0, 0] : scale(v, length / n);
};

/** Any unit vector perpendicular to `v`, for when the second axis is parallel to the first. */
function perpendicular(v: Vec3): Vec3 {
  // cross with whichever cardinal direction `v` is least aligned to, which is never degenerate
  const abs = v.map(Math.abs);
  const least = abs.indexOf(Math.min(...abs));
  const cardinal: Vec3 = [0, 0, 0];
  cardinal[least] = 1;
  return withLength(cross(v, cardinal), 1);
}

/**
 * The three vectors to draw. Degenerate input never produces a NaN axis: a zero first vector
 * falls back to the Cartesian answer, and a second vector parallel to the first is replaced by
 * some perpendicular one rather than collapsing the frame.
 */
export function resolveAxes(settings: AxesVectors): [Vec3, Vec3, Vec3] {
  const { type, length, vectors } = settings;
  const cartesian = (): [Vec3, Vec3, Vec3] => [
    [length, 0, 0],
    [0, length, 0],
    [0, 0, length],
  ];
  if (type === 'cartesian') return cartesian();

  const [v1, v2, v3] = vectors;
  if (type === 'custom') return [[...v1], [...v2], [...v3]];

  // orthogonal: keep the first, make the second perpendicular to it, cross for the third
  if (norm(v1) < EPSILON) return cartesian();
  const a1: Vec3 = [...v1];
  const unit1 = withLength(a1, 1);
  const projected = scale(unit1, dot(v2, unit1));
  const rejected: Vec3 = [v2[0] - projected[0], v2[1] - projected[1], v2[2] - projected[2]];
  // the second vector's own length is kept, so making it perpendicular does not resize it
  const wanted2 = norm(v2) > EPSILON ? norm(v2) : norm(a1);
  const a2 =
    norm(rejected) < EPSILON ? scale(perpendicular(a1), wanted2) : withLength(rejected, wanted2);
  // the third is theirs to determine; its length is the one entered, or the first axis's
  const wanted3 = norm(v3) > EPSILON ? norm(v3) : norm(a1);
  return [a1, a2, withLength(cross(a1, a2), wanted3)];
}
