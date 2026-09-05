import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { makeAtom, normalizeStructure } from '../model/structure';
import { useStructureStore } from '../state/structureStore';
import { MenuBar } from './MenuBar';

function water() {
  return normalizeStructure({
    name: 'water',
    charge: 0,
    atoms: [makeAtom('O', [0, 0, 0]), makeAtom('H', [0, 0.8, 0.5]), makeAtom('H', [0, -0.8, 0.5])],
  });
}

beforeEach(() => {
  const st = useStructureStore.getState();
  st.load(water());
  st.commit('rename', { ...useStructureStore.getState().doc, name: 'renamed' });
});

test('Ctrl+Z outside a text field undoes the document edit', () => {
  render(<MenuBar onError={() => {}} />);
  fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
  expect(useStructureStore.getState().doc.name).toBe('water');
});

test('Ctrl+Z / Ctrl+Y / Ctrl+A inside a text field are left to the browser', () => {
  render(
    <>
      <MenuBar onError={() => {}} />
      <input aria-label="a field" defaultValue="text" />
    </>,
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
  render(<MenuBar onError={() => {}} />);
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
});

test('menus support arrow-key navigation, skip disabled items and close on Escape', () => {
  render(<MenuBar onError={() => {}} />);
  const edit = screen.getByRole('button', { name: 'Edit' });
  const label = (): string => (document.activeElement as HTMLElement).textContent ?? '';
  fireEvent.keyDown(edit, { key: 'ArrowDown' });
  // beforeEach committed one edit, so Undo is available but Redo is not
  expect(label()).toContain('Undo rename');
  const menu = screen.getByRole('menu');
  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  expect(label()).toContain('Select all'); // the disabled Redo entry was skipped
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
