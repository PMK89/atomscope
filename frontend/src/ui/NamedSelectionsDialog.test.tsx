import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { addNamed, NO_NAMED_SELECTIONS } from '../editor/namedSelections';
import { removeAtoms } from '../editor/edits';
import { makeAtom, makeBond, normalizeStructure, type StructureDoc } from '../model/structure';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import { NamedSelectionsDialog } from './NamedSelectionsDialog';

const doc = (): StructureDoc =>
  normalizeStructure({
    name: 'c3',
    atoms: [makeAtom('C', [0, 0, 0]), makeAtom('C', [1.5, 0, 0]), makeAtom('O', [3, 0, 0])],
    bonds: [makeBond(0, 1), makeBond(1, 2)],
  });

beforeEach(() => {
  useStructureStore.getState().load(doc());
  useSelectionStore.getState().clear();
  useSelectionStore.getState().setNamed(NO_NAMED_SELECTIONS);
});

test('an empty list says how to make one', () => {
  render(<NamedSelectionsDialog open onClose={() => {}} />);
  expect(screen.getByText(/No named selections/)).toBeInTheDocument();
});

test('a set is recalled, renamed and removed, and says what is left of it', () => {
  const d = useStructureStore.getState().doc;
  useSelectionStore.getState().setNamed(addNamed(NO_NAMED_SELECTIONS, 'ends', d, [0, 2]));
  const onClose = vi.fn();
  const { rerender } = render(<NamedSelectionsDialog open onClose={onClose} />);
  expect(screen.getByRole('cell', { name: 'ends' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: '2' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Select' }));
  expect([...useSelectionStore.getState().atoms]).toEqual([0, 2]);
  expect(onClose).toHaveBeenCalled();

  // delete the first carbon: the oxygen is index 1 now, and the set is down to one of two
  act(() => useStructureStore.getState().commit('Delete', removeAtoms(d, new Set([0]))));
  rerender(<NamedSelectionsDialog open onClose={onClose} />);
  expect(screen.getByRole('cell', { name: '1 of 2' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Select' }));
  expect([...useSelectionStore.getState().atoms]).toEqual([1]);

  vi.spyOn(window, 'prompt').mockReturnValue('caps');
  fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
  expect(useSelectionStore.getState().named.map((s) => s.name)).toEqual(['caps']);

  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(useSelectionStore.getState().named).toHaveLength(0);
});
