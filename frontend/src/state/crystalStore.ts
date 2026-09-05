import { create } from 'zustand';
import type { SymmetryInfo } from '../api/client';

export type CrystalDialog = 'supercell' | 'slab' | 'library';

export interface CrystalState {
  dialog: CrystalDialog | null;
  openDialog: (d: CrystalDialog) => void;
  closeDialog: () => void;
  /** Last perceived symmetry with the structure revision it belongs to. */
  symmetry: { info: SymmetryInfo; revision: number } | null;
  setSymmetry: (info: SymmetryInfo, revision: number) => void;
}

export const useCrystalStore = create<CrystalState>((set) => ({
  dialog: null,
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  symmetry: null,
  setSymmetry: (info, revision) => set({ symmetry: { info, revision } }),
}));
