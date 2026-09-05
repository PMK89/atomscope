import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { api } from '../api/client';
import { makeAtom, normalizeStructure } from '../model/structure';
import { useBuildStore } from '../state/buildStore';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import { BuildDialogs } from './BuildDialogs';

const MERGED = {
  id: 'merged',
  name: 'merged',
  atoms: [makeAtom('C', [0, 0, 0]), makeAtom('C', [1.5, 0, 0])],
  bonds: [],
};

beforeEach(() => {
  vi.restoreAllMocks();
  useSelectionStore.getState().clear();
  useStructureStore
    .getState()
    .load(normalizeStructure({ name: 'methane', atoms: [makeAtom('C', [0, 0, 0])] } as never));
  useBuildStore.getState().closeDialog();
});

test('the fragment library inserts by id and attaches to a single selected atom', async () => {
  vi.spyOn(api.build, 'fragments').mockResolvedValue([
    { id: 'alkanes/ethane', name: 'ethane', category: 'alkanes', formula: 'C2H6', n_atoms: 8 },
  ] as never);
  const insert = vi.spyOn(api.build, 'insert').mockResolvedValue(MERGED as never);
  useSelectionStore.getState().set([0]);
  useBuildStore.getState().openDialog('fragment');

  render(<BuildDialogs onError={() => {}} />);
  fireEvent.click(await screen.findByText(/ethane/));

  await waitFor(() => expect(insert).toHaveBeenCalled());
  expect(insert).toHaveBeenCalledWith(
    expect.objectContaining({ fragment_id: 'alkanes/ethane', attach_atom: 0 }),
  );
  expect(useStructureStore.getState().undoLabel()).toBe('Insert ethane');
  // the document keeps its identity: inserting is an edit, not a new structure
  expect(useStructureStore.getState().doc.name).toBe('methane');
  expect(useBuildStore.getState().dialog).toBeNull();
});

test('a peptide is built and then inserted, without an attachment point', async () => {
  vi.spyOn(api.build, 'peptidePresets').mockResolvedValue({
    presets: { alpha_helix: [-60, -40], beta_sheet: [-135, 135] },
  } as never);
  const peptide = vi.spyOn(api.build, 'peptide').mockResolvedValue(MERGED as never);
  const insert = vi.spyOn(api.build, 'insert').mockResolvedValue(MERGED as never);
  useBuildStore.getState().openDialog('peptide');

  render(<BuildDialogs onError={() => {}} />);
  fireEvent.change(screen.getByLabelText('Sequence'), { target: { value: 'agk' } });
  await screen.findByText('beta_sheet');
  // the select must only ever hold a name the backend knows
  expect((screen.getByLabelText('Conformation') as HTMLSelectElement).value).toBe('alpha_helix');
  fireEvent.change(screen.getByLabelText('Conformation'), { target: { value: 'beta_sheet' } });
  fireEvent.click(screen.getByText('Insert'));

  await waitFor(() => expect(insert).toHaveBeenCalled());
  expect(peptide).toHaveBeenCalledWith(
    expect.objectContaining({ sequence: 'AGK', preset: 'beta_sheet' }),
  );
  expect(insert.mock.calls[0]![0]).not.toHaveProperty('attach_atom');
});

test('RNA cannot be double stranded', async () => {
  useBuildStore.getState().openDialog('nucleic');
  render(<BuildDialogs onError={() => {}} />);
  expect((screen.getByLabelText('Double strand') as HTMLInputElement).checked).toBe(true);
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'rna' } });
  expect((screen.getByLabelText('Double strand') as HTMLInputElement).checked).toBe(false);
});

test('the nanotube dialog builds a tube', async () => {
  const nanotube = vi.spyOn(api.build, 'nanotube').mockResolvedValue(MERGED as never);
  vi.spyOn(api.build, 'insert').mockResolvedValue(MERGED as never);
  useBuildStore.getState().openDialog('nanotube');

  render(<BuildDialogs onError={() => {}} />);
  fireEvent.change(screen.getByLabelText('n, m'), { target: { value: '6' } });
  fireEvent.click(screen.getByText('Insert'));
  await waitFor(() => expect(nanotube).toHaveBeenCalledWith(expect.objectContaining({ n: 6 })));
});

test('switching the nanotube dialog to a sheet drops the length and calls graphene', async () => {
  const graphene = vi.spyOn(api.build, 'graphene').mockResolvedValue(MERGED as never);
  vi.spyOn(api.build, 'insert').mockResolvedValue(MERGED as never);
  useBuildStore.getState().openDialog('nanotube');

  render(<BuildDialogs onError={() => {}} />);
  expect(screen.getByLabelText('Unit cells')).toBeDefined();
  fireEvent.change(screen.getByLabelText('Shape'), { target: { value: 'graphene' } });
  expect(screen.queryByLabelText('Unit cells')).toBeNull();
  fireEvent.click(screen.getByText('Insert'));
  await waitFor(() => expect(graphene).toHaveBeenCalled());
});

test('a failed insertion is reported and the dialog stays open', async () => {
  vi.spyOn(api.build, 'peptidePresets').mockResolvedValue({
    presets: { alpha_helix: [-60, -40] },
  } as never);
  vi.spyOn(api.build, 'peptide').mockRejectedValue(new Error('unknown residue X'));
  const onError = vi.fn();
  useBuildStore.getState().openDialog('peptide');

  render(<BuildDialogs onError={onError} />);
  await screen.findByText('alpha_helix');
  fireEvent.change(screen.getByLabelText('Sequence'), { target: { value: 'X' } });
  fireEvent.click(screen.getByText('Insert'));

  await waitFor(() =>
    expect(onError).toHaveBeenCalledWith('Insert peptide X failed: unknown residue X'),
  );
  expect(useBuildStore.getState().dialog).toBe('peptide');
});

test('Escape closes the dialog', () => {
  useBuildStore.getState().openDialog('fragment');
  render(<BuildDialogs onError={() => {}} />);
  const dialog = screen.getByRole('dialog', { name: 'Insert fragment' });
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(useBuildStore.getState().dialog).toBeNull();
});
