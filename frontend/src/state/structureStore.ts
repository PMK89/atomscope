/**
 * Undoable structure store. Every mutation goes through `commit(label, next)`, which pushes the
 * previous document on the undo stack. Documents are treated as immutable values.
 */
import { create } from 'zustand';
import { emptyStructure, type StructureDoc } from '../model/structure';
import { NO_NAMED_SELECTIONS } from '../editor/namedSelections';
import { useSelectionStore } from './selectionStore';

export interface HistoryEntry {
  label: string;
  doc: StructureDoc;
}

export interface StructureState {
  doc: StructureDoc;
  /** Monotonic counter bumped on every change; cheap dependency for renderers. */
  revision: number;
  /** Bumped by undo/redo only, so an active gesture can notice that its base is gone. */
  historyRevision: number;
  /**
   * The document as it is stored. Documents are immutable values, so identity answers "is there
   * unsaved work?" -- and undoing back to the saved document clears the marker, because the
   * history entry holds that very object.
   */
  savedDoc: StructureDoc | null;
  /** Record that the current document is what is stored. */
  markSaved: () => void;
  isModified: () => boolean;
  /**
   * Take on a new id and name (Save as): the document did not change, only where it is stored,
   * so the history is kept -- with the new identity written through it, or undoing past the save
   * would quietly put the old id back and the next save would overwrite the original.
   */
  adoptIdentity: (identity: { id: string; name: string }) => void;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  /** Document before the current preview sequence, or null when not previewing. */
  previewBase: StructureDoc | null;
  /** Replace the document without recording history (loading a file, switching structures). */
  load: (doc: StructureDoc) => void;
  /**
   * Show `next` without recording history (live drag feedback). The document before the first
   * preview is remembered and becomes the undo entry of the following `commit`.
   */
  preview: (next: StructureDoc) => void;
  /** Drop a pending preview and restore the document it started from. */
  cancelPreview: () => void;
  /** Record `label` and switch to `next`. */
  commit: (label: string, next: StructureDoc) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  undoLabel: () => string | null;
  redoLabel: () => string | null;
}

const MAX_HISTORY = 200;

export const useStructureStore = create<StructureState>((set, get) => ({
  doc: emptyStructure(),
  revision: 0,
  historyRevision: 0,
  savedDoc: null,
  undoStack: [],
  redoStack: [],
  previewBase: null,
  load: (doc) => {
    // a different document: a selection of indices and a set of uids both point at atoms that
    // are not there any more, and a named set would sit in the Select menu reading "0 of 2"
    useSelectionStore.getState().clear();
    useSelectionStore.getState().setNamed(NO_NAMED_SELECTIONS);
    set((s) => ({
      doc,
      revision: s.revision + 1,
      // what was just loaded is what is stored, so it starts unmodified
      savedDoc: doc,
      undoStack: [],
      redoStack: [],
      previewBase: null,
    }));
  },
  markSaved: () => set((s) => ({ savedDoc: s.doc })),
  isModified: () => get().doc !== get().savedDoc,
  adoptIdentity: ({ id, name }) =>
    set((s) => {
      const rename = (d: StructureDoc): StructureDoc => ({ ...d, id, name });
      const doc = rename(s.doc);
      return {
        doc,
        revision: s.revision + 1,
        savedDoc: doc,
        undoStack: s.undoStack.map((e) => ({ ...e, doc: rename(e.doc) })),
        redoStack: s.redoStack.map((e) => ({ ...e, doc: rename(e.doc) })),
        previewBase: null,
      };
    }),
  preview: (next) =>
    set((s) => ({ doc: next, revision: s.revision + 1, previewBase: s.previewBase ?? s.doc })),
  cancelPreview: () =>
    set((s) =>
      s.previewBase ? { doc: s.previewBase, revision: s.revision + 1, previewBase: null } : s,
    ),
  commit: (label, next) =>
    set((s) => ({
      doc: next,
      revision: s.revision + 1,
      undoStack: [...s.undoStack.slice(-(MAX_HISTORY - 1)), { label, doc: s.previewBase ?? s.doc }],
      redoStack: [],
      previewBase: null,
    })),
  // undo/redo discard a running preview: the counterpart entry records the document the preview
  // started from, never the half-finished drag state.
  undo: () =>
    set((s) => {
      const entry = s.undoStack[s.undoStack.length - 1];
      if (!entry) return s;
      return {
        doc: entry.doc,
        revision: s.revision + 1,
        historyRevision: s.historyRevision + 1,
        previewBase: null,
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, { label: entry.label, doc: s.previewBase ?? s.doc }],
      };
    }),
  redo: () =>
    set((s) => {
      const entry = s.redoStack[s.redoStack.length - 1];
      if (!entry) return s;
      return {
        doc: entry.doc,
        revision: s.revision + 1,
        historyRevision: s.historyRevision + 1,
        previewBase: null,
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack, { label: entry.label, doc: s.previewBase ?? s.doc }],
      };
    }),
  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,
  undoLabel: () => get().undoStack.at(-1)?.label ?? null,
  redoLabel: () => get().redoStack.at(-1)?.label ?? null,
}));
