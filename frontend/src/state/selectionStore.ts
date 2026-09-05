import { create } from 'zustand';
import { NO_NAMED_SELECTIONS, type NamedSelection } from '../editor/namedSelections';

export interface SelectionState {
  atoms: ReadonlySet<number>;
  bonds: ReadonlySet<number>;
  hoveredAtom: number | null;
  /**
   * Selections the user has named and can recall. Keyed by atom uid inside each entry, and held
   * with the session rather than the project, like the display types and the per-atom colours.
   */
  named: readonly NamedSelection[];
  set: (atoms: Iterable<number>, bonds?: Iterable<number>) => void;
  toggleAtom: (index: number) => void;
  clear: () => void;
  setHovered: (index: number | null) => void;
  setNamed: (named: readonly NamedSelection[]) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  atoms: new Set(),
  bonds: new Set(),
  hoveredAtom: null,
  named: NO_NAMED_SELECTIONS,
  set: (atoms, bonds = []) => set({ atoms: new Set(atoms), bonds: new Set(bonds) }),
  toggleAtom: (index) =>
    set((s) => {
      const next = new Set(s.atoms);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return { atoms: next };
    }),
  clear: () => set({ atoms: new Set(), bonds: new Set() }),
  setHovered: (index) => set({ hoveredAtom: index }),
  setNamed: (named) => set({ named }),
}));
