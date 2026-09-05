/** Active tool and per-tool settings / transient state shared between tools and UI panels. */
import { create } from 'zustand';
import type { Bond } from '../model/structure';
import type { Rect, SelectionMode } from './selectionMath';
import type { ToolId } from './Tool';

export interface ToolSettings {
  draw: { element: string; bondOrder: Bond['order']; adjustHydrogens: boolean };
  select: { mode: SelectionMode; rect: Rect | null };
  bondCentric: { bond: number | null };
  measure: { atoms: number[] };
  autoRotate: { running: boolean; x: number; y: number; z: number };
  autoOptimize: {
    running: boolean;
    forceField: string;
    algorithm: 'steepest_descent' | 'conjugate_gradients';
    steps: number;
    /** energy of the last round, so the panel can show the run doing something */
    energy: number | null;
    energyUnit: string;
    /** why the run stopped, for the status bar */
    message: string | null;
  };
}

export interface ToolState extends ToolSettings {
  active: ToolId;
  setActive: (id: ToolId) => void;
  update: <K extends keyof ToolSettings>(key: K, patch: Partial<ToolSettings[K]>) => void;
  /** Bumped by tools when their overlay should be redrawn without a store field changing. */
  overlayVersion: number;
  bumpOverlay: () => void;
  cartesianEditorOpen: boolean;
  setCartesianEditorOpen: (open: boolean) => void;
  constraintsDialogOpen: boolean;
  setConstraintsDialogOpen: (open: boolean) => void;
  settingsDialogOpen: boolean;
  setSettingsDialogOpen: (open: boolean) => void;
}

export const useToolStore = create<ToolState>((set) => ({
  active: 'navigate',
  draw: { element: 'C', bondOrder: 1, adjustHydrogens: true },
  select: { mode: 'atoms', rect: null },
  bondCentric: { bond: null },
  measure: { atoms: [] },
  autoRotate: { running: false, x: 0, y: 20, z: 0 },
  autoOptimize: {
    running: false,
    forceField: 'MMFF94',
    algorithm: 'steepest_descent',
    steps: 4,
    energy: null,
    energyUnit: 'eV',
    message: null,
  },
  overlayVersion: 0,
  cartesianEditorOpen: false,
  constraintsDialogOpen: false,
  settingsDialogOpen: false,
  setActive: (active) => set({ active }),
  update: (key, patch) => set((s) => ({ [key]: { ...s[key], ...patch } }) as Partial<ToolState>),
  bumpOverlay: () => set((s) => ({ overlayVersion: s.overlayVersion + 1 })),
  setCartesianEditorOpen: (cartesianEditorOpen) => set({ cartesianEditorOpen }),
  setConstraintsDialogOpen: (constraintsDialogOpen) => set({ constraintsDialogOpen }),
  setSettingsDialogOpen: (settingsDialogOpen) => set({ settingsDialogOpen }),
}));
