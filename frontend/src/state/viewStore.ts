import { create } from 'zustand';
import type { StructureStyle } from '../renderer/layers/StructureLayer';
import type { Projection } from '../renderer/Renderer';

export interface ViewState {
  style: StructureStyle;
  projection: Projection;
  showHydrogens: boolean;
  background: 'white' | 'black' | 'gray';
  setStyle: (s: StructureStyle) => void;
  setProjection: (p: Projection) => void;
  toggleHydrogens: () => void;
  setBackground: (b: ViewState['background']) => void;
  /** Incremented to request "fit to structure" from whoever owns the renderer. */
  fitRequest: number;
  requestFit: () => void;
}

export const useViewStore = create<ViewState>((set) => ({
  style: 'ball-and-stick',
  projection: 'perspective',
  showHydrogens: true,
  background: 'white',
  fitRequest: 0,
  setStyle: (style) => set({ style }),
  setProjection: (projection) => set({ projection }),
  toggleHydrogens: () => set((s) => ({ showHydrogens: !s.showHydrogens })),
  setBackground: (background) => set({ background }),
  requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
}));

export const BACKGROUND_HEX: Record<ViewState['background'], number> = {
  white: 0xffffff,
  black: 0x000000,
  gray: 0x3a3d42,
};
