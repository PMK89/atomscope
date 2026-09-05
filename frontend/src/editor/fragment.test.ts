import { expect, test } from 'vitest';
import { makeAtom, makeBond, normalizeStructure, type StructureDoc } from '../model/structure';
import { mergeFragment, selectionFragment, toXyz } from './fragment';

const doc = (): StructureDoc =>
  normalizeStructure({
    name: 'acetone',
    atoms: [
      makeAtom('C', [0, 0, 0]),
      makeAtom('O', [1.2, 0, 0]),
      makeAtom('C', [-0.8, 1.3, 0]),
      makeAtom('H', [-1.9, 1.2, 0]),
    ],
    bonds: [makeBond(0, 1, 2), makeBond(0, 2), makeBond(2, 3)],
  } as never);

test('a fragment keeps the bonds inside the selection and drops the ones leaving it', () => {
  const frag = selectionFragment(doc(), [0, 1]);
  expect(frag.atoms.map((a) => a.element)).toEqual(['C', 'O']);
  // the C=O double bond survives with its order; C-C left the selection
  expect(frag.bonds).toEqual([expect.objectContaining({ a: 0, b: 1, order: 2 })]);
});

test('a selection given out of order still yields atoms in document order', () => {
  const frag = selectionFragment(doc(), [3, 2, 2]);
  expect(frag.atoms.map((a) => a.element)).toEqual(['C', 'H']);
  expect(frag.bonds).toEqual([expect.objectContaining({ a: 0, b: 1 })]);
});

test('merging appends the fragment and reports the atoms it added', () => {
  const base = doc();
  const frag = selectionFragment(base, [0, 1]);
  const { doc: merged, added } = mergeFragment(base, frag, [0, 0, 5]);

  expect(merged.atoms).toHaveLength(6);
  expect(added).toEqual([4, 5]);
  expect(merged.atoms[4]!.position[2]).toBeCloseTo(5);
  // the pasted bond points at the pasted atoms, not at the originals
  expect(merged.bonds.at(-1)).toEqual(expect.objectContaining({ a: 4, b: 5, order: 2 }));
});

test('pasting twice does not produce two atoms with the same identity', () => {
  const base = doc();
  const frag = selectionFragment(base, [0]);
  const once = mergeFragment(base, frag).doc;
  const twice = mergeFragment(once, frag).doc;
  const uids = twice.atoms.map((a) => a.uid);
  expect(new Set(uids).size).toBe(uids.length);
});

test('XYZ text is what another program expects', () => {
  const text = toXyz(selectionFragment(doc(), [0, 1]));
  const lines = text.trimEnd().split('\n');
  expect(lines[0]).toBe('2');
  expect(lines[2]).toBe('C 0.000000 0.000000 0.000000');
  expect(lines[3]).toBe('O 1.200000 0.000000 0.000000');
});
