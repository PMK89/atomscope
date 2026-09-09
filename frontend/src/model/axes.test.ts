/**
 * The axis vectors, in Avogadro's three modes. Orthogonal is the interesting one: its own
 * implementation falls through the switch and never orthogonalises anything, so what is checked
 * here is the intent rather than the reference behaviour.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_AXES_VECTORS, resolveAxes, type AxesVectors } from './axes';
import type { Vec3 } from './structure';

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);

const settings = (patch: Partial<AxesVectors>): AxesVectors => ({
  ...DEFAULT_AXES_VECTORS,
  ...patch,
});

describe('resolveAxes', () => {
  it('gives the unit axes scaled by the length in Cartesian mode', () => {
    expect(resolveAxes(settings({ type: 'cartesian', length: 3 }))).toEqual([
      [3, 0, 0],
      [0, 3, 0],
      [0, 0, 3],
    ]);
  });

  it('ignores the vectors in Cartesian mode, as Avogadro disables their boxes', () => {
    const odd: [Vec3, Vec3, Vec3] = [
      [7, 7, 7],
      [1, 2, 3],
      [0, 0, 9],
    ];
    expect(resolveAxes(settings({ type: 'cartesian', length: 1, vectors: odd }))).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });

  it('takes all three as given in Custom mode', () => {
    const odd: [Vec3, Vec3, Vec3] = [
      [1, 1, 0],
      [0, 2, 0],
      [0, 0, 3],
    ];
    expect(resolveAxes(settings({ type: 'custom', vectors: odd }))).toEqual(odd);
  });

  it('makes the second axis perpendicular to the first in Orthogonal mode', () => {
    // a second vector that leans on the first
    const [a1, a2, a3] = resolveAxes(
      settings({
        type: 'orthogonal',
        vectors: [
          [1, 0, 0],
          [1, 1, 0],
          [0, 0, 1],
        ],
      }),
    );
    expect(a1).toEqual([1, 0, 0]);
    expect(dot(a1, a2)).toBeCloseTo(0);
    // and its own length survives being straightened
    expect(norm(a2)).toBeCloseTo(Math.SQRT2);
    // the third is their cross product, so perpendicular to both
    expect(dot(a1, a3)).toBeCloseTo(0);
    expect(dot(a2, a3)).toBeCloseTo(0);
  });

  it('derives the third axis rather than reading it, which is Avogadro bug', () => {
    // In Avogadro the third row's boxes are disabled in this mode and the switch falls through
    // to `default:`, so the third axis ends up as whatever those disabled boxes hold. Here it is
    // the cross product, whatever the third vector's direction says.
    const [, , a3] = resolveAxes(
      settings({
        type: 'orthogonal',
        vectors: [
          [1, 0, 0],
          [0, 1, 0],
          [5, 5, 5], // a direction that must not survive
        ],
      }),
    );
    const unit = a3.map((v) => v / norm(a3));
    expect(unit[0]).toBeCloseTo(0);
    expect(unit[1]).toBeCloseTo(0);
    expect(Math.abs(unit[2]!)).toBeCloseTo(1);
    // only its length is taken from what was entered
    expect(norm(a3)).toBeCloseTo(Math.hypot(5, 5, 5));
  });

  it('does not collapse when the second axis is parallel to the first', () => {
    const [a1, a2, a3] = resolveAxes(
      settings({
        type: 'orthogonal',
        vectors: [
          [0, 0, 2],
          [0, 0, 5], // parallel: nothing is left after projecting it out
          [1, 0, 0],
        ],
      }),
    );
    for (const v of [a1, a2, a3]) {
      expect(norm(v)).toBeGreaterThan(0);
      expect(v.every(Number.isFinite)).toBe(true);
    }
    expect(dot(a1, a2)).toBeCloseTo(0);
    expect(norm(a2)).toBeCloseTo(5); // the length it was given
  });

  it('falls back to Cartesian when the first axis is zero', () => {
    expect(
      resolveAxes(
        settings({
          type: 'orthogonal',
          length: 2,
          vectors: [
            [0, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
          ],
        }),
      ),
    ).toEqual([
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 2],
    ]);
  });

  it('never returns a NaN component, whatever it is given', () => {
    const nasty: [Vec3, Vec3, Vec3][] = [
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      [
        [1, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
    ];
    for (const vectors of nasty) {
      for (const type of ['orthogonal', 'custom'] as const) {
        for (const v of resolveAxes(settings({ type, vectors }))) {
          expect(v.every(Number.isFinite)).toBe(true);
        }
      }
    }
  });
});
