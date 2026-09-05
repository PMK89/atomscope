/**
 * Cut, copy, paste and clear (Avogadro's Edit menu, Ctrl+X/C/V and Ctrl+Backspace).
 *
 * A fragment copied inside Atomscope is kept as a document fragment, not as text: it already has
 * its elements, positions, bond orders and charges, and a round trip through a chemical file
 * format would perceive bonds again, add hydrogens to the atoms on the cut boundary and reject
 * structures RDKit will not sanitize. XYZ text goes onto the system clipboard at the same time so
 * that other programs get something usable, and a paste of text that is not ours is read by the
 * backend, which is what makes pasting from another program work.
 *
 * The keyboard path uses the DOM clipboard events rather than `navigator.clipboard`: their
 * `clipboardData` is synchronous and needs no permission, while `readText()` is permission-gated.
 */
import { api } from '../api/client';
import { isEditableTarget } from '../editor/ToolHost';
import { mergeFragment, selectionFragment, toXyz } from '../editor/fragment';
import { removeAtoms } from '../editor/edits';
import { normalizeStructure, type StructureDoc } from '../model/structure';
import { useClipboardStore } from '../state/clipboardStore';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';

/** The atoms an Edit command acts on: the selection, or the whole document when nothing is selected. */
export function targetAtoms(doc: StructureDoc): number[] {
  const selected = [...useSelectionStore.getState().atoms].sort((a, b) => a - b);
  return selected.length ? selected : doc.atoms.map((_, i) => i);
}

/** Put the current selection on the clipboard; returns the text written, or null if empty. */
export function copySelection(): string | null {
  const doc = useStructureStore.getState().doc;
  const atoms = targetAtoms(doc);
  if (!atoms.length) return null;
  const fragment = selectionFragment(doc, atoms);
  const text = toXyz(fragment);
  useClipboardStore.getState().set(fragment, text);
  return text;
}

/** Copy, then remove what was copied, as one undoable step. */
export function cutSelection(): boolean {
  const store = useStructureStore.getState();
  const atoms = targetAtoms(store.doc);
  if (!copySelection()) return false;
  store.commit('Cut', removeAtoms(store.doc, atoms));
  useSelectionStore.getState().clear();
  return true;
}

/** Delete the selection without touching the clipboard (Avogadro's Clear). */
export function clearSelection(): boolean {
  const store = useStructureStore.getState();
  const atoms = targetAtoms(store.doc);
  if (!atoms.length) return false;
  store.commit('Clear', removeAtoms(store.doc, atoms));
  useSelectionStore.getState().clear();
  return true;
}

/**
 * Paste `text`. Text this app wrote is pasted from the stored fragment, which keeps the bond
 * orders that XYZ cannot carry; anything else is read by the backend. Empty text falls back to
 * the stored fragment, which is what happens when the system clipboard cannot be read.
 */
export async function pasteText(text: string, onError: (m: string) => void): Promise<boolean> {
  const clip = useClipboardStore.getState();
  let fragment: StructureDoc | null = null;
  if (!text.trim() || text === clip.text) {
    fragment = clip.fragment;
  } else {
    try {
      fragment = normalizeStructure(await api.io.importText({ text }));
    } catch (e) {
      onError(`Paste failed: ${(e as Error).message}`);
      return false;
    }
  }
  if (!fragment || !fragment.atoms.length) {
    onError('Nothing to paste');
    return false;
  }
  const store = useStructureStore.getState();
  // pasted in place, as Avogadro does, and left selected so it can be dragged off the original
  const { doc, added } = mergeFragment(store.doc, fragment);
  store.commit('Paste', doc);
  useSelectionStore.getState().set(added);
  return true;
}

/** Edit > Paste: the menu has no clipboard event, so ask for the text (and fall back to ours). */
export async function pasteFromClipboard(onError: (m: string) => void): Promise<boolean> {
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch {
    text = ''; // denied or unsupported: pasteText falls back to the fragment we stored
  }
  return pasteText(text, onError);
}

/** Edit > Copy / Cut: write the text with the async API, which a menu click is allowed to use. */
export async function copyToSystemClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // no permission: the fragment is still on the in-app clipboard, so Paste works
  }
}

/** Ctrl+X/C/V through the DOM clipboard events. Returns a cleanup function. */
export function installClipboardEvents(onError: (m: string) => void): () => void {
  const write = (e: ClipboardEvent, text: string): void => {
    e.preventDefault();
    e.clipboardData?.setData('text/plain', text);
  };
  // a user copying a number out of a panel must get that number, not the molecule
  const takesOver = (e: ClipboardEvent): boolean =>
    !isEditableTarget(e.target) && !window.getSelection()?.toString();
  const onCopy = (e: ClipboardEvent): void => {
    if (!takesOver(e)) return;
    const text = copySelection();
    if (text) write(e, text);
  };
  const onCut = (e: ClipboardEvent): void => {
    if (!takesOver(e)) return;
    const text = copySelection();
    if (!text) return;
    write(e, text);
    cutSelection();
  };
  const onPaste = (e: ClipboardEvent): void => {
    if (isEditableTarget(e.target)) return;
    e.preventDefault();
    void pasteText(e.clipboardData?.getData('text/plain') ?? '', onError);
  };
  window.addEventListener('copy', onCopy);
  window.addEventListener('cut', onCut);
  window.addEventListener('paste', onPaste);
  return () => {
    window.removeEventListener('copy', onCopy);
    window.removeEventListener('cut', onCut);
    window.removeEventListener('paste', onPaste);
  };
}
