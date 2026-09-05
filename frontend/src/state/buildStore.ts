import { create } from 'zustand';

/** Which Build > Insert dialog is open, if any. */
export type BuildDialog = 'fragment' | 'peptide' | 'nucleic' | 'nanotube';

export interface BuildState {
  dialog: BuildDialog | null;
  openDialog: (d: BuildDialog) => void;
  closeDialog: () => void;
}

export const useBuildStore = create<BuildState>((set) => ({
  dialog: null,
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
}));
