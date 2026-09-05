/**
 * Undoable structure store. Every mutation goes through `commit(label, next)`, which pushes the
 * previous document on the undo stack. Documents are treated as immutable values.
 */
import { create } from 'zustand';
import { emptyStructure, type StructureDoc } from '../model/structure';

export interface HistoryEntry {
  label: string;
  doc: StructureDoc;
}

export interface StructureState {
  doc: StructureDoc;
  /** Monotonic counter bumped on every change; cheap dependency for renderers. */
  revision: number;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  /** Replace the document without recording history (loading a file, switching structures). */
  load: (doc: StructureDoc) => void;
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
  undoStack: [],
  redoStack: [],
  load: (doc) => set((s) => ({ doc, revision: s.revision + 1, undoStack: [], redoStack: [] })),
  commit: (label, next) =>
    set((s) => ({
      doc: next,
      revision: s.revision + 1,
      undoStack: [...s.undoStack.slice(-(MAX_HISTORY - 1)), { label, doc: s.doc }],
      redoStack: [],
    })),
  undo: () =>
    set((s) => {
      const entry = s.undoStack[s.undoStack.length - 1];
      if (!entry) return s;
      return {
        doc: entry.doc,
        revision: s.revision + 1,
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, { label: entry.label, doc: s.doc }],
      };
    }),
  redo: () =>
    set((s) => {
      const entry = s.redoStack[s.redoStack.length - 1];
      if (!entry) return s;
      return {
        doc: entry.doc,
        revision: s.revision + 1,
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack, { label: entry.label, doc: s.doc }],
      };
    }),
  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,
  undoLabel: () => get().undoStack.at(-1)?.label ?? null,
  redoLabel: () => get().redoStack.at(-1)?.label ?? null,
}));
