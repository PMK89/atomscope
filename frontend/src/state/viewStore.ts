import { create } from 'zustand';
import {
  NO_ATOM_COLORS,
  type AtomColorAssignment,
  type ColorScheme,
  type ResiduePalette,
} from '../renderer/atomColors';
import { NO_STYLES, type StyleAssignment } from '../renderer/atomStyles';
import type { Quality, StructureStyle } from '../renderer/layers/StructureLayer';
import type { Projection } from '../renderer/Renderer';
import type { AtomLabelContent, BondLabelContent } from '../renderer/labels';
import type { RibbonStyle } from '../model/ribbon';
import type { RibbonColorScheme } from '../renderer/layers/RibbonLayer';
import { DEFAULT_HBOND_SETTINGS } from '../model/hbonds';

export interface ViewState {
  style: StructureStyle;
  /** What decides an atom's colour: its element, or what it is part of. */
  colorScheme: ColorScheme;
  setColorScheme: (scheme: ColorScheme) => void;
  /** Which residue table the `residue` scheme paints with (Avogadro's Residue Color settings). */
  residuePalette: ResiduePalette;
  setResiduePalette: (palette: ResiduePalette) => void;
  /** The single colour of the `custom` colour scheme, as `#rrggbb`. */
  customColor: string;
  setCustomColor: (hex: string) => void;
  projection: Projection;
  showHydrogens: boolean;
  background: 'white' | 'black' | 'gray';
  /**
   * An arbitrary background, as `#rrggbb`, which wins over the preset above (Avogadro's
   * View ▸ Set Background Color…). Empty means "use the preset", and choosing a preset empties
   * it again, so there is one answer to what the background is.
   */
  backgroundColor: string;
  /** Renderer quality and depth cueing (Settings > Preferences). */
  quality: Quality;
  fog: boolean;
  setQuality: (q: ViewState['quality']) => void;
  setFog: (on: boolean) => void;
  setStyle: (s: StructureStyle) => void;
  setProjection: (p: Projection) => void;
  toggleHydrogens: () => void;
  setBackground: (b: ViewState['background']) => void;
  setBackgroundColor: (hex: string) => void;
  /** Incremented to request "fit to structure" from whoever owns the renderer. */
  fitRequest: number;
  requestFit: () => void;
  /** The same for "centre on the structure", which does not touch zoom or orientation. */
  centerRequest: number;
  requestCenter: () => void;
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
  /** Protein ribbons: off by default, since only a protein has them. */
  showRibbon: boolean;
  ribbonStyle: RibbonStyle;
  ribbonScale: number;
  /** The ribbon engine's own colour map (Avogadro gives every engine one). */
  ribbonColorScheme: RibbonColorScheme;
  setRibbonColorScheme: (scheme: RibbonColorScheme) => void;
  toggleRibbon: () => void;
  setRibbonStyle: (style: RibbonStyle) => void;
  setRibbonScale: (scale: number) => void;
  /** Hydrogen bonds, drawn from the displayed geometry. */
  showHBonds: boolean;
  hbondDistance: number;
  hbondAngle: number;
  toggleHBonds: () => void;
  setHBondCutoffs: (patch: { distance?: number; angle?: number }) => void;
  /** Structure engine settings that the Display panel exposes. */
  atomScale: number;
  bondRadius: number;
  /** Draw double and triple bonds as two or three sticks. */
  multipleBonds: boolean;
  toggleMultipleBonds: () => void;
  /** Style for the selected atoms, or null to draw them like the rest. */
  selectionStyle: StructureStyle | null;
  /**
   * Per-atom display types (engine primitive scoping), keyed by atom uid. Not persisted with the
   * project: it belongs to one document, and `pickPersisted` stores scalars only.
   */
  atomStyles: StyleAssignment;
  setAtomStyles: (styles: StyleAssignment) => void;
  /**
   * Per-atom colours, keyed by atom uid, painted over whatever colour scheme is chosen. Not
   * persisted with the project, for the same reason as `atomStyles`.
   */
  atomColorOverrides: AtomColorAssignment;
  setAtomColorOverrides: (colors: AtomColorAssignment) => void;
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
  colorScheme: 'element',
  setColorScheme: (colorScheme) => set({ colorScheme }),
  residuePalette: 'amino',
  setResiduePalette: (residuePalette) => set({ residuePalette }),
  customColor: '#4aa3ff',
  setCustomColor: (customColor) => set({ customColor }),
  quality: 'auto',
  fog: false,
  setQuality: (quality) => set({ quality }),
  setFog: (fog) => set({ fog }),
  projection: 'perspective',
  showHydrogens: true,
  background: 'white',
  backgroundColor: '',
  fitRequest: 0,
  centerRequest: 0,
  setStyle: (style) => set({ style }),
  setProjection: (projection) => set({ projection }),
  toggleHydrogens: () => set((s) => ({ showHydrogens: !s.showHydrogens })),
  setBackground: (background) => set({ background, backgroundColor: '' }),
  setBackgroundColor: (backgroundColor) => set({ backgroundColor }),
  requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
  requestCenter: () => set((s) => ({ centerRequest: s.centerRequest + 1 })),
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
  showHBonds: false,
  hbondDistance: DEFAULT_HBOND_SETTINGS.maxDistance,
  hbondAngle: DEFAULT_HBOND_SETTINGS.minAngle,
  toggleHBonds: () => set((s) => ({ showHBonds: !s.showHBonds })),
  setHBondCutoffs: ({ distance, angle }) =>
    set((s) => ({
      hbondDistance: distance ?? s.hbondDistance,
      hbondAngle: angle ?? s.hbondAngle,
    })),
  showRibbon: false,
  ribbonStyle: 'cartoon',
  ribbonScale: 1,
  ribbonColorScheme: 'secondary',
  setRibbonColorScheme: (ribbonColorScheme) => set({ ribbonColorScheme }),
  toggleRibbon: () => set((s) => ({ showRibbon: !s.showRibbon })),
  setRibbonStyle: (ribbonStyle) => set({ ribbonStyle }),
  setRibbonScale: (ribbonScale) => set({ ribbonScale }),
  atomScale: 0.35,
  bondRadius: 0.12,
  multipleBonds: true,
  toggleMultipleBonds: () => set((s) => ({ multipleBonds: !s.multipleBonds })),
  selectionStyle: null,
  atomStyles: NO_STYLES,
  setAtomStyles: (atomStyles) => set({ atomStyles }),
  atomColorOverrides: NO_ATOM_COLORS,
  setAtomColorOverrides: (atomColorOverrides) => set({ atomColorOverrides }),
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
  // the repeat multiplies every atom, so it is bounded here as well as in the input
  setCellRepeat: ([a, b, c]) =>
    set({
      cellRepeat: [
        Math.min(10, Math.max(1, Math.round(a))),
        Math.min(10, Math.max(1, Math.round(b))),
        Math.min(10, Math.max(1, Math.round(c))),
      ],
    }),
  toggleAxes: () => set((s) => ({ showAxes: !s.showAxes })),
}));

export const BACKGROUND_HEX: Record<ViewState['background'], number> = {
  white: 0xffffff,
  black: 0x000000,
  gray: 0x3a3d42,
};

/** The background actually drawn: the chosen colour if there is one, else the preset. */
export function backgroundHex(state: Pick<ViewState, 'background' | 'backgroundColor'>): number {
  const custom = /^#[0-9a-fA-F]{6}$/.test(state.backgroundColor)
    ? Number.parseInt(state.backgroundColor.slice(1), 16)
    : null;
  return custom ?? BACKGROUND_HEX[state.background];
}
