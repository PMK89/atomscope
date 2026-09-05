import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { usePasteStore } from '../state/pasteStore';
import { SpeciesDialog } from './SpeciesDialog';

const pasteWithSpecies = vi.fn(async () => true);
vi.mock('./clipboardActions', () => ({
  pasteWithSpecies: (...args: unknown[]) => pasteWithSpecies(...(args as [])),
}));

beforeEach(() => {
  pasteWithSpecies.mockClear();
  usePasteStore.getState().cancel();
});

test('nothing is asked until a paste asks', () => {
  const { container } = render(<SpeciesDialog onError={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});

test('one field per species, and the answer goes back with the same text', () => {
  usePasteStore.getState().ask({ text: 'POSCAR', counts: [2, 4] });
  render(<SpeciesDialog onError={() => {}} />);
  expect(screen.getByText(/counts 2 species \(6 atoms\)/)).toBeInTheDocument();

  // the counts are shown per species, singular and plural
  const paste = screen.getByRole('button', { name: 'Paste' });
  expect(paste).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Species 1 (2 atoms)'), { target: { value: 'Si' } });
  expect(paste).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Species 2 (4 atoms)'), { target: { value: ' O ' } });
  expect(paste).toBeEnabled();

  fireEvent.click(paste);
  expect(pasteWithSpecies).toHaveBeenCalledWith('POSCAR', ['Si', 'O'], expect.any(Function));
  // the dialog closes as it pastes, so a second Ctrl+V is not answered by a stale question
  expect(usePasteStore.getState().pending).toBeNull();
});

test('Cancel abandons the paste', () => {
  usePasteStore.getState().ask({ text: 'POSCAR', counts: [1] });
  render(<SpeciesDialog onError={() => {}} />);
  expect(screen.getByLabelText('Species 1 (1 atom)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(usePasteStore.getState().pending).toBeNull();
  expect(pasteWithSpecies).not.toHaveBeenCalled();
});
