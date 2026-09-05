import { expect, test } from 'vitest';
import { emptyStructure, makeAtom, normalizeStructure } from './structure';
import { framePositions } from './trajectory';
import {
  DEFAULT_FRAMES_PER_PERIOD,
  equilibriumPositions,
  formatFrequency,
  maxDisplacement,
  modesTsv,
  modeToTrajectory,
  nearestPeak,
  normalizeSpectrum,
  scaleToMatch,
  spectrumTsv,
  type ApiVibrationalMode,
  type ApiVibrationalSpectrum,
} from './vibration';

/** Water's bend: the oxygen barely moves, the two hydrogens move a lot. Sum of squares = 1. */
const bend: ApiVibrationalMode = {
  frequency: 1595.3,
  displacements: [
    [0, 0, -0.0669],
    [0, 0.4176, 0.5308],
    [0, -0.4176, 0.5308],
  ],
  ir_intensity: 62.1,
  raman_activity: null,
  symmetry: 'A1',
  reduced_mass: 1.08,
  force_constant: 1.65,
  kind: 'vibration',
};

const equilibrium = Float32Array.from([0, 0, 0.117, 0, 0.757, -0.469, 0, -0.757, -0.469]);
const symbols = ['O', 'H', 'H'];

test('the frame sequence has the requested length and preserves the atoms', () => {
  const t = modeToTrajectory(bend, equilibrium, symbols, { framesPerPeriod: 24 });
  expect(t).not.toBeNull();
  expect(t!.nFrames).toBe(24);
  expect(t!.nAtoms).toBe(3);
  expect(t!.symbols).toEqual(symbols);
  expect(t!.kind).toBe('vibration');
  expect(t!.positions.length).toBe(24 * 3 * 3);
  expect(t!.cells).toBeNull();
});

test('frame 0 is the equilibrium geometry and so is the half-period frame', () => {
  const t = modeToTrajectory(bend, equilibrium, symbols, { framesPerPeriod: 16 })!;
  expect(Array.from(framePositions(t, 0))).toEqual(Array.from(equilibrium));
  // sin(pi) = 0 at k = N/2
  for (const [i, v] of Array.from(framePositions(t, 8)).entries()) {
    expect(v).toBeCloseTo(equilibrium[i]!, 5);
  }
});

test('the quarter- and three-quarter-period frames are mirror images about equilibrium', () => {
  const t = modeToTrajectory(bend, equilibrium, symbols, { framesPerPeriod: 16 })!;
  const up = framePositions(t, 4);
  const down = framePositions(t, 12);
  for (let i = 0; i < up.length; i++) {
    expect(up[i]! - equilibrium[i]!).toBeCloseTo(-(down[i]! - equilibrium[i]!), 5);
  }
});

test('no atom moves further than amplitude times its displacement', () => {
  const amplitude = 0.7;
  const t = modeToTrajectory(bend, equilibrium, symbols, { amplitude, framesPerPeriod: 32 })!;
  const bound = amplitude * maxDisplacement(bend);
  let observed = 0;
  for (let k = 0; k < t.nFrames; k++) {
    const p = framePositions(t, k);
    for (let i = 0; i < t.nAtoms; i++) {
      observed = Math.max(
        observed,
        Math.hypot(
          p[3 * i]! - equilibrium[3 * i]!,
          p[3 * i + 1]! - equilibrium[3 * i + 1]!,
          p[3 * i + 2]! - equilibrium[3 * i + 2]!,
        ),
      );
    }
  }
  expect(observed).toBeLessThanOrEqual(bound + 1e-5);
  // and with 32 frames the extremum (k = 8) is actually reached
  expect(observed).toBeCloseTo(bound, 4);
});

test('amplitude scales the excursion linearly', () => {
  const small = modeToTrajectory(bend, equilibrium, symbols, {
    amplitude: 0.25,
    framesPerPeriod: 8,
  })!;
  const large = modeToTrajectory(bend, equilibrium, symbols, {
    amplitude: 0.5,
    framesPerPeriod: 8,
  })!;
  const dSmall = framePositions(small, 2)[5]! - equilibrium[5]!;
  const dLarge = framePositions(large, 2)[5]! - equilibrium[5]!;
  expect(dLarge).toBeCloseTo(2 * dSmall, 6);
});

test('framesPerPeriod is clamped to at least two frames', () => {
  expect(modeToTrajectory(bend, equilibrium, symbols, { framesPerPeriod: 1 })!.nFrames).toBe(2);
  expect(modeToTrajectory(bend, equilibrium, symbols)!.nFrames).toBe(DEFAULT_FRAMES_PER_PERIOD);
});

test('a mode whose atom count does not match the geometry is rejected', () => {
  expect(modeToTrajectory(bend, equilibrium, ['O', 'H'])).toBeNull();
  expect(modeToTrajectory(bend, Float32Array.from([0, 0, 0]), symbols)).toBeNull();
  expect(modeToTrajectory(bend, equilibrium, [])).toBeNull();
});

