import { beforeEach, expect, test, vi } from 'vitest';
import { makeAtom, makeBond, normalizeStructure, type StructureDoc } from '../model/structure';
import { useClipboardStore } from '../state/clipboardStore';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import {
  clearSelection,
  copySelection,
  cutSelection,
  pasteText,
  targetAtoms,
} from './clipboardActions';

vi.mock('../api/client', () => ({
  api: {
    io: {
      importText: vi.fn(async ({ text }: { text: string }) => {
        if (!text.startsWith('2')) throw new Error('cannot tell what format this text is');
        return {
          name: 'pasted',
          atoms: [makeAtom('H', [0, 0, 0]), makeAtom('H', [0, 0, 0.74])],
          bonds: [makeBond(0, 1)],
        };
      }),
    },
  },
}));

const doc = (): StructureDoc =>
  normalizeStructure({
    name: 'acetone',
    atoms: [makeAtom('C', [0, 0, 0]), makeAtom('O', [1.2, 0, 0]), makeAtom('C', [-0.8, 1.3, 0])],
    bonds: [makeBond(0, 1, 2), makeBond(0, 2)],
  } as never);

const errors: string[] = [];
const onError = (m: string): void => void errors.push(m);

beforeEach(() => {
  errors.length = 0;
  useStructureStore.getState().load(doc());
  useSelectionStore.getState().clear();
  useClipboardStore.setState({ fragment: null, text: '' });
});

test('an empty selection means the whole molecule, as in Avogadro', () => {
  expect(targetAtoms(useStructureStore.getState().doc)).toEqual([0, 1, 2]);
  useSelectionStore.getState().set([2]);
  expect(targetAtoms(useStructureStore.getState().doc)).toEqual([2]);
});

test('copy writes XYZ text and keeps the fragment itself', () => {
  useSelectionStore.getState().set([0, 1]);
  const text = copySelection();
  expect(text?.startsWith('2\n')).toBe(true);

  const clip = useClipboardStore.getState();
  expect(clip.text).toBe(text);
  // the stored fragment carries the double bond that XYZ cannot express
  expect(clip.fragment?.bonds).toEqual([expect.objectContaining({ order: 2 })]);
});

test('cut removes what it copied in a single undo step', () => {
  useSelectionStore.getState().set([2]);
  expect(cutSelection()).toBe(true);

  const store = useStructureStore.getState();
  expect(store.doc.atoms).toHaveLength(2);
  expect(store.undoLabel()).toBe('Cut');
  store.undo();
  expect(useStructureStore.getState().doc.atoms).toHaveLength(3);
  expect(useSelectionStore.getState().atoms.size).toBe(0);
});

test('pasting our own copy restores the bond orders and selects the new atoms', async () => {
  useSelectionStore.getState().set([0, 1]);
  const text = copySelection()!;
  useSelectionStore.getState().clear();

  expect(await pasteText(text, onError)).toBe(true);
  const store = useStructureStore.getState();
  expect(store.doc.atoms).toHaveLength(5);
  expect(store.doc.bonds.at(-1)).toEqual(expect.objectContaining({ a: 3, b: 4, order: 2 }));
  expect([...useSelectionStore.getState().atoms].sort()).toEqual([3, 4]);
  expect(store.undoLabel()).toBe('Paste');
});

test('pasting text from another program goes through the backend reader', async () => {
  expect(await pasteText('2\n\nH 0 0 0\nH 0 0 0.74\n', onError)).toBe(true);
  expect(useStructureStore.getState().doc.atoms).toHaveLength(5);
});

test('an unreadable paste reports the backend error and changes nothing', async () => {
  expect(await pasteText('random words', onError)).toBe(false);
  expect(errors[0]).toMatch(/cannot tell what format/);
  expect(useStructureStore.getState().doc.atoms).toHaveLength(3);
});

test('an empty system clipboard falls back to the fragment we hold', async () => {
  useSelectionStore.getState().set([0]);
  copySelection();
  expect(await pasteText('', onError)).toBe(true);
  expect(useStructureStore.getState().doc.atoms).toHaveLength(4);

  useClipboardStore.setState({ fragment: null, text: '' });
  expect(await pasteText('', onError)).toBe(false);
  expect(errors.at(-1)).toBe('Nothing to paste');
});

test('clear deletes the selection without touching the clipboard', () => {
  useSelectionStore.getState().set([0, 1]);
  copySelection();
  const stored = useClipboardStore.getState().text;
  useSelectionStore.getState().set([2]);

  expect(clearSelection()).toBe(true);
  expect(useStructureStore.getState().doc.atoms).toHaveLength(2);
  expect(useStructureStore.getState().undoLabel()).toBe('Clear');
  expect(useClipboardStore.getState().text).toBe(stored);
});
