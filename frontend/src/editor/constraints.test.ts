import { expect, test } from 'vitest';
import {
  constraintRows,
  constraintsJson,
  makeConstraint,
  parseConstraintsJson,
  withRowValue,
  withoutRows,
} from './constraints';
import { makeAtom, normalizeStructure, type StructureDoc } from '../model/structure';

/** Water, with the hydrogens 1 Å from the oxygen and 90° apart. */
const doc = (constraints: unknown[] = []): StructureDoc =>
  normalizeStructure({
    name: 'water',
    atoms: [
      makeAtom('O', [0, 0, 0]),
      makeAtom('H', [1, 0, 0]),
      makeAtom('H', [0, 1, 0]),
      makeAtom('H', [0, 0, 1]),
    ],
    constraints,
  } as never);

test('a constraint over several atoms becomes one row per atom', () => {
  const rows = constraintRows(doc([{ kind: 'fix_atoms', indices: [0, 2] }]));
  expect(rows.map((r) => [r.kind, r.atoms])).toEqual([
    ['fix', [0]],
    ['fix', [2]],
  ]);
  expect(rows.every((r) => r.constraint === 0)).toBe(true);
});

test('a Cartesian mask becomes the axes it fixes, or one Fix atom when it fixes all three', () => {
  const partial = constraintRows(
    doc([{ kind: 'fix_cartesian', index: 1, mask: [true, false, true] }]),
  );
  expect(partial.map((r) => r.kind)).toEqual(['fix_x', 'fix_z']);
  const all = constraintRows(doc([{ kind: 'fix_cartesian', index: 1, mask: [true, true, true] }]));
  expect(all.map((r) => r.kind)).toEqual(['fix']);
});

test('an internal coordinate reports the value it holds and the one the geometry has', () => {
  const rows = constraintRows(
    doc([
      { kind: 'fix_bond_length', a: 0, b: 1, value: 0.98 },
      { kind: 'fix_angle', a: 1, b: 0, c: 2, value: null },
      { kind: 'fix_dihedral', a: 1, b: 0, c: 2, d: 3, value: null },
    ]),
  );
  expect(rows[0]!.value).toBe(0.98);
  expect(rows[0]!.current).toBeCloseTo(1);
  expect(rows[1]!.value).toBeNull();
  expect(rows[1]!.current).toBeCloseTo(90);
  expect(rows[2]!.current).not.toBeNull();
});

test('making a constraint checks the atom count, the numbering and repeats', () => {
  const d = doc();
  expect(makeConstraint(d, 'angle', [0, 1], null)).toMatch(/needs 3 atoms/);
  expect(makeConstraint(d, 'fix', [9], null)).toMatch(/between 1 and 4/);
  expect(makeConstraint(d, 'distance', [1, 1], null)).toMatch(/same atom/);
  expect(makeConstraint(d, 'fix_y', [2], null)).toEqual({
    kind: 'fix_cartesian',
    index: 2,
    mask: [false, true, false],
  });
  expect(makeConstraint(d, 'distance', [0, 1], 1.2)).toEqual({
    kind: 'fix_bond_length',
    a: 0,
    b: 1,
    value: 1.2,
  });
  expect(makeConstraint(d, 'ignore', [3], null)).toEqual({ kind: 'ignore_atoms', indices: [3] });
});

test('deleting one row of a multi-atom constraint keeps the others', () => {
  const d = doc([
    { kind: 'fix_atoms', indices: [0, 1, 2] },
    { kind: 'ignore_atoms', indices: [3] },
  ]);
  const rows = constraintRows(d);
  expect(withoutRows(d, [rows[1]!])).toEqual([
    { kind: 'fix_atoms', indices: [0] },
    { kind: 'fix_atoms', indices: [2] },
    { kind: 'ignore_atoms', indices: [3] },
  ]);
  expect(withoutRows(d, rows)).toEqual([]);
});

test('a row value is written back to the constraint it came from', () => {
  const d = doc([
    { kind: 'fix_bond_length', a: 0, b: 1, value: null },
    { kind: 'fix_bond_length', a: 0, b: 2, value: null },
  ]);
  const rows = constraintRows(d);
  expect(withRowValue(d, rows[1]!, 1.4)).toEqual([
    { kind: 'fix_bond_length', a: 0, b: 1, value: null },
    { kind: 'fix_bond_length', a: 0, b: 2, value: 1.4 },
  ]);
});

test('constraints survive a trip through the file format', () => {
  const list = [
    { kind: 'fix_atoms', indices: [0, 1] },
    { kind: 'fix_dihedral', a: 0, b: 1, c: 2, d: 3, value: 60 },
  ];
  expect(parseConstraintsJson(constraintsJson(list as never))).toEqual(list);
  expect(() => parseConstraintsJson('{"constraints": [{"kind": "fix_everything"}]}')).toThrow(
    /unknown constraint/,
  );
  expect(() => parseConstraintsJson('{"atoms": []}')).toThrow(/no constraints/);
});
