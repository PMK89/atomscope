/**
 * A paste that cannot finish until the user says what it holds.
 *
 * A VASP 4 POSCAR names how many atoms of each species it has but not which elements they are --
 * VASP kept those in the POTCAR beside the file, and a clipboard paste has no file. The backend
 * answers 422 with the counts; the text waits here while the dialog asks.
 */
import { create } from 'zustand';

export interface PendingPaste {
  text: string;
  /** how many atoms each species has, in the order the file lists them */
  counts: number[];
}

interface PasteState {
  pending: PendingPaste | null;
  ask: (pending: PendingPaste) => void;
  cancel: () => void;
}

export const usePasteStore = create<PasteState>((set) => ({
  pending: null,
  ask: (pending) => set({ pending }),
  cancel: () => set({ pending: null }),
}));

/** The counts of a 422 from `import/text`, or null when it was some other 422. */
export function speciesCounts(detail: unknown): number[] | null {
  if (!detail || typeof detail !== 'object') return null;
  const counts = (detail as { counts?: unknown }).counts;
  if (!Array.isArray(counts) || counts.length === 0) return null;
  return counts.every((c) => typeof c === 'number') ? (counts as number[]) : null;
}
