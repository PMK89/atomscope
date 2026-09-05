/**
 * Open Babel's atom types for the open document, fetched once per revision.
 *
 * A type is a function of the current graph -- change an element and "C3" is not stale but wrong --
 * so it is never stored on the structure the way a measured partial charge is. Same shape as
 * `bioStore`: keyed by document id and revision, and only fetched while something is showing it.
 */
import { create } from 'zustand';
import { api, type AtomTyping } from '../api/client';
import { toApiStructure } from '../api/structureBody';
import type { StructureDoc } from '../model/structure';

interface AtomTypeState {
  typing: AtomTyping | null;
  /** `${doc.id}:${revision}` of what `typing` describes, or of the request in flight. */
  key: string;
  error: string | null;
  load: (doc: StructureDoc, revision: number) => Promise<void>;
}

export const useAtomTypeStore = create<AtomTypeState>((set, get) => ({
  typing: null,
  key: '',
  error: null,
  load: async (doc, revision) => {
    const key = `${doc.id}:${revision}`;
    if (get().key === key) return;
    set({ key, typing: null, error: null });
    if (doc.atoms.length === 0) return; // the route refuses an empty structure, and rightly
    try {
      const typing = await api.chem.atomTypes({ structure: toApiStructure(doc) });
      // a later document may have arrived while this was in flight
      if (get().key === key) set({ typing, error: null });
    } catch (e) {
      if (get().key === key) set({ typing: null, error: (e as Error).message });
    }
  },
}));
