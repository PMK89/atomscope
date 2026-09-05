import { emptyStructure, makeAtom } from '../model/structure';
import { useStructureStore } from './structureStore';

beforeEach(() => useStructureStore.getState().load(emptyStructure('t')));

test('commit / undo / redo round trip', () => {
  const s = useStructureStore.getState();
  const withAtom = { ...s.doc, atoms: [makeAtom('H', [0, 0, 0])] };
  s.commit('add H', withAtom);
  expect(useStructureStore.getState().doc.atoms).toHaveLength(1);
  expect(useStructureStore.getState().undoLabel()).toBe('add H');
  useStructureStore.getState().undo();
  expect(useStructureStore.getState().doc.atoms).toHaveLength(0);
  expect(useStructureStore.getState().redoLabel()).toBe('add H');
  useStructureStore.getState().redo();
  expect(useStructureStore.getState().doc.atoms).toHaveLength(1);
  expect(useStructureStore.getState().canRedo()).toBe(false);
});

test('a new commit clears the redo stack and load clears history', () => {
  const s = useStructureStore.getState();
  s.commit('a', { ...s.doc, name: 'a' });
  useStructureStore.getState().undo();
  useStructureStore.getState().commit('b', { ...useStructureStore.getState().doc, name: 'b' });
  expect(useStructureStore.getState().canRedo()).toBe(false);
  expect(useStructureStore.getState().doc.name).toBe('b');
  useStructureStore.getState().load(emptyStructure('x'));
  expect(useStructureStore.getState().canUndo()).toBe(false);
});

test('undo on empty stack is a no-op', () => {
  const rev = useStructureStore.getState().revision;
  useStructureStore.getState().undo();
  expect(useStructureStore.getState().revision).toBe(rev);
});
