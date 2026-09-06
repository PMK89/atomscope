import { create } from 'zustand';
import type { SpacegroupSetting, SymmetryInfo } from '../api/client';

export type CrystalDialog = 'supercell' | 'slab' | 'library' | 'spacegroup';

export interface CrystalState {
  dialog: CrystalDialog | null;
  openDialog: (d: CrystalDialog) => void;
  closeDialog: () => void;
  /** Last perceived symmetry with the structure revision it belongs to. */
  symmetry: { info: SymmetryInfo; revision: number } | null;
  setSymmetry: (info: SymmetryInfo, revision: number) => void;
  /**
   * The setting chosen in Set space group…, which Fill then honours exactly. Asserted, not
   * perceived, and deliberately not stored on the document: the group of a filled cell is a
   * function of its atoms, and a second copy beside it would be a second truth to reconcile
   * after every operation that moves them.
   *
   * It is kept with the document it was chosen for, the way `symmetry` is kept with the
   * revision it was perceived at. An operation on the same crystal keeps its id, so the choice
   * survives Fill, Niggli and a supercell; opening another structure drops it, rather than
   * quietly filling the new one by the old one's group.
   */
  setting: { setting: SpacegroupSetting; docId: string } | null;
  setSetting: (setting: SpacegroupSetting | null, docId: string) => void;
}

export const useCrystalStore = create<CrystalState>((set) => ({
  dialog: null,
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  symmetry: null,
  setSymmetry: (info, revision) => set({ symmetry: { info, revision } }),
  setting: null,
  setSetting: (setting, docId) => set({ setting: setting ? { setting, docId } : null }),
}));
