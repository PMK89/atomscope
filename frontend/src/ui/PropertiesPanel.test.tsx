import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { makeAtom, makeBond, normalizeStructure, partialChargeKey } from '../model/structure';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import { useAtomTypeStore } from '../state/atomTypeStore';

const { atomTypes } = vi.hoisted(() => ({ atomTypes: vi.fn() }));
vi.mock('../api/client', async (original) => {
  const actual = await original<typeof import('../api/client')>();
  return { ...actual, api: { ...actual.api, chem: { ...actual.api.chem, atomTypes } } };
});

import { PropertiesPanel } from './PropertiesPanel';

const water = () =>
  normalizeStructure({
    name: 'water',
    charge: 0,
    atoms: [
      makeAtom('O', [0, 0, 0.117]),
      makeAtom('H', [0, 0.757, -0.469]),
      makeAtom('H', [0, -0.757, -0.469]),
    ],
    bonds: [makeBond(0, 1), makeBond(0, 2)],
    atomic_scalars: {
      partial_charges: { values: [-0.4, 0.2, 0.2], unit: 'e', description: '' },
    },
    properties: { dipole_moment: { value: 1.8542, unit: 'debye' } },
  } as never);

beforeEach(() => {
  useSelectionStore.getState().clear();
  useStructureStore.getState().load(water());
  useAtomTypeStore.setState({ typing: null, key: '', error: null });
  atomTypes.mockReset();
  atomTypes.mockResolvedValue({
    types: ['O3', 'H', 'H'],
    degrees: [2, 1, 1],
    valences: [2, 1, 1],
    perception: 'openbabel',
  });
});

test('the structure section carries the weight, the counts and whatever quantities are attached', () => {
  render(<PropertiesPanel />);
  expect(screen.getByText('H2O')).toBeInTheDocument();
  // 15.999 + 2 x 1.008
  expect(screen.getByText('18.015 g/mol')).toBeInTheDocument();
  // the dipole the partial-charge run attached to the document
  expect(screen.getByText('dipole moment')).toBeInTheDocument();
  expect(screen.getByText('1.8542 debye')).toBeInTheDocument();
  expect(screen.queryByText('Residues')).toBeNull();
});

test('a selected atom shows its Open Babel type, both readings of valence, and its charge', async () => {
  render(<PropertiesPanel />);
  expect(screen.queryByText('Valence')).toBeNull(); // nothing selected

  useSelectionStore.getState().set([0]);
  await waitFor(() => expect(screen.getByText('O3')).toBeInTheDocument());
  expect(atomTypes).toHaveBeenCalledTimes(1);
  expect(screen.getByText('2 bonds, order sum 2')).toBeInTheDocument();
  expect(screen.getByLabelText('Partial charge')).toHaveValue(-0.4);
});

test('a typed partial charge is written back into the scalar property, as one undo step', () => {
  useSelectionStore.getState().set([1]);
  render(<PropertiesPanel />);
  const field = screen.getByLabelText('Partial charge');
  fireEvent.change(field, { target: { value: '0.35' } });
  fireEvent.blur(field);

  const doc = useStructureStore.getState().doc;
  expect(partialChargeKey(doc)).toBe('partial_charges');
  expect(doc.atomic_scalars['partial_charges']!.values).toEqual([-0.4, 0.35, 0.2]);
  expect(useStructureStore.getState().undoLabel()).toBe('Set partial charge');
});

test('the atom types are asked for once per revision, and again after an edit', async () => {
  useSelectionStore.getState().set([0]);
  render(<PropertiesPanel />);
  await waitFor(() => expect(atomTypes).toHaveBeenCalledTimes(1));

  const st = useStructureStore.getState();
  st.commit('rename', { ...st.doc, name: 'still water' });
  await waitFor(() => expect(atomTypes).toHaveBeenCalledTimes(2));
});
