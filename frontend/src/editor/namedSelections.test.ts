import { expect, test } from 'vitest';
import { removeAtoms } from './edits';
import {
  addNamed,
  NO_NAMED_SELECTIONS,
  removeNamed,
  renameNamed,
  resolveNamed,
} from './namedSelections';
import { makeAtom, makeBond, normalizeStructure, type StructureDoc } from '../model/structure';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';

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

test('a saved set recalls the atoms it was made from', () => {
  const d = doc();
  const list = addNamed(NO_NAMED_SELECTIONS, ' ligand ', d, [2, 3]);
  expect(list).toHaveLength(1);
  expect(list[0]!.name).toBe('ligand');
  expect(resolveNamed(d, list[0]!)).toEqual([2, 3]);

  // an empty name or an empty selection saves nothing
  expect(addNamed(list, '  ', d, [0])).toBe(list);
  expect(addNamed(list, 'empty', d, [])).toBe(list);
  // and the same name overwrites rather than making a second entry, as Avogadro does
  const again = addNamed(list, 'ligand', d, [0]);
  expect(again).toHaveLength(1);
  expect(resolveNamed(d, again[0]!)).toEqual([0]);
});

test('a set follows its atoms through a deletion and narrows rather than sliding', () => {
  const d = doc();
  const list = addNamed(NO_NAMED_SELECTIONS, 'ends', d, [0, 3]);
  // drop atom 0: the set keeps the hydrogen, which is now index 2, and not the atom that moved
  // into index 0
  const after = removeAtoms(d, new Set([0]));
  expect(resolveNamed(after, list[0]!)).toEqual([2]);
  expect(list[0]!.uids).toHaveLength(2);
});

test('renaming and removing', () => {
  const d = doc();
  let list = addNamed(NO_NAMED_SELECTIONS, 'a', d, [0]);
  list = addNamed(list, 'b', d, [1]);
  expect(renameNamed(list, 'a', 'c').map((s) => s.name)).toEqual(['c', 'b']);
  // a name already taken, or an empty one, is refused rather than merging two sets
  expect(renameNamed(list, 'a', 'b')).toBe(list);
  expect(renameNamed(list, 'a', '  ')).toBe(list);
  expect(removeNamed(list, 'a').map((s) => s.name)).toEqual(['b']);
});

test('loading another document takes the sets with it', () => {
  const d = doc();
  useStructureStore.getState().load(d);
  useSelectionStore.getState().set([0, 1]);
  useSelectionStore
    .getState()
    .setNamed(addNamed(NO_NAMED_SELECTIONS, 'pair', d, useSelectionStore.getState().atoms));
  expect(useSelectionStore.getState().named).toHaveLength(1);

  // a set of another molecule's atoms would sit in the Select menu reading "0 of 2"
  useStructureStore
    .getState()
    .load(normalizeStructure({ name: 'ne', atoms: [makeAtom('Ne', [0, 0, 0])] }));
  expect(useSelectionStore.getState().named).toEqual([]);
  expect(useSelectionStore.getState().atoms.size).toBe(0);
});
