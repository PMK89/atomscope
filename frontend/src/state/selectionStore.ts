import { create } from 'zustand';

export interface SelectionState {
  atoms: ReadonlySet<number>;
  bonds: ReadonlySet<number>;
  hoveredAtom: number | null;
  set: (atoms: Iterable<number>, bonds?: Iterable<number>) => void;
  toggleAtom: (index: number) => void;
  clear: () => void;
  setHovered: (index: number | null) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  atoms: new Set(),
  bonds: new Set(),
  hoveredAtom: null,
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
}));
