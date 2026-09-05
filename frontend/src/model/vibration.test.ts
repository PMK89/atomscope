import { expect, test } from 'vitest';
import { emptyStructure, makeAtom, normalizeStructure } from './structure';
import { framePositions } from './trajectory';
import {
  DEFAULT_FRAMES_PER_PERIOD,
  equilibriumPositions,
  formatFrequency,
  maxDisplacement,
  modeToTrajectory,
  nearestPeak,
  normalizeSpectrum,
  scaleToMatch,
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
