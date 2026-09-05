/**
 * Undo and redo go through here rather than straight to the store, because a tool that is
 * mid-run has state the store cannot see.
 *
 * `structureStore.undo` treats a preview as something to discard: it reverts to the entry below
 * and records the pre-preview document for redo. That is right for a 200 ms drag and wrong for a
 * run of the optimizer, which would take the previous edit with it and leave nothing to redo. So
 * the run is stopped first, which commits it, and the undo then reverts exactly that run.
 */
import { useToolStore } from '../editor/toolStore';
import { useStructureStore } from '../state/structureStore';

/** Bring running tools to a resting state so their work is on the undo stack. */
export function settleTools(): void {
  const tools = useToolStore.getState();
  // zustand notifies synchronously, so the tool commits before we return
  if (tools.autoOptimize.running) tools.update('autoOptimize', { running: false });
}

export function undoEdit(): void {
  settleTools();
  useStructureStore.getState().undo();
}

export function redoEdit(): void {
  settleTools();
  useStructureStore.getState().redo();
}
