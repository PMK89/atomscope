/**
 * Asking before the open document is thrown away.
 *
 * Avogadro asked this in `maybeSave()` when a window closed (mainwindow.cpp:1332,1378,1403) and
 * nowhere else, because opening a file there made a *new window* -- the open document was never in
 * the way. Atomscope has one document, so opening, fetching, building or starting a new one is
 * exactly the moment Avogadro's prompt existed for, and `structureStore.load` clears the undo
 * stack, which makes an accidental drop or menu click unrecoverable.
 *
 * Two answers rather than Avogadro's three: the browser's confirm has no Save button, so the
 * message says where saving is instead.
 */
import { useStructureStore } from '../state/structureStore';

export function confirmReplace(): boolean {
  const state = useStructureStore.getState();
  if (!state.isModified()) return true;
  return window.confirm(
    `${state.doc.name} has unsaved changes, and they cannot be undone once it is replaced.\n\n` +
      'OK discards them. Cancel to go back and save with Ctrl+S first.',
  );
}