test('equilibrium positions come from the spectrum when it carries a geometry', () => {
  const spectrum: ApiVibrationalSpectrum = {
    id: 'v1',
    modes: [bend],
    symbols,
    positions: [
      [0, 0, 0.117],
      [0, 0.757, -0.469],
      [0, -0.757, -0.469],
    ],
  };
  const doc = normalizeStructure({
    name: 'somewhere else',
    charge: 0,
    atoms: [makeAtom('O', [9, 9, 9]), makeAtom('H', [9, 9, 9]), makeAtom('H', [9, 9, 9])],
  });
  expect(Array.from(equilibriumPositions(spectrum, doc)!)).toEqual(Array.from(equilibrium));
});

test('equilibrium positions fall back to the document when the spectrum has none', () => {
  const spectrum: ApiVibrationalSpectrum = { id: 'v1', modes: [bend] };
  const doc = normalizeStructure({
    name: 'w',
    charge: 0,
    atoms: [makeAtom('O', [1, 2, 3])],
  });
  expect(Array.from(equilibriumPositions(spectrum, doc)!)).toEqual([1, 2, 3]);
  expect(equilibriumPositions(spectrum, emptyStructure())).toBeNull();
});

test('imaginary frequencies are formatted with an i', () => {
  expect(formatFrequency(1595.34)).toBe('1595.3 cm⁻¹');
  expect(formatFrequency(-212.7)).toBe('212.7i cm⁻¹');
});

test('nearestPeak finds the closest stick and copes with an empty list', () => {
  const peaks = [
    { x: 100, intensity: 1 },
    { x: 1600, intensity: 4 },
    { x: 3700, intensity: 2 },
  ];
  expect(nearestPeak(peaks, 1500)).toBe(1);
  expect(nearestPeak(peaks, 5000)).toBe(2);
  expect(nearestPeak([], 10)).toBe(-1);
});

test('scaleToMatch aligns peak heights without changing the shape', () => {
  const scaled = scaleToMatch([1, 2, 4], [0, 10, 5]);
  expect(scaled).toEqual([2.5, 5, 10]);
  expect(scaleToMatch([0, 0], [1, 2])).toEqual([0, 0]);
});

test('normalizeSpectrum fills the arrays pydantic marks optional', () => {
  const s = normalizeSpectrum({
    id: 's',
    kind: 'ir',
    name: 'IR',
    x: { label: 'wavenumber', unit: 'cm^-1', descending: true },
    y: { label: 'intensity', unit: 'km/mol', descending: false },
  });
  expect(s.peaks).toEqual([]);
  expect(s.x_values).toEqual([]);
  expect(s.y_values).toEqual([]);
});

test('a spectrum exports as two tab-separated columns headed by its axes', () => {
  const spectrum = normalizeSpectrum({
    id: 's1',
    kind: 'ir',
    name: 'IR spectrum',
    x: { label: 'wavenumber', unit: 'cm^-1', descending: true },
    y: { label: 'IR intensity', unit: 'km/mol', descending: false },
    x_values: [1500, 1600.25, 1700],
    y_values: [0, 62.1234567, 0.5],
  });
  expect(spectrumTsv(spectrum)).toBe(
    'wavenumber [cm^-1]\tIR intensity [km/mol]\n1500\t0\n1600.25\t62.1235\n1700\t0.5\n',
  );
});

test('a spectrum with no unit is headed by the bare label', () => {
  const spectrum = normalizeSpectrum({
    id: 's2',
    kind: 'other',
    name: 'raw',
    x: { label: 'index', unit: '', descending: false },
    y: { label: 'signal', unit: '', descending: false },
    x_values: [1],
    y_values: [2],
  });
  expect(spectrumTsv(spectrum).split('\n')[0]).toBe('index\tsignal');
});

test('the mode table exports one row per mode, with "-" where nothing was reported', () => {
  const tsv = modesTsv({
    id: 'v1',
    modes: [
      {
        frequency: 1595.34,
        displacements: [[0, 0, 1]],
        ir_intensity: 62.1,
        reduced_mass: 1.0824,
        symmetry: 'A1',
        kind: 'vibration',
      },
      { frequency: -212.5, displacements: [[0, 0, 1]], kind: 'vibration' },
    ],
    trivial_modes: [],
  });
  const lines = tsv.split('\n');
  expect(lines[0]).toBe(
    'mode\tfrequency [cm^-1]\tIR intensity [km/mol]\tRaman activity [A^4/amu]\treduced mass [amu]\tforce constant [mDyne/A]\tsymmetry',
  );
  expect(lines[1]).toBe('1\t1595.34\t62.10\t-\t1.0824\t-\tA1');
  // an imaginary frequency keeps its sign: a table is not the place for the "123i" convention
  expect(lines[2]).toBe('2\t-212.50\t-\t-\t-\t-\t-');
  expect(lines[3]).toBe('');
});
