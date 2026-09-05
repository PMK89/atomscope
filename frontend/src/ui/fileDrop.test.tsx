import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { makeAtom } from '../model/structure';
import { useStructureStore } from '../state/structureStore';
import { droppedFile, hasFiles } from './fileDrop';

const { importUpload } = vi.hoisted(() => ({ importUpload: vi.fn() }));
// only the upload is faked: the rest of the client stays real, and fails on fetch the way it does
// in the other App tests, so this file does not have to know what every panel asks for on mount
vi.mock('../api/client', async (original) => {
  const actual = await original<typeof import('../api/client')>();
  return { ...actual, api: { ...actual.api, io: { ...actual.api.io, importUpload } } };
});
vi.mock('./Viewport', () => ({ Viewport: () => <div data-testid="viewport" /> }));
vi.mock('./ProjectPanel', () => ({ ProjectPanel: () => <div>Project</div> }));
vi.mock('./CalculationPanel', () => ({ CalculationPanel: () => <div>Calculation</div> }));

import { App } from './App';

const file = (name: string): File => new File(['C 0 0 0\n'], name, { type: 'text/plain' });
const transfer = (...files: File[]): { types: string[]; files: File[] } => ({
  types: ['Files'],
  files,
});

test('a drag of files is accepted and anything else is ignored', () => {
  expect(hasFiles({ types: ['Files', 'text/plain'] } as unknown as DataTransfer)).toBe(true);
  expect(hasFiles({ types: ['text/plain'] } as unknown as DataTransfer)).toBe(false);
  expect(hasFiles(null)).toBe(false);
});

test('one file is opened; the rest of a multi-file drop are left alone, and said to be', () => {
  expect(droppedFile([])).toEqual({ file: null, message: 'That drop carried no file' });
  const one = file('a.xyz');
  expect(droppedFile([one])).toEqual({ file: one, message: null });
  const three = droppedFile([one, file('b.xyz'), file('c.xyz')]);
  expect(three.file).toBe(one);
  expect(three.message).toMatch(/other 2 files were left alone/);
  expect(droppedFile([one, file('b.xyz')]).message).toMatch(/other 1 file was left alone/);
});

test('dropping a file on the window opens it, and the overlay comes and goes with the drag', async () => {
  importUpload.mockResolvedValue({
    name: 'methane',
    charge: 0,
    atoms: [makeAtom('C', [0, 0, 0])],
    bonds: [],
  });
  render(<App />);
  const shell = screen.getByTestId('viewport').closest('.app-shell')!;

  expect(screen.queryByText('Drop a file to open it')).toBeNull();
  fireEvent.dragEnter(shell, { dataTransfer: transfer(file('methane.xyz')) });
  expect(screen.getByText('Drop a file to open it')).toBeInTheDocument();
  // crossing into a child fires a leave on the parent: the overlay must not flicker away
  fireEvent.dragEnter(shell, { dataTransfer: transfer(file('methane.xyz')) });
  fireEvent.dragLeave(shell, { dataTransfer: transfer(file('methane.xyz')) });
  expect(screen.getByText('Drop a file to open it')).toBeInTheDocument();

  fireEvent.drop(shell, { dataTransfer: transfer(file('methane.xyz')) });
  expect(screen.queryByText('Drop a file to open it')).toBeNull();
  await waitFor(() => expect(useStructureStore.getState().doc.name).toBe('methane'));
  expect(importUpload).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'methane.xyz' }),
    undefined,
  );
});

test('a file the backend cannot read is reported in the status bar', async () => {
  importUpload.mockRejectedValue(new Error('unknown format'));
  render(<App />);
  const shell = screen.getByTestId('viewport').closest('.app-shell')!;
  fireEvent.drop(shell, { dataTransfer: transfer(file('notes.txt')) });
  expect(await screen.findByText('Open failed: unknown format')).toBeInTheDocument();
});

test('a drag that carries no file is left to the browser', () => {
  render(<App />);
  const shell = screen.getByTestId('viewport').closest('.app-shell')!;
  const before = useStructureStore.getState().doc;
  fireEvent.dragEnter(shell, { dataTransfer: { types: ['text/plain'], files: [] } });
  expect(screen.queryByText('Drop a file to open it')).toBeNull();
  fireEvent.drop(shell, { dataTransfer: { types: ['text/plain'], files: [] } });
  expect(useStructureStore.getState().doc).toBe(before);
});

test('a drop over unsaved work asks first, and Cancel keeps the document', async () => {
  const st = useStructureStore.getState();
  st.commit('rename', { ...st.doc, name: 'work in progress' });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  importUpload.mockClear();
  importUpload.mockResolvedValue({ name: 'other', charge: 0, atoms: [], bonds: [] });
  render(<App />);
  const shell = screen.getByTestId('viewport').closest('.app-shell')!;

  fireEvent.drop(shell, { dataTransfer: transfer(file('other.xyz')) });
  await waitFor(() => expect(confirm).toHaveBeenCalled());
  expect(importUpload).not.toHaveBeenCalled();
  expect(useStructureStore.getState().doc.name).toBe('work in progress');
  confirm.mockRestore();
});
