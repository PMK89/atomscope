import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { makeAtom, normalizeStructure } from '../model/structure';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import { BondTable } from './BondTable';

const doc = () =>
  normalizeStructure({
    name: 'propane-ish',
    atoms: [
      makeAtom('C', [0, 0, 0]),
      makeAtom('C', [1.5, 0, 0]),
      makeAtom('C', [3, 0, 0]),
      makeAtom('H', [-1, 0, 0]),
    ],
    bonds: [
      { a: 0, b: 1, order: 1 },
      { a: 1, b: 2, order: 1 },
      { a: 0, b: 3, order: 1 },
    ],
  } as never);

beforeEach(() => {
  useSelectionStore.getState().clear();
  useStructureStore.getState().load(doc());
});

const structure = () => useStructureStore.getState().doc;

test('the table lists the bonds with their order and whether they rotate', () => {
  render(<BondTable />);
  expect(screen.getByRole('cell', { name: 'C1—C2' })).toBeTruthy();
  // C1-C2 joins two atoms that both carry something else; C1-H4 ends in a hydrogen
  const rotatable = screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => r.children[2]!.textContent);
  expect(rotatable).toEqual(['yes', 'no', 'no']);
});

test('editing a length moves the smaller side and keeps the rest still', () => {
  render(<BondTable />);
  fireEvent.change(screen.getByLabelText('length of C1—C2'), { target: { value: '2.000' } });
  fireEvent.blur(screen.getByLabelText('length of C1—C2'));

  const p = structure().atoms.map((a) => a.position);
  expect(useStructureStore.getState().undoLabel()).toBe('Set bond length');
  expect(Math.hypot(p[1]![0] - p[0]![0], 0, 0)).toBeCloseTo(2);
  // atom 0 carries the bigger side (C2, C3 hang off it through the bond), so it is atom 1 that moved
  expect(p[0]).toEqual([0, 0, 0]);
});

test('the order select rewrites the bond', () => {
  render(<BondTable />);
  fireEvent.change(screen.getByLabelText('order of C1—C2'), { target: { value: '2' } });
  expect(structure().bonds[0]!.order).toBe(2);
  expect(useStructureStore.getState().undoLabel()).toBe('Set bond order');
});

test('a selection narrows the table to its bonds', () => {
  useSelectionStore.getState().set([3]);
  render(<BondTable />);
  expect(screen.getAllByRole('row')).toHaveLength(2); // header and one bond
  expect(screen.getByRole('cell', { name: 'C1—H4' })).toBeTruthy();
});
