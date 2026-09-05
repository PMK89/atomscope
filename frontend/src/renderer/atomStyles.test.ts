import { expect, test } from 'vitest';
import { removeAtoms } from '../editor/edits';
import { makeAtom, makeBond, normalizeStructure, type StructureDoc } from '../model/structure';
import {
  assignStyle,
  assignmentCounts,
  displayOnly,
  hiddenAtoms,
  NO_STYLES,
  styleArray,
} from './atomStyles';

const doc = (): StructureDoc =>
  normalizeStructure({
    name: 'c3',
    atoms: [
      makeAtom('C', [0, 0, 0]),
      makeAtom('C', [1.5, 0, 0]),
      makeAtom('O', [3, 0, 0]),
      makeAtom('H', [4, 0, 0]),
    ],
    bonds: [makeBond(0, 1), makeBond(1, 2), makeBond(2, 3)],
  });

test('an assignment reaches the atoms it names and nothing else', () => {
  const d = doc();
  const a = assignStyle(NO_STYLES, d, [1, 2], 'vdw');
  expect(styleArray(d, a)).toEqual([null, 'vdw', 'vdw', null]);
  expect(assignmentCounts(d, a)).toEqual({ assigned: 2, hidden: 0 });

  const cleared = assignStyle(a, d, [2], null);
  expect(styleArray(d, cleared)).toEqual([null, 'vdw', null, null]);
});

test('nothing assigned to this document is the fast path', () => {
  const d = doc();
  expect(styleArray(d, NO_STYLES)).toBeNull();
  // an assignment made against another document does not apply to this one
  const other = assignStyle(NO_STYLES, doc(), [0], 'vdw');
  expect(styleArray(d, other)).toBeNull();
  expect(assignmentCounts(d, other)).toEqual({ assigned: 0, hidden: 0 });
});

test('display only hides everything else and keeps what the shown atoms had', () => {
  const d = doc();
  const first = assignStyle(NO_STYLES, d, [0], 'wireframe');
  const only = displayOnly(first, d, [0, 1], null);
  expect(styleArray(d, only)).toEqual(['wireframe', null, 'hidden', 'hidden']);
  expect(assignmentCounts(d, only)).toEqual({ assigned: 3, hidden: 2 });
  expect([...(hiddenAtoms(styleArray(d, only)) ?? [])]).toEqual([2, 3]);

  // with a style it wins over what they had
  const restyled = displayOnly(first, d, [0, 1], 'vdw');
  expect(styleArray(d, restyled)).toEqual(['vdw', 'vdw', 'hidden', 'hidden']);
});

test('an assignment follows the atoms through a deletion, not their indices', () => {
  const d = doc();
  const a = assignStyle(NO_STYLES, d, [2, 3], 'hidden');
  expect(styleArray(d, a)).toEqual([null, null, 'hidden', 'hidden']);

  // atom 0 goes: the oxygen and its hydrogen are now 1 and 2 and must still be the hidden ones
  const smaller = removeAtoms(d, [0]);
  expect(styleArray(smaller, a)).toEqual([null, 'hidden', 'hidden']);
});

test('hiddenAtoms is null when nothing is hidden', () => {
  const d = doc();
  expect(hiddenAtoms(styleArray(d, assignStyle(NO_STYLES, d, [0], 'stick')))).toBeNull();
  expect(hiddenAtoms(null)).toBeNull();
});
