import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { useToolStore } from '../editor/toolStore';
import { makeAtom, makeBond, normalizeStructure } from '../model/structure';
import { useSelectionStore } from '../state/selectionStore';
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

test('sorting renumbers the structure, keeping the bonds and the selection on their atoms', () => {
  const water = normalizeStructure({
    name: 'water',
    atoms: [
      makeAtom('H', [0, 0.76, -0.48]),
      makeAtom('O', [0, 0, 0.12]),
      makeAtom('H', [0, -0.76, -0.48]),
    ],
    bonds: [makeBond(0, 1), makeBond(1, 2)],
    atomic_scalars: {
      partial_charge: { values: [0.3, -0.6, 0.3], unit: '', description: 'test charges' },
    },
  } as never);
  act(() => {
    useStructureStore.getState().load(water);
    useSelectionStore.getState().set([1]); // the oxygen, which sorting moves to the front
  });
  render(<CartesianEditor />);

  fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'element' } });

  const doc = useStructureStore.getState().doc;
  expect(doc.atoms.map((a) => a.element)).toEqual(['O', 'H', 'H']); // heaviest first
  // the bonds still join the same atoms, by their new numbers
  expect(doc.bonds.map((b) => [b.a, b.b].sort((x, y) => x - y))).toEqual([
    [0, 1],
    [0, 2],
  ]);
  expect(doc.atomic_scalars['partial_charge']!.values).toEqual([-0.6, 0.3, 0.3]);
  expect([...useSelectionStore.getState().atoms]).toEqual([0]);
  expect(useStructureStore.getState().undoStack.at(-1)?.label).toBe('Sort atoms by element');
  // the box shows the structure, not what it showed before
  expect((screen.getByLabelText('Coordinates') as HTMLTextAreaElement).value).toMatch(/^O /);

  // sorting into the order it is already in is not an edit
  const before = useStructureStore.getState().undoStack.length;
  fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'element' } });
  expect(useStructureStore.getState().undoStack.length).toBe(before);

  // by coordinate, ascending
  fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'y' } });
  const ys = useStructureStore.getState().doc.atoms.map((a) => a.position[1]);
  expect(ys).toEqual([...ys].sort((a, b) => a! - b!));
});

test('the format box lays the same numbers out differently, and any layout can be pasted back', () => {
  useStructureStore.getState().load(crystal());
  render(<CartesianEditor />);
  const value = (): string => (screen.getByLabelText('Coordinates') as HTMLTextAreaElement).value;

  fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'turbomole' } });
  expect(value().split('\n')[0]!.trim().endsWith('Na')).toBe(true);
  fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'priroda' } });
  expect(value().split('\n')[0]!.trim().startsWith('11')).toBe(true);

  // pasted in a layout the box is not set to: the shape decides, not the box
  fireEvent.change(screen.getByLabelText('Coordinates'), {
    target: { value: '0 0 0 Na\n1 1 1 Cl' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  const doc = useStructureStore.getState().doc;
  expect(doc.atoms.map((a) => a.element)).toEqual(['Na', 'Cl']);
  expect(doc.atoms[1]!.position).toEqual([1, 1, 1]);
});
