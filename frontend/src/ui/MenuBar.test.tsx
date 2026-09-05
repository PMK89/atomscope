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
