import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../api/client';
import { NO_NAMED_SELECTIONS } from '../editor/namedSelections';
import { useRecentStore } from '../state/recentStore';
import { useSelectionStore } from '../state/selectionStore';
import { useViewStore } from '../state/viewStore';
import { makeAtom, normalizeStructure } from '../model/structure';
import { useStructureStore } from '../state/structureStore';
import { MenuBar } from './MenuBar';
import { PluginProvider } from '../plugins/context';
import { plugins } from '../plugins/builtins';

/** The bar needs a plugin registry above it, as it has one in the application. */
const renderMenuBar = (onError: (m: string) => void = () => {}): void => {
  render(
    <PluginProvider registry={plugins()}>
      <MenuBar onError={onError} />
    </PluginProvider>,
  );
};

function water() {
  return normalizeStructure({
    name: 'water',
    charge: 0,
    atoms: [makeAtom('O', [0, 0, 0]), makeAtom('H', [0, 0.8, 0.5]), makeAtom('H', [0, -0.8, 0.5])],
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  useRecentStore.setState({ files: [] });
  useSelectionStore.getState().clear();
  useSelectionStore.getState().setNamed(NO_NAMED_SELECTIONS);
  const st = useStructureStore.getState();
  st.load(water());
  st.commit('rename', { ...useStructureStore.getState().doc, name: 'renamed' });
  // the rename leaves unsaved work, so every action that replaces the document asks first
  // (replaceDocument.ts); these tests are about what happens once the user has said yes
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

test('Ctrl+Z outside a text field undoes the document edit', () => {
  renderMenuBar();
  fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
  expect(useStructureStore.getState().doc.name).toBe('water');
});

test('Ctrl+Z / Ctrl+Y / Ctrl+A inside a text field are left to the browser', () => {
  render(
    <PluginProvider registry={plugins()}>
      <MenuBar onError={() => {}} />
      <input aria-label="a field" defaultValue="text" />
    </PluginProvider>,
  );
  const field = screen.getByLabelText('a field');
  const before = useStructureStore.getState();
  fireEvent.keyDown(field, { key: 'z', ctrlKey: true });
  fireEvent.keyDown(field, { key: 'Z', ctrlKey: true, shiftKey: true });
  fireEvent.keyDown(field, { key: 'y', ctrlKey: true });
  fireEvent.keyDown(field, { key: 'a', ctrlKey: true });
  const after = useStructureStore.getState();
  expect(after.doc).toBe(before.doc);
  expect(after.undoStack.length).toBe(before.undoStack.length);
  expect(after.redoStack.length).toBe(before.redoStack.length);
});

test('menu titles announce their popup and items carry checkable roles', () => {
  renderMenuBar();
  const view = screen.getByRole('button', { name: 'View' });
  expect(view).toHaveAttribute('aria-haspopup', 'menu');
  expect(view).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(view);
  expect(view).toHaveAttribute('aria-expanded', 'true');
  const menu = screen.getByRole('menu');
  expect(menu).toHaveAttribute('aria-labelledby', view.id);
  // checkable entries are menuitemcheckbox with a state, plain commands stay menuitem
  const hydrogens = screen.getByRole('menuitemcheckbox', { name: /Show hydrogens/ });
  expect(hydrogens).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('menuitem', { name: /Fit to structure/ })).toBeInTheDocument();
  expect(screen.getByRole('menuitemcheckbox', { name: /Background: white/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // with a colour of its own neither preset is what is on screen, so neither is ticked
  act(() => useViewStore.getState().setBackgroundColor('#204080'));
  for (const name of [/Background: white/, /Background: black/])
    expect(screen.getByRole('menuitemcheckbox', { name })).toHaveAttribute('aria-checked', 'false');
  act(() => useViewStore.getState().setBackground('white'));
});

test('menus support arrow-key navigation, skip disabled items and close on Escape', () => {
  renderMenuBar();
  const edit = screen.getByRole('button', { name: 'Edit' });
  const label = (): string => (document.activeElement as HTMLElement).textContent ?? '';
  fireEvent.keyDown(edit, { key: 'ArrowDown' });
  // beforeEach committed one edit, so Undo is available but Redo is not
  expect(label()).toContain('Undo rename');
  const menu = screen.getByRole('menu');
  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  expect(label()).toContain('Cut'); // the disabled Redo entry was skipped
  fireEvent.keyDown(menu, { key: 'ArrowUp' });
  expect(label()).toContain('Undo rename');
  fireEvent.keyDown(menu, { key: 'End' });
  expect(label()).toContain('Cartesian editor');
  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  expect(label()).toContain('Undo rename'); // wraps around
  fireEvent.keyDown(menu, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(edit);
});

test('Select SMARTS asks the backend and selects the matching atoms', async () => {
  const smarts = vi
    .spyOn(api.chem, 'smarts')
    .mockResolvedValue({ matches: [[0, 1]], atoms: [0, 1] } as never);
  vi.spyOn(window, 'prompt').mockReturnValue('[OX2H]');

  renderMenuBar();
  fireEvent.click(screen.getByRole('button', { name: 'Select' }));
  fireEvent.click(screen.getByText('Select SMARTS…'));

  await waitFor(() => expect([...useSelectionStore.getState().atoms]).toEqual([0, 1]));
  expect(smarts).toHaveBeenCalledWith(expect.objectContaining({ pattern: '[OX2H]' }));
});

test('a SMARTS pattern that matches nothing is reported', async () => {
  vi.spyOn(api.chem, 'smarts').mockResolvedValue({ matches: [], atoms: [] } as never);
  vi.spyOn(window, 'prompt').mockReturnValue('[Fe]');
  const onError = vi.fn();

  renderMenuBar(onError);
  fireEvent.click(screen.getByRole('button', { name: 'Select' }));
  fireEvent.click(screen.getByText('Select SMARTS…'));

  await waitFor(() => expect(onError).toHaveBeenCalledWith('No atom matches [Fe]'));
});

test('a selection can be named and recalled from the Select menu', () => {
  renderMenuBar();
  fireEvent.click(screen.getByRole('button', { name: 'Select' }));
  // nothing selected: there is nothing to name
  expect(screen.getByRole('menuitem', { name: 'Add named selection…' })).toBeDisabled();

  act(() => useSelectionStore.getState().set([1, 2]));
  vi.spyOn(window, 'prompt').mockReturnValue('hydrogens');
  fireEvent.click(screen.getByText('Add named selection…'));
  expect(useSelectionStore.getState().named.map((s) => s.name)).toEqual(['hydrogens']);

  // the set is listed in the menu and puts the selection back
  act(() => useSelectionStore.getState().clear());
  fireEvent.click(screen.getByRole('button', { name: 'Select' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'hydrogens' }));
  expect([...useSelectionStore.getState().atoms]).toEqual([1, 2]);
});

test('Fetch from PDB loads what the backend returns', async () => {
  const fetchStructure = vi
    .spyOn(api.io, 'fetch')
    .mockResolvedValue({ name: '1CRN', atoms: [makeAtom('N', [0, 0, 0])] } as never);
  vi.spyOn(window, 'prompt').mockReturnValue('1crn');

  renderMenuBar();
  fireEvent.click(screen.getByRole('button', { name: 'File' }));
  fireEvent.click(screen.getByText('Fetch from PDB…'));

  await waitFor(() => expect(useStructureStore.getState().doc.name).toBe('1CRN'));
  // what was typed goes as the query, not as a URL
  expect(fetchStructure).toHaveBeenCalledWith({ source: 'pdb', query: '1crn' });
});

test('an id the database does not have is reported, not swallowed', async () => {
  vi.spyOn(api.io, 'fetch').mockRejectedValue(new Error('9ZZZ: not in the database'));
  vi.spyOn(window, 'prompt').mockReturnValue('9ZZZ');
  const onError = vi.fn();

  renderMenuBar(onError);
  fireEvent.click(screen.getByRole('button', { name: 'File' }));
  fireEvent.click(screen.getByText('Fetch from PDB…'));

  await waitFor(() =>
    expect(onError).toHaveBeenCalledWith('Fetch failed: 9ZZZ: not in the database'),
  );
});

test('the File menu lists recent files, opens one and clears the list', async () => {
  const importPath = vi
    .spyOn(api.io, 'importPath')
    .mockResolvedValue({ name: 'water', atoms: [makeAtom('O', [0, 0, 0])] } as never);
  const recent = vi.spyOn(api.io, 'recent').mockResolvedValue([
    { path: '/tmp/water.xyz', name: 'water.xyz', exists: true },
    { path: '/tmp/gone.xyz', name: 'gone.xyz', exists: false },
  ]);
  const clearRecent = vi.spyOn(api.io, 'clearRecent').mockResolvedValue([]);

  renderMenuBar();
  await waitFor(() => expect(recent).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'File' }));

  // a file that has moved is listed and says so, but cannot be opened
  expect(screen.getByRole('menuitem', { name: 'gone.xyz (missing)' })).toBeDisabled();
  fireEvent.click(screen.getByRole('menuitem', { name: 'water.xyz' }));
  expect(importPath).toHaveBeenCalledWith({ path: '/tmp/water.xyz' });
  await waitFor(() => expect(useStructureStore.getState().doc.name).toBe('water'));

  fireEvent.click(screen.getByRole('button', { name: 'File' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Clear recent' }));
  await waitFor(() => expect(clearRecent).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'File' }));
  expect(screen.queryByRole('menuitem', { name: 'water.xyz' })).toBeNull();
  expect(screen.queryByRole('menuitem', { name: 'Clear recent' })).toBeNull();
});
