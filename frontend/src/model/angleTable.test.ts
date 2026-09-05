import { expect, test } from 'vitest';
import { setAngle, setTorsion } from '../editor/edits';
import { angleRowCount, angleRows, torsionRowCount, torsionRows } from './angleTable';
import { angleDeg, dihedralDeg } from './geometry';
import { makeAtom, makeBond, normalizeStructure, type StructureDoc, type Vec3 } from './structure';

/** Ethane-like H-C-C-H with one hydrogen on each carbon, staggered by 60 degrees. */
const ethane = (): StructureDoc =>
  normalizeStructure({
    name: 'part of ethane',
    atoms: [
      makeAtom('H', [-0.5, 1.0, 0]),
      makeAtom('C', [0, 0, 0]),
      makeAtom('C', [1.5, 0, 0]),
      makeAtom('H', [2.0, 0.5, 0.87]),
    ],
    bonds: [makeBond(0, 1), makeBond(1, 2), makeBond(2, 3)],
  } as never);

/** Cyclopropane's carbons: three atoms in a ring, so nothing about them can be driven. */
const ring = (): StructureDoc =>
  normalizeStructure({
    name: 'ring',
    atoms: [makeAtom('C', [0, 0, 0]), makeAtom('C', [1.5, 0, 0]), makeAtom('C', [0.75, 1.3, 0])],
    bonds: [makeBond(0, 1), makeBond(1, 2), makeBond(2, 0)],
  } as never);

test('every pair of bonds at an atom is an angle, and every bond with two ends a torsion', () => {
  const doc = ethane();
  const angles = angleRows(doc);
  // C1 and C2 each carry two bonds: two angles, no more
  expect(angles.map((r) => r.label)).toEqual(['H1—C2—C3', 'C2—C3—H4']);
  expect(angleRowCount(doc.atoms.length, doc.bonds)).toBe(2);

  const torsions = torsionRows(doc);
  expect(torsions.map((r) => r.label)).toEqual(['H1—C2—C3—H4']);
  expect(torsionRowCount(doc.atoms.length, doc.bonds)).toBe(1);
  expect(torsions[0]!.value).toBeCloseTo(dihedralDeg(...four(doc, [0, 1, 2, 3])), 6);
});

test('the side that moves is the far one, and a ring has none', () => {
  const angles = angleRows(ethane());
  // H1—C2—C3: turning the angle moves C3 and what hangs off it, not H1
  expect(angles[0]!.moving).toEqual([2, 3]);
  expect(torsionRows(ethane())[0]!.moving).toEqual([2, 3]);

  const cycle = angleRows(ring());
  expect(cycle).toHaveLength(3);
  expect(cycle.every((r) => r.moving === null)).toBe(true);
  expect(torsionRows(ring()).every((r) => r.ring && r.moving === null)).toBe(true);
});

test('the tables narrow to the selection the way the bond table does', () => {
  const doc = ethane();
  expect(angleRows(doc, new Set([0])).map((r) => r.label)).toEqual(['H1—C2—C3']);
  expect(angleRowCount(doc.atoms.length, doc.bonds, new Set([0]))).toBe(1);
  expect(torsionRows(doc, new Set([9]))).toEqual([]);
  expect(torsionRowCount(doc.atoms.length, doc.bonds, new Set([9]))).toBe(0);
});

test('typing an angle turns the far side to it and leaves the near side alone', () => {
  const doc = ethane();
  const row = angleRows(doc)[0]!;
  const next = setAngle(doc, row.a, row.b, row.c, 109.5, row.moving!);
  expect(angleDeg(...three(next, [row.a, row.b, row.c]))).toBeCloseTo(109.5, 6);
  // the vertex and the atom on the fixed side did not move
  expect(next.atoms[row.a]!.position).toEqual(doc.atoms[row.a]!.position);
  expect(next.atoms[row.b]!.position).toEqual(doc.atoms[row.b]!.position);
  // and the hydrogen hanging off the far carbon came with it
  expect(next.atoms[3]!.position).not.toEqual(doc.atoms[3]!.position);
});

test('typing a torsion turns about the central bond only', () => {
  const doc = ethane();
  const row = torsionRows(doc)[0]!;
  const next = setTorsion(doc, row.a, row.b, row.c, row.d, 180, row.moving!);
  expect(dihedralDeg(...four(next, [row.a, row.b, row.c, row.d]))).toBeCloseTo(180, 6);
  // the near atoms are untouched, and the far end of the axis only to rounding: it is on the axis
  expect(next.atoms[row.a]!.position).toEqual(doc.atoms[row.a]!.position);
  expect(next.atoms[row.b]!.position).toEqual(doc.atoms[row.b]!.position);
  next.atoms[row.c]!.position.forEach((v, k) =>
    expect(v).toBeCloseTo(doc.atoms[row.c]!.position[k]!, 9),
  );
  // the angle at the far end is a property of the bonds, not of the torsion: it is unchanged
  expect(angleDeg(...three(next, [1, 2, 3]))).toBeCloseTo(angleDeg(...three(doc, [1, 2, 3])), 6);
});

test('a straight angle has no plane to turn in, so the row says so and the edit is a no-op', () => {
  const linear = normalizeStructure({
    name: 'co2',
    atoms: [makeAtom('O', [-1.2, 0, 0]), makeAtom('C', [0, 0, 0]), makeAtom('O', [1.2, 0, 0])],
    bonds: [makeBond(0, 1), makeBond(1, 2)],
  } as never);
  const row = angleRows(linear)[0]!;
  expect(row.straight).toBe(true);
  expect(row.moving).toBeNull();
  expect(setAngle(linear, 0, 1, 2, 120, [2])).toBe(linear);
  // a bent one is neither
  expect(angleRows(ethane())[0]!.straight).toBe(false);
});

const at = (doc: StructureDoc, i: number): Vec3 => doc.atoms[i]!.position as Vec3;
const three = (doc: StructureDoc, [a, b, c]: number[]): [Vec3, Vec3, Vec3] => [
  at(doc, a!),
  at(doc, b!),
  at(doc, c!),
];
const four = (doc: StructureDoc, [a, b, c, d]: number[]): [Vec3, Vec3, Vec3, Vec3] => [
  at(doc, a!),
  at(doc, b!),
  at(doc, c!),
  at(doc, d!),
];
