/**
 * Vibrational modes, spectra and the mode currently being animated.
 *
 * Animation reuses the trajectory machinery: `animateMode` builds a frame sequence from the
 * selected mode (`model/vibration.modeToTrajectory`) and loads it into the trajectory store, so
 * the viewport, the player controls and the frame slider all work unchanged. `stopAnimation`
 * clears the trajectory, which drops the viewport back onto the structure document -- the
 * equilibrium geometry.
 */
import { create } from 'zustand';
import { api, type Body } from '../api/client';
import type { ApiSpectrum, ApiVibrationalSpectrum, SpectrumDoc } from '../model/vibration';
import {
  DEFAULT_AMPLITUDE,
  DEFAULT_FRAMES_PER_PERIOD,
  equilibriumPositions,
  formatFrequency,
  modeToTrajectory,
  normalizeSpectrum,
} from '../model/vibration';
import { normalizeStructure, type StructureDoc } from '../model/structure';
import { useStructureStore } from './structureStore';
import { useTrajectoryStore } from './trajectoryStore';

export interface SpectrumEntry {
  id: string;
  spectrum: SpectrumDoc;
  /** true for imported experimental data, which is drawn as an overlay */
  experimental: boolean;
}

export interface SpectrumState {
  vibrations: ApiVibrationalSpectrum | null;
  /** Source label for the mode list header (force field name or file name). */
  source: string | null;
  spectra: SpectrumEntry[];
  activeSpectrumId: string | null;
  overlayId: string | null;
  selectedMode: number;
  amplitude: number;
  framesPerPeriod: number;
  busy: string | null;

  setVibrations: (v: ApiVibrationalSpectrum | null, source: string | null) => void;
  addSpectrum: (spectrum: ApiSpectrum, experimental: boolean) => void;
  removeSpectrum: (id: string) => void;
  setActiveSpectrum: (id: string | null) => void;
  setOverlay: (id: string | null) => void;
  selectMode: (index: number) => void;
  setAmplitude: (amplitude: number) => void;
  setFramesPerPeriod: (frames: number) => void;

  /** Compute modes for the current document; commits the relaxed geometry as one undo step. */
  computeVibrations: (request: { calculator: string; force_field: string }) => Promise<void>;
  /** Build frames for `index` and start the trajectory player. */
  animateMode: (index: number) => boolean;
  /** Stop the animation and return the viewport to the equilibrium geometry. */
  stopAnimation: () => void;
}

type ApiStructureBody = Body<'/api/analysis/vibrations', 'post'>['structure'];

/** The document as the backend expects it; derived fields the API recomputes are left out. */
const toApiStructure = (doc: StructureDoc): ApiStructureBody => ({
  id: doc.id,
  name: doc.name,
  atoms: doc.atoms,
  bonds: doc.bonds,
  cell: doc.cell,
  charge: doc.charge,
  multiplicity: doc.multiplicity,
  constraints: doc.constraints,
  residues: doc.residues,
});

export const useSpectrumStore = create<SpectrumState>((set, get) => ({
  vibrations: null,
  source: null,
  spectra: [],
  activeSpectrumId: null,
  overlayId: null,
  selectedMode: -1,
  amplitude: DEFAULT_AMPLITUDE,
  framesPerPeriod: DEFAULT_FRAMES_PER_PERIOD,
  busy: null,

  setVibrations: (vibrations, source) =>
    set({ vibrations, source, selectedMode: vibrations && vibrations.modes.length ? 0 : -1 }),

  addSpectrum: (raw, experimental) => {
    const spectrum = normalizeSpectrum(raw);
    set((s) => ({
      spectra: [
        ...s.spectra.filter((e) => e.id !== spectrum.id),
        { id: spectrum.id, spectrum, experimental },
      ],
      activeSpectrumId: experimental ? (s.activeSpectrumId ?? spectrum.id) : spectrum.id,
      overlayId: experimental ? spectrum.id : s.overlayId,
    }));
  },

  removeSpectrum: (id) =>
    set((s) => ({
      spectra: s.spectra.filter((e) => e.id !== id),
      activeSpectrumId: s.activeSpectrumId === id ? null : s.activeSpectrumId,
      overlayId: s.overlayId === id ? null : s.overlayId,
    })),

  setActiveSpectrum: (activeSpectrumId) => set({ activeSpectrumId }),
  setOverlay: (overlayId) => set({ overlayId }),
  selectMode: (selectedMode) => set({ selectedMode }),
  setAmplitude: (amplitude) => set({ amplitude: Math.min(Math.max(amplitude, 0.01), 3) }),
  setFramesPerPeriod: (frames) =>
    set({ framesPerPeriod: Math.min(Math.max(Math.round(frames), 4), 120) }),

  computeVibrations: async ({ calculator, force_field }) => {
    const doc = useStructureStore.getState().doc;
    set({ busy: 'vibrations' });
    try {
      const res = await api.analysis.vibrations({
        structure: toApiStructure(doc),
        calculator,
        force_field,
        delta: 0.01,
        optimize_first: true,
        charge_model: 'gasteiger',
      });
      // the backend minimises first, so the modes belong to the returned geometry: adopt it.
      // Atom uids are kept so selections and undo survive the geometry change.
      const relaxed = normalizeStructure({ ...res.structure, id: doc.id });
      useStructureStore.getState().commit('vibrational analysis geometry', {
        ...relaxed,
        atoms: relaxed.atoms.map((a, i) => {
          const uid = doc.atoms[i]?.uid;
          return uid ? { ...a, uid } : a;
        }),
      });
      get().setVibrations(res.vibrations, `${force_field} (${calculator})`);
      get().addSpectrum(res.ir, false);
    } finally {
      set({ busy: null });
    }
  },

  animateMode: (index) => {
    const { vibrations, amplitude, framesPerPeriod } = get();
    const mode = vibrations?.modes[index];
    if (!vibrations || !mode) return false;
    const doc = useStructureStore.getState().doc;
    const equilibrium = equilibriumPositions(vibrations, doc);
    const symbols = vibrations.symbols?.length
      ? vibrations.symbols
      : doc.atoms.map((a) => a.element);
    if (!equilibrium) return false;
    const trajectory = modeToTrajectory(mode, equilibrium, symbols, {
      amplitude,
      framesPerPeriod,
      name: `${formatFrequency(mode.frequency)} (mode ${index + 1})`,
    });
    if (!trajectory) return false;
    set({ selectedMode: index });
    useTrajectoryStore.getState().load(trajectory);
    useTrajectoryStore.getState().play();
    return true;
  },

  stopAnimation: () => {
    const t = useTrajectoryStore.getState();
    if (t.trajectory?.kind === 'vibration') t.clear();
  },
}));
