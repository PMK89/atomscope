import { create } from 'zustand';
import type { StructureStyle } from '../renderer/layers/StructureLayer';
import type { Projection } from '../renderer/Renderer';
import type { AtomLabelContent, BondLabelContent } from '../renderer/labels';

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
  /** Extra display layers (vectors, unit cell, axes). */
  showVectors: boolean;
  vectorField: string;
  vectorScale: number;
  showUnitCell: boolean;
  cellRepeat: [number, number, number];
  showAxes: boolean;
  /** Label engine: what atoms and bonds are labelled with. */
  showLabels: boolean;
  atomLabels: AtomLabelContent;
  bondLabels: BondLabelContent;
  labelColor: string;
  labelSize: number;
  labelShift: [number, number, number];
  toggleLabels: () => void;
  setAtomLabels: (content: AtomLabelContent) => void;
  setBondLabels: (content: BondLabelContent) => void;
  setLabelStyle: (patch: {
    color?: string;
    size?: number;
    shift?: [number, number, number];
  }) => void;
  /** Structure engine settings that the Display panel exposes. */
  atomScale: number;
  bondRadius: number;
  /** Style for the selected atoms, or null to draw them like the rest. */
  selectionStyle: StructureStyle | null;
  setAtomScale: (scale: number) => void;
  setBondRadius: (radius: number) => void;
  setSelectionStyle: (style: StructureStyle | null) => void;
  toggleVectors: () => void;
  setVectorField: (field: string) => void;
  setVectorScale: (scale: number) => void;
  toggleUnitCell: () => void;
  setCellRepeat: (repeat: [number, number, number]) => void;
  toggleAxes: () => void;
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
  showLabels: false,
  atomLabels: 'symbol_index',
  bondLabels: 'none',
  labelColor: '#222222',
  labelSize: 0.55,
  labelShift: [0, 0, 0],
  setLabelStyle: ({ color, size, shift }) =>
    set((s) => ({
      labelColor: color ?? s.labelColor,
      labelSize: size ?? s.labelSize,
      labelShift: shift ?? s.labelShift,
    })),
  atomScale: 0.35,
  bondRadius: 0.12,
  selectionStyle: null,
  setAtomScale: (atomScale) => set({ atomScale }),
  setBondRadius: (bondRadius) => set({ bondRadius }),
  setSelectionStyle: (selectionStyle) => set({ selectionStyle }),
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),
  setAtomLabels: (atomLabels) => set({ atomLabels, showLabels: true }),
  setBondLabels: (bondLabels) => set({ bondLabels, showLabels: true }),
  showVectors: false,
  vectorField: 'forces',
  vectorScale: 1,
  showUnitCell: true,
  cellRepeat: [1, 1, 1],
  showAxes: true,
  toggleVectors: () => set((s) => ({ showVectors: !s.showVectors })),
  setVectorField: (vectorField) => set({ vectorField }),
  setVectorScale: (vectorScale) => set({ vectorScale }),
  toggleUnitCell: () => set((s) => ({ showUnitCell: !s.showUnitCell })),
  setCellRepeat: (cellRepeat) => set({ cellRepeat }),
  toggleAxes: () => set((s) => ({ showAxes: !s.showAxes })),
}));

export const BACKGROUND_HEX: Record<ViewState['background'], number> = {
  white: 0xffffff,
  black: 0x000000,
  gray: 0x3a3d42,
};
