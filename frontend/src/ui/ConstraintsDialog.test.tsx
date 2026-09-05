import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { useToolStore } from '../editor/toolStore';
import { makeAtom, normalizeStructure } from '../model/structure';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import { ConstraintsDialog } from './ConstraintsDialog';

beforeEach(() => {
  useSelectionStore.getState().clear();
  useStructureStore.getState().load(
    normalizeStructure({
      name: 'water',
      atoms: [makeAtom('O', [0, 0, 0]), makeAtom('H', [1, 0, 0]), makeAtom('H', [0, 1, 0])],
    } as never),
  );
  useToolStore.getState().setConstraintsDialogOpen(true);
});

const constraints = () => useStructureStore.getState().doc.constraints;

test('the selection fills the atom fields and a distance constraint is added from them', () => {
  useSelectionStore.getState().set([2, 0]);
  render(<ConstraintsDialog />);
  fireEvent.change(screen.getByLabelText('Add'), { target: { value: 'distance' } });

  // the fields follow the order the atoms were picked, in the numbering the labels use
  expect((screen.getByLabelText('atom 1') as HTMLInputElement).value).toBe('3');
  expect((screen.getByLabelText('atom 2') as HTMLInputElement).value).toBe('1');
  fireEvent.change(screen.getByLabelText('target value'), { target: { value: '1.2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));

  expect(constraints()).toEqual([{ kind: 'fix_bond_length', a: 2, b: 0, value: 1.2 }]);
  expect(useStructureStore.getState().undoLabel()).toBe('Add distance constraint');
  // the row shows the target and what the geometry has now
  expect(screen.getByRole('cell', { name: 'Distance' })).toBeTruthy();
  expect(screen.getByText('H3, O1')).toBeTruthy();
  expect(screen.getByText('1.000 Å')).toBeTruthy();
});

test('an angle needs three atoms and says so', () => {
  useSelectionStore.getState().set([0, 1]);
  render(<ConstraintsDialog />);
  fireEvent.change(screen.getByLabelText('Add'), { target: { value: 'angle' } });
  fireEvent.change(screen.getByLabelText('atom 3'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));

  expect(screen.getByText(/every atom field needs a number/)).toBeTruthy();
  expect(constraints()).toEqual([]);
});

test('a row is selected by clicking it and deleted, and Delete all clears the table', () => {
  useStructureStore.getState().commit('fix', {
    ...useStructureStore.getState().doc,
    constraints: [
      { kind: 'fix_atoms', indices: [0, 1] },
      { kind: 'fix_bond_length', a: 0, b: 2, value: null },
    ],
  } as never);
  render(<ConstraintsDialog />);
  expect(screen.getAllByRole('row')).toHaveLength(4); // header + three rows

  fireEvent.click(screen.getByText('H2'));
  fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));
  expect(constraints()).toEqual([
    { kind: 'fix_atoms', indices: [0] },
    { kind: 'fix_bond_length', a: 0, b: 2, value: null },
  ]);

  fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
  expect(constraints()).toEqual([]);
  expect(screen.getByText('No constraints yet.')).toBeTruthy();
});

test('the value of an existing constraint can be typed into its row', () => {
  useStructureStore.getState().commit('fix', {
    ...useStructureStore.getState().doc,
    constraints: [{ kind: 'fix_angle', a: 1, b: 0, c: 2, value: null }],
  } as never);
  render(<ConstraintsDialog />);
  expect(screen.getByText('90.000 °')).toBeTruthy();

  fireEvent.change(screen.getByLabelText('value of constraint 1'), { target: { value: '104.5' } });
  expect(constraints()).toEqual([{ kind: 'fix_angle', a: 1, b: 0, c: 2, value: 104.5 }]);
});

test('Escape closes the dialog', () => {
  render(<ConstraintsDialog />);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(useToolStore.getState().constraintsDialogOpen).toBe(false);
});
