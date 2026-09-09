import { create } from 'zustand';
import {
  NO_ATOM_COLORS,
  type AtomColorAssignment,
  type ResiduePalette,
} from '../renderer/atomColors';
import { NO_STYLES, type StyleAssignment } from '../renderer/atomStyles';
import {
  DEFAULT_STRUCTURE_SETTINGS,
  type Quality,
  type RadiusBasis,
  type StructureStyle,
} from '../renderer/layers/StructureLayer';
import type { FogLevel, Projection } from '../renderer/Renderer';
import { LENGTH_PRECISION, type AtomLabelContent, type BondLabelContent } from '../renderer/labels';
import { AVOGADRO_CARTOON_COLORS, type CartoonColors, type RibbonStyle } from '../model/ribbon';
import type { RibbonColorScheme } from '../renderer/layers/RibbonLayer';
import { DEFAULT_HBOND_SETTINGS } from '../model/hbonds';

export interface ViewState {
  style: StructureStyle;
  /** What decides an atom's colour: its element, or what it is part of. */
  /** A registered colour scheme's id (plugins/registry.ts), not one of a fixed set. */
  colorScheme: string;
  setColorScheme: (scheme: string) => void;
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
  /** Depth cueing, in Avogadro's four named levels. */
  fog: FogLevel;
  setQuality: (q: ViewState['quality']) => void;
  setFog: (level: FogLevel) => void;
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
  /** The dipole implied by the partial charges, drawn as one arrow (Avogadro's dipole engine). */
  showDipole: boolean;
  /** Å per Debye */
  dipoleScale: number;
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
  /** Displacement of the bond labels, which Avogadro keeps separate from the atom labels'. */
  bondLabelShift: [number, number, number];
  /** Decimals on a bond-length label (Avogadro's `lengthPrecision`). */
  labelPrecision: number;
  toggleLabels: () => void;
  setAtomLabels: (content: AtomLabelContent) => void;
  setBondLabels: (content: BondLabelContent) => void;
  setLabelStyle: (patch: {
    color?: string;
    size?: number;
    shift?: [number, number, number];
    bondShift?: [number, number, number];
    precision?: number;
  }) => void;
  /** Protein ribbons: off by default, since only a protein has them. */
  showRibbon: boolean;
  ribbonStyle: RibbonStyle;
  ribbonScale: number;
  /** The ribbon engine's own colour map (Avogadro gives every engine one). */
  ribbonColorScheme: RibbonColorScheme;
  /** The three colours Avogadro's cartoon engine exposes (helix, sheet, loop). */
  cartoonColors: CartoonColors;
  setCartoonColor: (kind: keyof CartoonColors, color: string) => void;
  /** Spline the ribbon through the backbone nitrogens as well as the alpha carbons. */
  ribbonNitrogens: boolean;
  toggleRibbonNitrogens: () => void;
  setRibbonColorScheme: (scheme: RibbonColorScheme) => void;
  toggleRibbon: () => void;
  setRibbonStyle: (style: RibbonStyle) => void;
  setRibbonScale: (scale: number) => void;
  /** Hydrogen bonds, drawn from the displayed geometry. */
  showHBonds: boolean;
  hbondDistance: number;
  hbondAngle: number;
  /** Dash thickness of a hydrogen bond, Avogadro's `widthSlider` (1-3, default 2). */
  hbondWidth: number;
  toggleHBonds: () => void;
  setHBondCutoffs: (patch: { distance?: number; angle?: number; width?: number }) => void;
  /** Structure engine settings that the Display panel exposes. */
  atomScale: number;
  /** Which radius `atomScale` is a fraction of; Avogadro's ball-and-stick defaults to vdW. */
  radiusBasis: RadiusBasis;
  bondRadius: number;
  /** The `stick` style's own radius, which Avogadro keeps separate from `bondRadius`. */
  stickRadius: number;
  /** Opacity of the atoms and bonds (Avogadro's per-engine `m_alpha`). */
  opacity: number;
  /** Draw the atoms of the wireframe style as dots ("Show Atoms" in Avogadro). */
  wireframeAtoms: boolean;
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
  setRadiusBasis: (basis: RadiusBasis) => void;
  setBondRadius: (radius: number) => void;
  setStickRadius: (radius: number) => void;
  setOpacity: (opacity: number) => void;
  toggleWireframeAtoms: () => void;
  setSelectionStyle: (style: StructureStyle | null) => void;
  toggleVectors: () => void;
  setVectorField: (field: string) => void;
  setVectorScale: (scale: number) => void;
  toggleDipole: () => void;
  setDipoleScale: (scale: number) => void;
  toggleUnitCell: () => void;
  setCellRepeat: (repeat: [number, number, number]) => void;
  toggleAxes: () => void;
  /**
   * Avogadro's View > Reset Display Types: put the display types and their settings back to the
   * defaults. Deliberately not the camera, the projection, the background, the render quality or
   * the depth cueing -- those are the application's preferences in Avogadro too, not part of an
   * engine set, and losing your view because you wanted default radii back would be a surprise.
   */
  resetDisplayTypes: () => void;
}

