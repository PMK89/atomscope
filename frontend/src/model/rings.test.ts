/**
 * Ring perception, on the cases that tell a correct answer from a plausible one: naphthalene
 * (two rings, not three), cubane (five, not six) and a molecule with no rings at all.
 */
import { describe, expect, it } from 'vitest';

import { RING_COLORS, findRings, ringColor } from './rings';
import { makeAtom, makeBond, normalizeStructure, type StructureDoc } from './structure';

/** A structure from a bond list; the positions do not matter to ring perception. */
const graph = (atoms: number, bonds: [number, number][]): StructureDoc =>
  normalizeStructure({
    name: 'g',
    charge: 0,
    atoms: Array.from({ length: atoms }, (_, i) => makeAtom('C', [i, 0, 0])),
    bonds: bonds.map(([a, b]) => makeBond(a, b)),
  });

const cycle = (n: number): [number, number][] =>
  Array.from({ length: n }, (_, i) => [i, (i + 1) % n] as [number, number]);

const sizes = (s: StructureDoc): number[] =>
  findRings(s)
    .map((r) => r.atoms.length)
    .sort((a, b) => a - b);

describe('findRings', () => {
  it('finds nothing in a chain', () => {
    expect(
      findRings(
        graph(4, [
          [0, 1],
          [1, 2],
          [2, 3],
        ]),
      ),
    ).toEqual([]);
  });

  it('finds one ring in benzene', () => {
    expect(sizes(graph(6, cycle(6)))).toEqual([6]);
  });

  it('returns the atoms in cyclic order, so consecutive ones are bonded', () => {
    const ring = findRings(graph(6, cycle(6)))[0]!;
    expect(ring.atoms).toHaveLength(6);
    const bonded = new Set(cycle(6).map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`));
    for (let i = 0; i < ring.atoms.length; i++) {
      const a = ring.atoms[i]!;
      const b = ring.atoms[(i + 1) % ring.atoms.length]!;
      expect(bonded.has(`${Math.min(a, b)}-${Math.max(a, b)}`)).toBe(true);
    }
  });

  it('finds two six-rings in naphthalene, not three', () => {
    // fused bicyclic: the twelve-membered perimeter is the sum of the two six-rings, so counting
    // it would draw the same electrons twice. The cycle space is two-dimensional.
    const naphthalene = graph(10, [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 0],
      // second ring fused on the 0-5 bond
      [5, 6],
      [6, 7],
      [7, 8],
      [8, 9],
      [9, 0],
    ]);
    expect(sizes(naphthalene)).toEqual([6, 6]);
  });

  it('finds five rings in cubane, not six', () => {
    // a cube has six faces but its cycle space is 12 - 8 + 1 = 5: any face is the sum of the
    // other five, which is the classic case a naive "every smallest cycle" answer gets wrong
    const cubane = graph(8, [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0], // bottom
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4], // top
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7], // uprights
    ]);
    expect(sizes(cubane)).toEqual([4, 4, 4, 4, 4]);
  });

  it('finds one ring per disconnected ring', () => {
    // two separate benzenes: the component count is what keeps the cyclomatic number right
    const bonds: [number, number][] = [
      ...cycle(6),
      ...cycle(6).map(([a, b]) => [a + 6, b + 6] as [number, number]),
    ];
    expect(sizes(graph(12, bonds))).toEqual([6, 6]);
  });

  it('prefers the smaller ring when a bond is in two', () => {
    // a three-ring fused to a six-ring shares one bond; both are independent and both are kept
    const fused = graph(7, [
      ...cycle(6),
      [0, 6],
      [1, 6], // triangle on the 0-1 bond
    ]);
    expect(sizes(fused)).toEqual([3, 6]);
  });

  it('handles a ring with a substituent hanging off it', () => {
    expect(sizes(graph(7, [...cycle(6), [0, 6]]))).toEqual([6]);
  });
});

describe('ringColor', () => {
  it('is Avogadro colour per ring size', () => {
    // ringengine.cpp:44-51 -- red, green, blue, magenta, then yellow for everything larger
    expect(ringColor(3)).toEqual([1, 0, 0]);
    expect(ringColor(4)).toEqual([0, 1, 0]);
    expect(ringColor(5)).toEqual([0, 0, 1]);
    expect(ringColor(6)).toEqual([1, 0, 1]);
    expect(ringColor(7)).toEqual([1, 1, 0]);
    expect(ringColor(18)).toEqual([1, 1, 0]);
    expect(RING_COLORS).toHaveLength(5);
  });

  it('does not read off the end for a nonsense size', () => {
    expect(ringColor(0)).toEqual([1, 0, 0]);
    expect(ringColor(-4)).toEqual([1, 0, 0]);
  });
});
