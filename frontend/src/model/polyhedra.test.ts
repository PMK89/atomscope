/**
 * Coordination polyhedra, against the shapes and the selection rule Avogadro's polygon engine
 * uses (`polygonengine.cpp:65-100`).
 */
import { describe, expect, it } from 'vitest';

import { elementBySymbol } from './elements';
import { makeAtom, makeBond, normalizeStructure, type StructureDoc, type Vec3 } from './structure';
import { MIN_COORDINATION, POLYGON_SKIP_Z, coordinationPolyhedra, hullFaces } from './polyhedra';

const z = (element: string): number => elementBySymbol(element).number;

/** A centre of `element` with `positions` bonded to it, plus nothing else. */
const site = (element: string, positions: Vec3[], ligand = 'O'): StructureDoc =>
  normalizeStructure({
    name: 'site',
    charge: 0,
    atoms: [makeAtom(element, [0, 0, 0]), ...positions.map((p) => makeAtom(ligand, p))],
    bonds: positions.map((_, i) => makeBond(0, i + 1)),
  });

const at =
  (s: StructureDoc) =>
  (i: number): Vec3 =>
    s.atoms[i]!.position as Vec3;

/** The four corners of a regular tetrahedron about the origin. */
const TETRAHEDRON: Vec3[] = [
  [1, 1, 1],
  [1, -1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
];

/** The six corners of a regular octahedron about the origin. */
const OCTAHEDRON: Vec3[] = [
  [2, 0, 0],
  [-2, 0, 0],
  [0, 2, 0],
  [0, -2, 0],
  [0, 0, 2],
  [0, 0, -2],
];

describe('hullFaces', () => {
  it('gives a tetrahedron four faces', () => {
    expect(hullFaces(TETRAHEDRON, [0, 0, 0])).toHaveLength(4);
  });

  it('gives an octahedron eight, not the fifty-six triples of six points', () => {
    // Avogadro sprays a triangle per ordered triple, which fills the interior as well; the hull
    // is the eight faces that triangle spray is approximating
    expect(hullFaces(OCTAHEDRON, [0, 0, 0])).toHaveLength(8);
  });

  it('winds every face so its normal points away from the centre', () => {
    for (const points of [TETRAHEDRON, OCTAHEDRON]) {
      for (const [a, b, c] of hullFaces(points, [0, 0, 0])) {
        const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n: Vec3 = [
          u[1] * v[2] - u[2] * v[1],
          u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0],
        ];
        // the face is at `a`, and the centre is the origin, so the normal must agree with a
        expect(n[0] * a[0] + n[1] * a[1] + n[2] * a[2]).toBeGreaterThan(0);
      }
    }
  });

  it('fills a flat set instead of returning nothing', () => {
    // square planar: no interior, so every triple lies on the one plane. The triangles tile the
    // square, which is the wanted picture rather than an empty one.
    const square: Vec3[] = [
      [1, 1, 0],
      [1, -1, 0],
      [-1, -1, 0],
      [-1, 1, 0],
    ];
    expect(hullFaces(square, [0, 0, 0]).length).toBeGreaterThan(0);
  });

  it('spans no face from collinear neighbours', () => {
    const line: Vec3 = [0, 0, 0];
    expect(
      hullFaces(
        [
          [1, 0, 0],
          [2, 0, 0],
          [3, 0, 0],
          [4, 0, 0],
        ],
        line,
      ),
    ).toEqual([]);
  });
});

describe('coordinationPolyhedra', () => {
  it('draws a tetrahedron around a four-coordinate site', () => {
    const s = site('Si', TETRAHEDRON);
    const found = coordinationPolyhedra(s, at(s), null, z);
    expect(found).toHaveLength(1);
    expect(found[0]!.center).toBe(0);
    expect(found[0]!.faces).toHaveLength(4);
  });

  it('draws an octahedron around a six-coordinate site', () => {
    const s = site('Ni', OCTAHEDRON);
    expect(coordinationPolyhedra(s, at(s), null, z)[0]!.faces).toHaveLength(8);
  });

  it('skips the elements Avogadro skips, whatever their coordination', () => {
    // its `switch` returns early for H, C, N, O and S before the valence is even looked at
    expect([...POLYGON_SKIP_Z].sort((a, b) => a - b)).toEqual([1, 6, 7, 8, 16]);
    for (const element of ['H', 'C', 'N', 'O', 'S']) {
      const s = site(element, OCTAHEDRON, 'F');
      expect(coordinationPolyhedra(s, at(s), null, z)).toEqual([]);
    }
    // and the same six neighbours around a metal do get one
    const metal = site('Ni', OCTAHEDRON, 'F');
    expect(coordinationPolyhedra(metal, at(metal), null, z)).toHaveLength(1);
  });

  it('needs four neighbours', () => {
    expect(MIN_COORDINATION).toBe(4);
    const three = site('Ni', TETRAHEDRON.slice(0, 3));
    expect(coordinationPolyhedra(three, at(three), null, z)).toEqual([]);
    const four = site('Ni', TETRAHEDRON);
    expect(coordinationPolyhedra(four, at(four), null, z)).toHaveLength(1);
  });

  it('leaves out a hidden centre, and a hidden corner takes its bond with it', () => {
    const s = site('Ni', OCTAHEDRON);
    // hiding the centre removes the polyhedron
    expect(coordinationPolyhedra(s, at(s), new Set([0]), z)).toEqual([]);
    // hiding two corners drops it below four neighbours
    expect(coordinationPolyhedra(s, at(s), new Set([1, 2, 3]), z)).toEqual([]);
    // hiding one leaves a five-corner solid
    const five = coordinationPolyhedra(s, at(s), new Set([6]), z);
    expect(five).toHaveLength(1);
    expect(five[0]!.faces).toHaveLength(6); // a square pyramid
  });

  it('follows the positions it is given, not the ones in the document', () => {
    const s = site('Ni', OCTAHEDRON);
    // squash the octahedron along z: the faces are still eight, but they moved
    const squashed = (i: number): Vec3 => {
      const p = s.atoms[i]!.position as Vec3;
      return [p[0], p[1], p[2] * 0.25];
    };
    const found = coordinationPolyhedra(s, squashed, null, z);
    expect(found[0]!.faces).toHaveLength(8);
    const zs = found[0]!.faces.flat().map((v) => Math.abs(v[2]));
    expect(Math.max(...zs)).toBeCloseTo(0.5);
  });
});
