import { beforeEach, expect, test, vi } from 'vitest';
import { makeAtom, makeBond, normalizeStructure, type StructureDoc } from '../model/structure';
import { useClipboardStore } from '../state/clipboardStore';
import { useSelectionStore } from '../state/selectionStore';
import { usePasteStore } from '../state/pasteStore';
import { useStructureStore } from '../state/structureStore';
import {
  clearSelection,
  copySelection,
  cutSelection,
  installClipboardEvents,
  pasteText,
  pasteWithSpecies,
  targetAtoms,
} from './clipboardActions';

vi.mock('../api/client', () => {
  // the module is mocked whole, so the error class the paste path checks with lives here too
  class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
      readonly detail: unknown = null,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    api: {
      io: {
        importText: vi.fn(async ({ text, species }: { text: string; species?: string[] }) => {
          // a POSCAR that does not name its elements: the backend answers 422 with the counts
          if (text.startsWith('POSCAR') && !species)
            throw new ApiError(422, 'does not name its elements', { counts: [2] });
          if (text.startsWith('POSCAR'))
            return {
              name: 'pasted',
              atoms: [makeAtom(species![0]!, [0, 0, 0]), makeAtom(species![0]!, [1.4, 1.4, 1.4])],
              bonds: [],
            };
          if (!text.startsWith('2')) throw new Error('cannot tell what format this text is');
          return {
            name: 'pasted',
            atoms: [makeAtom('H', [0, 0, 0]), makeAtom('H', [0, 0, 0.74])],
            bonds: [makeBond(0, 1)],
          };
        }),
      },
    },
  };
});

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
  usePasteStore.getState().cancel();
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

test('copying selected text in a panel is left alone', () => {
  const cleanup = installClipboardEvents(onError);
  useSelectionStore.getState().set([0]);
  vi.spyOn(window, 'getSelection').mockReturnValue({
    toString: () => '-76.4 eV',
  } as unknown as Selection);

  const event = new Event('copy') as ClipboardEvent;
  const prevented = vi.spyOn(event, 'preventDefault');
  window.dispatchEvent(event);

  expect(prevented).not.toHaveBeenCalled();
  expect(useClipboardStore.getState().text).toBe('');
  vi.mocked(window.getSelection).mockRestore();
  cleanup();
});

test('with nothing selected in the page the molecule is copied', () => {
  const cleanup = installClipboardEvents(onError);
  useSelectionStore.getState().set([0]);
  const setData = vi.fn();
  const event = new Event('copy') as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', { value: { setData } });
  window.dispatchEvent(event);

  expect(setData).toHaveBeenCalledWith('text/plain', expect.stringContaining('C '));
  cleanup();
});

test('a crystal that does not name its elements asks instead of failing', async () => {
  const before = useStructureStore.getState().doc.atoms.length;
  expect(await pasteText('POSCAR without species', onError)).toBe(false);
  // not an error: a question, with the counts the dialog needs
  expect(errors).toEqual([]);
  expect(usePasteStore.getState().pending).toEqual({
    text: 'POSCAR without species',
    counts: [2],
  });
  expect(useStructureStore.getState().doc.atoms).toHaveLength(before);

  expect(await pasteWithSpecies('POSCAR without species', ['Ge'], onError)).toBe(true);
  const doc = useStructureStore.getState().doc;
  expect(doc.atoms).toHaveLength(before + 2);
  expect(doc.atoms.slice(before).map((a) => a.element)).toEqual(['Ge', 'Ge']);
  expect(useStructureStore.getState().undoStack.at(-1)?.label).toBe('Paste');
});

test('a paste that fails for any other reason is still an error', async () => {
  expect(await pasteText('this is not a structure', onError)).toBe(false);
  expect(errors[0]).toMatch(/cannot tell what format/);
  expect(usePasteStore.getState().pending).toBeNull();
});
