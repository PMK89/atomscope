import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { useToolStore } from '../editor/toolStore';
import { makeAtom, normalizeStructure } from '../model/structure';
import { useStructureStore } from '../state/structureStore';
import { CartesianEditor } from './CartesianEditor';

const crystal = () =>
  normalizeStructure({
    name: 'nacl',
    atoms: [makeAtom('Na', [0, 0, 0]), makeAtom('Cl', [2, 2.5, 3])],
    cell: {
      vectors: [
        [4, 0, 0],
        [0, 5, 0],
        [0, 0, 6],
      ],
      pbc: [true, true, true],
    },
  } as never);

beforeEach(() => {
  useToolStore.getState().setCartesianEditorOpen(true);
});

test('the editor writes and reads the units it is set to', () => {
  useStructureStore.getState().load(crystal());
  render(<CartesianEditor />);
  const value = (): string => (screen.getByLabelText('Coordinates') as HTMLTextAreaElement).value;
  expect(value()).toContain('2.50000');

  fireEvent.change(screen.getByLabelText('Units'), { target: { value: 'fractional' } });
  // the second atom is at the body centre of the cell
  expect(value()).toContain('0.50000');

  // typed as fractional, applied as Ångström
  fireEvent.change(screen.getByLabelText('Coordinates'), {
    target: { value: 'Na 0 0 0\nCl 0.25 0.5 0.5' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(useStructureStore.getState().doc.atoms[1]!.position).toEqual([1, 2.5, 3]);
  expect(useStructureStore.getState().undoStack.at(-1)?.label).toBe('Edit coordinates');
});

test('without a cell there are no fractional coordinates to offer', () => {
  useStructureStore
    .getState()
    .load(normalizeStructure({ name: 'w', atoms: [makeAtom('O', [0, 0, 0])] } as never));
  render(<CartesianEditor />);
  const option = screen.getByRole('option', { name: 'Fractional' });
  expect(option).toBeDisabled();
  expect(screen.getByText(/no unit cell/)).toBeInTheDocument();
});

test('a document loaded without a cell takes the box off fractional', () => {
  useStructureStore.getState().load(crystal());
  const { rerender } = render(<CartesianEditor />);
  fireEvent.change(screen.getByLabelText('Units'), { target: { value: 'fractional' } });
  expect(screen.getByLabelText('Units')).toHaveValue('fractional');

  act(() =>
    useStructureStore
      .getState()
      .load(normalizeStructure({ name: 'w', atoms: [makeAtom('O', [0, 0, 0])] } as never)),
  );
  rerender(<CartesianEditor />);
  expect(screen.getByLabelText('Units')).toHaveValue('angstrom');
});
