import { expect, test } from 'vitest';
import { bondRowCount, bondRows } from './bondTable';
import { makeAtom, normalizeStructure } from './structure';

/** Cyclopropane-like ring of three carbons, with one methyl and one hydrogen hanging off it. */
const doc = normalizeStructure({
  name: 'ring',
  atoms: [
    makeAtom('C', [0, 0, 0]),
    makeAtom('C', [1.5, 0, 0]),
    makeAtom('C', [0.75, 1.3, 0]),
    makeAtom('C', [-1.5, 0, 0]),
    makeAtom('H', [-2, 1, 0]),
  ],
  bonds: [
    { a: 0, b: 1, order: 1 },
    { a: 1, b: 2, order: 1 },
    { a: 2, b: 0, order: 1 },
    { a: 0, b: 3, order: 1 },
    { a: 3, b: 4, order: 1 },
  ],
} as never);

test('ring bonds are not rotatable, and neither are terminal ones', () => {
  const rows = bondRows(doc);
  expect(rows.map((r) => r.ring)).toEqual([true, true, true, false, false]);
  // C0-C3 joins two atoms that each carry something else: the only rotatable bond here
  expect(rows.map((r) => r.rotatable)).toEqual([false, false, false, true, false]);
  expect(rows[3]!.label).toBe('C1—C4');
  expect(rows[3]!.length).toBeCloseTo(1.5);
});

test('a double or aromatic bond does not rotate', () => {
  const ethene = normalizeStructure({
    name: 'ethene',
    atoms: [
      makeAtom('C', [0, 0, 0]),
      makeAtom('C', [1.33, 0, 0]),
      makeAtom('H', [-1, 0, 0]),
      makeAtom('H', [2.3, 0, 0]),
    ],
    bonds: [
      { a: 0, b: 1, order: 2 },
      { a: 0, b: 2, order: 1 },
      { a: 1, b: 3, order: 1 },
    ],
  } as never);
  expect(bondRows(ethene)[0]!.rotatable).toBe(false);
});

test('a selection narrows the table to the bonds that touch it', () => {
  const rows = bondRows(doc, new Set([4]));
  expect(rows.map((r) => r.index)).toEqual([4]);
  expect(bondRowCount(doc, new Set([4]))).toBe(1);
  expect(bondRowCount(doc)).toBe(5);
});
