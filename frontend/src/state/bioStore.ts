/**
 * The secondary structure of the open document, fetched from the backend once per revision.
 *
 * The assignment depends on the geometry -- an optimization changes the hydrogen bonds -- so it is
 * keyed by document id and revision and refetched when either changes, but only while something
 * is drawing it.
 */
import { create } from 'zustand';
import { api } from '../api/client';
import { toApiStructure } from '../api/structureBody';
import type { SecondaryStructureData } from '../renderer/layers/RibbonLayer';
import type { StructureDoc } from '../model/structure';

interface BioState {
  data: SecondaryStructureData | null;
  /** `${doc.id}:${revision}` of what `data` describes, or of the request in flight. */
  key: string;
  error: string | null;
  load: (doc: StructureDoc, revision: number) => Promise<void>;
}

export const useBioStore = create<BioState>((set, get) => ({
  data: null,
  key: '',
  error: null,
  load: async (doc, revision) => {
    const key = `${doc.id}:${revision}`;
    // claim the key before awaiting: several layers asking at once must not fetch twice
    if (get().key === key) return;
    set({ key });
    try {
      const result = await api.chem.secondaryStructure({ structure: toApiStructure(doc) });
      set({
        data: {
          residues: result.residues.map((r) => ({
            residue: r.residue,
            kind: r.kind,
            ca: r.ca,
            o: r.o,
            n: r.n,
          })),
          chains: result.chains,
        },
        error: null,
      });
    } catch (e) {
      set({ data: null, error: (e as Error).message });
    }
  },
}));
