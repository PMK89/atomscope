/** Small allocation-light Vec3 helpers for editor logic (kept independent of Three.js). */
import type { Vec3 } from './structure';

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));

export function normalize(a: Vec3, fallback: Vec3 = [1, 0, 0]): Vec3 {
  const l = length(a);
  return l < 1e-9 ? fallback : scale(a, 1 / l);
}

/** Any unit vector perpendicular to `a` (deterministic). */
export function perpendicular(a: Vec3): Vec3 {
  const u = normalize(a);
  const ref: Vec3 = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return normalize(cross(u, ref));
}

/** Angle at `b` formed by a-b-c, in degrees. */
export function angleDeg(a: Vec3, b: Vec3, c: Vec3): number {
  const u = normalize(sub(a, b));
  const v = normalize(sub(c, b));
  return (Math.acos(Math.max(-1, Math.min(1, dot(u, v)))) * 180) / Math.PI;
}

/**
 * Signed dihedral a-b-c-d in degrees, IUPAC sign convention: looking along b->c, positive when
 * the far bond (c-d) is rotated clockwise relative to the near bond (b-a).
 */
export function dihedralDeg(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
  const b0 = sub(a, b);
  const b1 = normalize(sub(c, b));
  const b2 = sub(d, c);
  // projections of the outer bonds onto the plane perpendicular to b-c
  const v = sub(b0, scale(b1, dot(b0, b1)));
  const w = sub(b2, scale(b1, dot(b2, b1)));
  const x = dot(v, w);
  const y = dot(cross(b1, v), w);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** Rotate `p` about the axis through `origin` with unit direction `axis` by `angleRad`. */
export function rotateAbout(p: Vec3, origin: Vec3, axis: Vec3, angleRad: number): Vec3 {
  const v = sub(p, origin);
  const k = normalize(axis);
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  // Rodrigues' rotation formula
  const term1 = scale(v, c);
  const term2 = scale(cross(k, v), s);
  const term3 = scale(k, dot(k, v) * (1 - c));
  return add(origin, add(add(term1, term2), term3));
}
