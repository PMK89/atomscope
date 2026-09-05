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
}

export const useToolStore = create<ToolState>((set) => ({
  active: 'navigate',
  draw: { element: 'C', bondOrder: 1, adjustHydrogens: true },
  select: { mode: 'atoms', rect: null },
  bondCentric: { bond: null },
  measure: { atoms: [] },
  autoRotate: { running: false, x: 0, y: 20, z: 0 },
  overlayVersion: 0,
  cartesianEditorOpen: false,
  setActive: (active) => set({ active }),
  update: (key, patch) => set((s) => ({ [key]: { ...s[key], ...patch } }) as Partial<ToolState>),
  bumpOverlay: () => set((s) => ({ overlayVersion: s.overlayVersion + 1 })),
  setCartesianEditorOpen: (cartesianEditorOpen) => set({ cartesianEditorOpen }),
}));
