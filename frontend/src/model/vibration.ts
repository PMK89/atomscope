/**
 * Normal modes on the client: turn one mode into a frame sequence the trajectory player can
 * animate, and shape spectra for the chart. Pure functions -- no React, no Three, no chemistry
 * beyond arithmetic on numbers the backend computed.
 *
 * A mode's `displacements` are Cartesian vectors normalised over all atoms (see
 * `atomscope.model.VibrationalMode`). Atom i of frame k sits at
 *
 *     r_i(k) = r_i(eq) + amplitude * sin(2 pi k / framesPerPeriod) * d_i
 *
 * so the animation traces one full period over `framesPerPeriod` frames. The last frame is
 * k = framesPerPeriod - 1: frame `framesPerPeriod` would repeat frame 0 and make the looping
 * player stutter.
 */
import type { components } from '../api/schema';
import type { StructureDoc, Vec3 } from './structure';
import type { TrajectoryData } from './trajectory';

export type ApiVibrationalMode = components['schemas']['VibrationalMode'];
export type ApiVibrationalSpectrum = components['schemas']['VibrationalSpectrum'];
export type ApiSpectrum = components['schemas']['Spectrum'];
export type ApiSpectrumPeak = components['schemas']['SpectrumPeak'];
export type ApiSpectrumAxis = components['schemas']['SpectrumAxis'];
export type LineShape = NonNullable<ApiSpectrum['line_shape']>;

/** A Spectrum with the fields pydantic marks optional (default_factory) filled in. */
export interface SpectrumDoc extends Omit<ApiSpectrum, 'peaks' | 'x_values' | 'y_values'> {
  peaks: ApiSpectrumPeak[];
  x_values: number[];
  y_values: number[];
}

export function normalizeSpectrum(s: ApiSpectrum): SpectrumDoc {
  return {
    ...s,
    peaks: s.peaks ?? [],
    x_values: s.x_values ?? [],
    y_values: s.y_values ?? [],
  };
}

export const DEFAULT_AMPLITUDE = 0.5;
export const DEFAULT_FRAMES_PER_PERIOD = 16;

const nanArray = (n: number): Float64Array => Float64Array.from({ length: n }, () => NaN);

/** Equilibrium positions for a mode: the spectrum's own geometry, else the document's. */
export function equilibriumPositions(
  spectrum: ApiVibrationalSpectrum,
  doc: StructureDoc,
): Float32Array | null {
  const nAtoms = spectrum.symbols?.length ?? 0;
  const stored = spectrum.positions ?? [];
  if (nAtoms > 0 && stored.length === nAtoms) {
    const out = new Float32Array(nAtoms * 3);
    stored.forEach((p, i) => {
      out[3 * i] = p[0];
      out[3 * i + 1] = p[1];
      out[3 * i + 2] = p[2];
    });
    return out;
  }
  if (doc.atoms.length === 0) return null;
  const out = new Float32Array(doc.atoms.length * 3);
  doc.atoms.forEach((a, i) => {
    out[3 * i] = a.position[0];
    out[3 * i + 1] = a.position[1];
    out[3 * i + 2] = a.position[2];
  });
  return out;
}

export interface ModeAnimationOptions {
  /** Maximum Cartesian excursion in Å of the most strongly displaced atom. */
  amplitude?: number;
  /** Frames per full oscillation; must be at least 2. */
  framesPerPeriod?: number;
  /** Name shown in the player; defaults to the frequency. */
  name?: string;
}

/**
 * A closed oscillation of `mode` about `equilibrium`, as a TrajectoryData the player can drive.
 *
 * `equilibrium` is a flat (nAtoms * 3) array of Å; `symbols` must match it. Returns null when the
 * mode's displacement count does not match the geometry, which is the signal that the loaded
 * structure is not the one the modes belong to.
 */
export function modeToTrajectory(
  mode: ApiVibrationalMode,
  equilibrium: Float32Array,
  symbols: readonly string[],
  options: ModeAnimationOptions = {},
): TrajectoryData | null {
  const nAtoms = symbols.length;
  if (nAtoms === 0 || equilibrium.length !== nAtoms * 3) return null;
  if (mode.displacements.length !== nAtoms) return null;
  const amplitude = options.amplitude ?? DEFAULT_AMPLITUDE;
  const nFrames = Math.max(2, Math.round(options.framesPerPeriod ?? DEFAULT_FRAMES_PER_PERIOD));

  const positions = new Float32Array(nFrames * nAtoms * 3);
  for (let k = 0; k < nFrames; k++) {
    const scale = amplitude * Math.sin((2 * Math.PI * k) / nFrames);
    const base = k * nAtoms * 3;
    for (let i = 0; i < nAtoms; i++) {
      const d = mode.displacements[i] as Vec3;
      positions[base + 3 * i] = equilibrium[3 * i]! + scale * d[0];
      positions[base + 3 * i + 1] = equilibrium[3 * i + 1]! + scale * d[1];
      positions[base + 3 * i + 2] = equilibrium[3 * i + 2]! + scale * d[2];
    }
  }
  return {
    id: `mode-${mode.frequency.toFixed(2)}`,
    name: options.name ?? `${formatFrequency(mode.frequency)} mode`,
    kind: 'vibration',
    // the mode is animated from a structure the caller already has on screen
    structureId: null,
    symbols: [...symbols],
    nFrames,
    nAtoms,
    positions,
    cells: null,
    energy: nanArray(nFrames),
    time: nanArray(nFrames),
    temperature: nanArray(nFrames),
    step: Float64Array.from({ length: nFrames }, (_, k) => k),
  };
}