/**
 * What `resetDisplayTypes` restores. Written out rather than derived from the initial state so
 * that adding a setting is a deliberate decision about whether a reset should touch it.
 */
export const DISPLAY_TYPE_DEFAULTS = {
  style: 'ball-and-stick',
  atomScale: DEFAULT_STRUCTURE_SETTINGS.atomScale,
  radiusBasis: DEFAULT_STRUCTURE_SETTINGS.radiusBasis,
  bondRadius: DEFAULT_STRUCTURE_SETTINGS.bondRadius,
  stickRadius: DEFAULT_STRUCTURE_SETTINGS.stickRadius,
  opacity: DEFAULT_STRUCTURE_SETTINGS.opacity,
  wireframeAtoms: DEFAULT_STRUCTURE_SETTINGS.wireframeAtoms,
  // no vdwScale: Avogadro's sphere engine has an opacity and nothing else, so the space-filling
  // radius is the van der Waals radius itself and there is no scale to reset
  multipleBonds: true,
  showHydrogens: true,
  colorScheme: 'element',
  residuePalette: 'amino',
  customColor: '#4aa3ff',
  selectionStyle: null,
  atomStyles: NO_STYLES,
  atomColorOverrides: NO_ATOM_COLORS,
  showLabels: false,
  atomLabels: 'symbol_index',
  bondLabels: 'none',
  labelColor: '#222222',
  labelSize: 0.55,
  labelShift: [0, 0, 0],
  bondLabelShift: [0, 0, 0],
  labelPrecision: LENGTH_PRECISION.default,
  showRibbon: false,
  ribbonStyle: 'cartoon',
  ribbonScale: 1,
  ribbonColorScheme: 'secondary',
  cartoonColors: AVOGADRO_CARTOON_COLORS,
  ribbonNitrogens: false,
  showHBonds: false,
  hbondDistance: DEFAULT_HBOND_SETTINGS.maxDistance,
  hbondAngle: DEFAULT_HBOND_SETTINGS.minAngle,
  hbondWidth: 2,
  showVectors: false,
  showDipole: false,
  showUnitCell: true,
  cellRepeat: [1, 1, 1],
  showAxes: true,
} as const satisfies Partial<ViewState>;

export const useViewStore = create<ViewState>((set) => ({
  style: 'ball-and-stick',
  colorScheme: 'element',
  setColorScheme: (colorScheme) => set({ colorScheme }),
  residuePalette: 'amino',
  setResiduePalette: (residuePalette) => set({ residuePalette }),
  customColor: '#4aa3ff',
  setCustomColor: (customColor) => set({ customColor }),
  quality: 'auto',
  fog: 'none',
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
  bondLabelShift: [0, 0, 0],
  labelPrecision: LENGTH_PRECISION.default,
  setLabelStyle: ({ color, size, shift, bondShift, precision }) =>
    set((s) => ({
      labelColor: color ?? s.labelColor,
      labelSize: size ?? s.labelSize,
      labelShift: shift ?? s.labelShift,
      bondLabelShift: bondShift ?? s.bondLabelShift,
      labelPrecision: precision ?? s.labelPrecision,
    })),
  showHBonds: false,
  hbondDistance: DEFAULT_HBOND_SETTINGS.maxDistance,
  hbondAngle: DEFAULT_HBOND_SETTINGS.minAngle,
  hbondWidth: 2,
  toggleHBonds: () => set((s) => ({ showHBonds: !s.showHBonds })),
  setHBondCutoffs: ({ distance, angle, width }) =>
    set((s) => ({
      hbondDistance: distance ?? s.hbondDistance,
      hbondAngle: angle ?? s.hbondAngle,
      hbondWidth: width ?? s.hbondWidth,
    })),
  showRibbon: false,
  ribbonStyle: 'cartoon',
  ribbonScale: 1,
  ribbonColorScheme: 'secondary',
  cartoonColors: { ...AVOGADRO_CARTOON_COLORS },
  setCartoonColor: (kind, color) =>
    set((st) => ({ cartoonColors: { ...st.cartoonColors, [kind]: color } })),
  ribbonNitrogens: false,
  toggleRibbonNitrogens: () => set((st) => ({ ribbonNitrogens: !st.ribbonNitrogens })),
  setRibbonColorScheme: (ribbonColorScheme) => set({ ribbonColorScheme }),
  toggleRibbon: () => set((s) => ({ showRibbon: !s.showRibbon })),
  setRibbonStyle: (ribbonStyle) => set({ ribbonStyle }),
  setRibbonScale: (ribbonScale) => set({ ribbonScale }),
  atomScale: DEFAULT_STRUCTURE_SETTINGS.atomScale,
  radiusBasis: DEFAULT_STRUCTURE_SETTINGS.radiusBasis,
  bondRadius: DEFAULT_STRUCTURE_SETTINGS.bondRadius,
  stickRadius: DEFAULT_STRUCTURE_SETTINGS.stickRadius,
  opacity: DEFAULT_STRUCTURE_SETTINGS.opacity,
  wireframeAtoms: DEFAULT_STRUCTURE_SETTINGS.wireframeAtoms,
  multipleBonds: true,
  toggleMultipleBonds: () => set((s) => ({ multipleBonds: !s.multipleBonds })),
  selectionStyle: null,
  atomStyles: NO_STYLES,
  setAtomStyles: (atomStyles) => set({ atomStyles }),
  atomColorOverrides: NO_ATOM_COLORS,
  setAtomColorOverrides: (atomColorOverrides) => set({ atomColorOverrides }),
  setAtomScale: (atomScale) => set({ atomScale }),
  setRadiusBasis: (radiusBasis) => set({ radiusBasis }),
  setBondRadius: (bondRadius) => set({ bondRadius }),
  setStickRadius: (stickRadius) => set({ stickRadius }),
  setOpacity: (opacity) => set({ opacity }),
  toggleWireframeAtoms: () => set((st) => ({ wireframeAtoms: !st.wireframeAtoms })),
  setSelectionStyle: (selectionStyle) => set({ selectionStyle }),
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),
  setAtomLabels: (atomLabels) => set({ atomLabels, showLabels: true }),
  setBondLabels: (bondLabels) => set({ bondLabels, showLabels: true }),
  showVectors: false,
  vectorField: 'forces',
  vectorScale: 1,
  showDipole: false,
  dipoleScale: 1,
  showUnitCell: true,
  cellRepeat: [1, 1, 1],
  showAxes: true,
  toggleVectors: () => set((s) => ({ showVectors: !s.showVectors })),
  setVectorField: (vectorField) => set({ vectorField }),
  setVectorScale: (vectorScale) => set({ vectorScale }),
  toggleDipole: () => set((s) => ({ showDipole: !s.showDipole })),
  setDipoleScale: (dipoleScale) => set({ dipoleScale }),
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
  resetDisplayTypes: () => set({ ...DISPLAY_TYPE_DEFAULTS }),
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