/** `frequency` with the imaginary convention Avogadro uses: negative numbers become "123i". */
export function formatFrequency(frequency: number): string {
  return frequency < 0 ? `${Math.abs(frequency).toFixed(1)}i cm⁻¹` : `${frequency.toFixed(1)} cm⁻¹`;
}

/** Largest single-atom displacement of a unit-normalised mode, in the mode's own units. */
export function maxDisplacement(mode: ApiVibrationalMode): number {
  let max = 0;
  for (const d of mode.displacements) {
    max = Math.max(max, Math.hypot(d[0], d[1], d[2]));
  }
  return max;
}

/** Index of the mode whose (scaled) frequency is closest to `x`; -1 when there are none. */
export function nearestPeak(peaks: readonly ApiSpectrumPeak[], x: number): number {
  let best = -1;
  let bestDistance = Infinity;
  peaks.forEach((p, i) => {
    const d = Math.abs(p.x - x);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  return best;
}

/**
 * Rescale `y` so its maximum absolute value matches `reference`'s, for overlaying an imported
 * experimental spectrum on a computed one whose y unit is different (km/mol vs %T).
 */
export function scaleToMatch(y: readonly number[], reference: readonly number[]): number[] {
  const peak = (values: readonly number[]): number =>
    values.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const from = peak(y);
  const to = peak(reference);
  if (from === 0 || to === 0) return [...y];
  const factor = to / from;
  return y.map((v) => v * factor);
}

/** An axis as a column or axis title: the label, with the unit when there is one. */
export function axisLabel(axis: ApiSpectrumAxis): string {
  return axis.unit ? `${axis.label} [${axis.unit}]` : axis.label;
}

/** `value` at six significant digits, without the trailing zeros `toPrecision` leaves. */
const sixFigures = (value: number): string => String(Number(value.toPrecision(6)));

/**
 * The broadened curve as tab-separated values, one row per grid point, headed by the axis titles.
 *
 * Avogadro exported the same two columns under fixed headers per spectrum type -- "Frequencies /
 * Intensities" for IR, "Energy(eV) / Density(e/UC)" for a DOS (spectratype.cpp:77, ir.cpp:171,
 * dos.cpp:259). The axes carry those titles here, so one function stays right for the kinds
 * Avogadro had and for the ones it did not.
 */
export function spectrumTsv(spectrum: SpectrumDoc): string {
  const rows = spectrum.x_values.map(
    (x, i) => `${sixFigures(x)}\t${sixFigures(spectrum.y_values[i] ?? 0)}`,
  );
  return [`${axisLabel(spectrum.x)}\t${axisLabel(spectrum.y)}`, ...rows, ''].join('\n');
}

/**
 * The normal modes as tab-separated values: one row per mode, "-" where a property was not
 * reported. Avogadro's own Export button wrote frequency and IR intensity only, and shipped
 * commented out (vibrationwidget.cpp:318-364); the other per-mode numbers cost nothing to write.
 */
export function modesTsv(vibrations: ApiVibrationalSpectrum): string {
  const cell = (value: number | null | undefined, digits: number): string =>
    value == null ? '-' : value.toFixed(digits);
  const rows = vibrations.modes.map((m, i) =>
    [
      i + 1,
      m.frequency.toFixed(2),
      cell(m.ir_intensity, 2),
      cell(m.raman_activity, 2),
      cell(m.reduced_mass, 4),
      cell(m.force_constant, 4),
      m.symmetry ?? '-',
    ].join('\t'),
  );
  const header = [
    'mode',
    'frequency [cm^-1]',
    'IR intensity [km/mol]',
    'Raman activity [A^4/amu]',
    'reduced mass [amu]',
    'force constant [mDyne/A]',
    'symmetry',
  ].join('\t');
  return [header, ...rows, ''].join('\n');
}
