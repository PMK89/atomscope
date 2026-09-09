/**
 * The goldens are ASE's and CP-PAW's, not this module's own.
 *
 * `BOND_01`, `ANGLE_102` and `TORSION_1023` are `ase.Atoms.get_distance/get_angle/get_dihedral`
 * with `mic=True` on the fixture, which is a real `VelocityVerlet` run of four copper atoms in a
 * 3.61 A cell **with the positions wrapped into it** -- the case that separates a correct
 * minimum-image treatment from a naive difference.
 *
 * `TEMPERATURE_ALL` is `paw_tra`'s group-temperature formula, and it happens to be checkable
 * outright: for a Verlet propagator r(n+1) - r(n-1) = 2 v(n) dt exactly, so the central
 * difference must reproduce ASE's own `get_temperature()` of the corresponding frame to
 * round-off. `ASE_TEMPERATURE` below is what the MD reported.
 *
 * The tolerances are set by the trajectory being held as Float32 (`TrajectoryData.positions`,
 * which the renderer shares): ~3e-7 A on a position, and a central difference over a 2 fs window
 * turns that into ~1e-5 relative on a velocity -- 0.002 K on 230 K. That floor, not an
 * approximation in the formulas, is what the last digit of each golden is spent on.
 */
import { describe, expect, it } from 'vitest';

import copper from './__fixtures__/copper-md.json';
import { trajectoryFromJson, type ApiTrajectory, type TrajectoryData } from './trajectory';
import {
  KIN_TO_KELVIN,
  derivative,
  elementGroups,
  groupTemperature,
  micChain,
  minimumImage,
  modeSeries,
  modeUnit,
  parseIndices,
  retardedAverage,
  termIsValid,
  termSeries,
  termUnit,
  timeAxis,
} from './timeseries';

const md = (): TrajectoryData => trajectoryFromJson(copper as unknown as ApiTrajectory);

const BOND_01 = [
  2.54098, 2.538491, 2.535974, 2.533431, 2.530867, 2.528287, 2.525694, 2.523094, 2.520491,
  2.51789, 2.515296, 2.512714, 2.51015, 2.507608,
];
const ANGLE_102 = [
  122.880041, 122.843549, 122.803372, 122.759493, 122.711899, 122.660585, 122.605551, 122.546803,
  122.484357, 122.418233, 122.348458, 122.275069, 122.19811, 122.117634,
];
const TORSION_1023 = [
  110.318493, 110.293535, 110.267409, 110.240078, 110.21151, 110.181674, 110.150542, 110.118088,
  110.084291, 110.049131, 110.012594, 109.974667, 109.935342, 109.894617,
];
/** `ase.Atoms.get_temperature()` as the MD reported it, one per frame. */
const ASE_TEMPERATURE = [
  233.556179, 230.257454, 226.755689, 223.082557, 219.270617, 215.352981, 211.362996, 207.333921,
  203.298623, 199.289274, 195.337075, 191.47199, 187.722506, 184.115412,
];
const TEMPERATURE_FIRST_PAIR = [
  292.2423, 290.0433, 287.5137, 284.679, 281.5681, 278.2103, 274.6353, 270.8737, 266.9572,
  262.9184, 258.7882, 254.5968,
];
const TEMPERATURE_RETARDED_4FS = [
  230.2577, 228.8798, 226.5988, 223.7153, 220.4249, 216.8593, 213.1114, 209.2504, 205.3309,
  201.3986, 197.4929, 193.6485,
];
const MODE_VELOCITY = [
  0.00072, 0.0006175, 0.0004115, 0.0002036, -0.0000057, -0.0002157, -0.0004261, -0.0006363,
  -0.0008456, -0.0010536, -0.0012597, -0.0014633, -0.0016638, -0.0017633,
];

/** Two atoms either side of a cell face: the case a naive difference gets wrong by a cell. */
function straddling(): TrajectoryData {
  const cell: [[number, number, number], [number, number, number], [number, number, number]] = [
    [10, 0, 0],
    [0, 10, 0],
    [0, 0, 10],
  ];
  return trajectoryFromJson({
    id: 'straddle',
    name: 'straddle',
    kind: 'md',
    structure_id: null,
    symbols: ['H', 'H'],
    frames: [
      {
        positions: [
          [0.4, 0, 0],
          [9.6, 0, 0],
        ],
        cell,
        energy: null,
        time: 0,
        temperature: null,
        step: 0,
      },
      {
        positions: [
          [0.3, 0, 0],
          [9.5, 0, 0],
        ],
        cell,
        energy: null,
        time: 1,
        temperature: null,
        step: 1,
      },
    ],
  } as unknown as ApiTrajectory);
}

describe('minimum image', () => {
  it('takes the shortest image of a displacement across a cell face', () => {
    const cell: [[number, number, number], [number, number, number], [number, number, number]] = [
      [10, 0, 0],
      [0, 10, 0],
      [0, 0, 10],
    ];
    expect(minimumImage([9.2, 0, 0], cell)[0]).toBeCloseTo(-0.8, 12);
  });

  it('is right for a cell skew enough that rounding the fractions is not', () => {
    // a strongly sheared cell: the nearest image of (0.6, 0.55, 0) in fractions is not the one
    // rounding picks, which is what the sweep over the 26 neighbours is for
    const cell: [[number, number, number], [number, number, number], [number, number, number]] = [
      [1, 0, 0],
      [0.9, 1, 0],
      [0, 0, 1],
    ];
    const d = minimumImage([0.95, 0.5, 0], cell);
    const naive = Math.hypot(0.95, 0.5);
    expect(Math.hypot(d[0], d[1], d[2])).toBeLessThan(naive);
    // no image can be shorter than the one returned
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        const x = d[0] + i * cell[0][0] + j * cell[1][0];
        const y = d[1] + i * cell[0][1] + j * cell[1][1];
        expect(Math.hypot(x, y)).toBeGreaterThan(Math.hypot(d[0], d[1], d[2]) - 1e-9);
      }
    }
  });

  it('unwraps a chain so a bond across the boundary is short, not a cell long', () => {
    const t = straddling();
    const q = micChain(t, 0, [0, 1]);
    expect(q[1]![0] - q[0]![0]).toBeCloseTo(-0.8, 6);
    expect(termSeries(t, { kind: 'bond', atoms: [0, 1], scale: 1 })).toEqual([
      expect.closeTo(0.8, 6),
      expect.closeTo(0.8, 6),
    ]);
  });

  it('leaves an aperiodic trajectory alone', () => {
    const t = trajectoryFromJson({
      id: 'gas',
      name: 'gas',
      kind: 'md',
      structure_id: null,
      symbols: ['H', 'H'],
      frames: [
        {
          positions: [
            [0, 0, 0],
            [9, 0, 0],
          ],
          cell: null,
          energy: null,
          time: 0,
          temperature: null,
          step: 0,
        },
      ],
    } as unknown as ApiTrajectory);
    expect(termSeries(t, { kind: 'bond', atoms: [0, 1], scale: 1 })[0]).toBeCloseTo(9, 10);
  });
});

describe('internal coordinates', () => {
  it('matches ase get_distance(mic=True) frame by frame', () => {
    const y = termSeries(md(), { kind: 'bond', atoms: [0, 1], scale: 1 });
    expect(y).toHaveLength(BOND_01.length);
    y.forEach((v, i) => expect(v).toBeCloseTo(BOND_01[i]!, 5));
  });

  it('matches ase get_angle(mic=True), vertex in the middle', () => {
    const y = termSeries(md(), { kind: 'angle', atoms: [1, 0, 2], scale: 1 });
    y.forEach((v, i) => expect(v).toBeCloseTo(ANGLE_102[i]!, 5));
  });

  it('matches ase get_dihedral(mic=True) in magnitude, with the measurement table sign', () => {
    const y = termSeries(md(), { kind: 'torsion', atoms: [1, 0, 2, 3], scale: 1 });
    y.forEach((v, i) => expect(v).toBeCloseTo(TORSION_1023[i]!, 4));
  });

  it('differs from the same bond taken without the minimum image', () => {
    const t = md();
    const withMic = termSeries(t, { kind: 'bond', atoms: [0, 1], scale: 1 });
    const raw = Math.hypot(
      t.positions[0]! - t.positions[3]!,
      t.positions[1]! - t.positions[4]!,
      t.positions[2]! - t.positions[5]!,
    );
    expect(Math.abs(raw - withMic[0]!)).toBeGreaterThan(1e-3);
  });

  it('sums scaled terms into a mode, and carries the shared unit', () => {
    const t = md();
    const d01 = termSeries(t, { kind: 'bond', atoms: [0, 1], scale: 1 });
    const d02 = termSeries(t, { kind: 'bond', atoms: [0, 2], scale: 1 });
    const terms = [
      { kind: 'bond' as const, atoms: [0, 1], scale: 1 },
      { kind: 'bond' as const, atoms: [0, 2], scale: -1 },
    ];
    modeSeries(t, terms).forEach((v, i) => expect(v).toBeCloseTo(d01[i]! - d02[i]!, 10));
    expect(modeUnit(terms)).toBe('Å');
    expect(modeUnit([...terms, { kind: 'angle', atoms: [0, 1, 2], scale: 1 }])).toBe('');
    expect(termUnit('torsion')).toBe('°');
  });

  it('skips a term whose indices do not fit rather than throwing', () => {
    const t = md();
    expect(termIsValid(t, { kind: 'bond', atoms: [0], scale: 1 })).toBe(false);
    expect(termIsValid(t, { kind: 'bond', atoms: [0, 99], scale: 1 })).toBe(false);
    expect(modeSeries(t, [{ kind: 'bond', atoms: [0, 99], scale: 1 }])).toEqual(
      new Array(t.nFrames).fill(0),
    );
  });
});

describe('group temperature', () => {
  it('reproduces the MD run own get_temperature() on wrapped positions', () => {
    const t = md();
    const time = timeAxis(t);
    expect(time).not.toBeNull();
    const series = groupTemperature(t, [0, 1, 2, 3], time!);
    // interior frames only: the first and last have no central difference
    expect(series.x).toHaveLength(t.nFrames - 2);
    expect(series.x[0]).toBe(1);
    series.y.forEach((v, i) => {
      // Verlet makes the central difference exact, so this is equality to round-off
      expect(v / ASE_TEMPERATURE[i + 1]!).toBeCloseTo(1, 4);
    });
  });

  it('measures a subgroup, and the subgroups average back to the whole', () => {
    const t = md();
    const time = timeAxis(t)!;
    const first = groupTemperature(t, [0, 1], time);
    const second = groupTemperature(t, [2, 3], time);
    const all = groupTemperature(t, [0, 1, 2, 3], time);
    first.y.forEach((v, i) => expect(v).toBeCloseTo(TEMPERATURE_FIRST_PAIR[i]!, 2));
    // equal counts and equal masses, so the mean of the halves is the whole
    all.y.forEach((v, i) => expect((first.y[i]! + second.y[i]!) / 2).toBeCloseTo(v, 8));
    expect(first.y[0]).not.toBeCloseTo(all.y[0]!, 1);
  });

  it('needs three frames and a group', () => {
    const t = md();
    const time = timeAxis(t)!;
    expect(groupTemperature(t, [], time).y).toEqual([]);
    expect(groupTemperature(straddling(), [0], [0, 1]).y).toEqual([]);
  });

  it('states the kelvin conversion ase agrees with', () => {
    // 1 amu A^2/fs^2 in K; the fixture's temperatures were produced with ase's own constants
    expect(KIN_TO_KELVIN).toBeCloseTo(1202723.9488874401, 4);
  });
});

describe('derivative and running average', () => {
  it('is paw_tra VELOCITY: central inside, one-sided at the ends', () => {
    const t = md();
    const time = timeAxis(t)!;
    const mode = modeSeries(t, [
      { kind: 'bond', atoms: [0, 1], scale: 1 },
      { kind: 'bond', atoms: [0, 2], scale: -1 },
    ]);
    derivative(time, mode).forEach((v, i) => expect(v).toBeCloseTo(MODE_VELOCITY[i]!, 6));
  });

  it('differentiates an uneven time axis exactly for a quadratic', () => {
    const x = [0, 1, 3, 7];
    const y = x.map((v) => 2 * v * v - v + 5);
    // central differences are exact for a quadratic; the one-sided ends are not
    expect(derivative(x, y)[1]).toBeCloseTo(4 * 1 - 1, 10);
    expect(derivative(x, y)[2]).toBeCloseTo(4 * 3 - 1, 10);
  });

  it('returns zeros for a series too short or a repeated time', () => {
    expect(derivative([0], [1])).toEqual([0]);
    expect(derivative([0, 0], [1, 2])).toEqual([0, 0]);
  });

  it('is paw_tra retardation: exponential, first point unaveraged', () => {
    const t = md();
    const time = timeAxis(t)!;
    const series = groupTemperature(t, [0, 1, 2, 3], time);
    const smooth = retardedAverage(series.y, series.dt, 4);
    smooth.forEach((v, i) => expect(v).toBeCloseTo(TEMPERATURE_RETARDED_4FS[i]!, 2));
    expect(smooth[0]).toBeCloseTo(series.y[0]!, 10);
  });

  it('leaves the series alone when the time constant is below the point spacing', () => {
    const y = [1, 5, 2];
    expect(retardedAverage(y, [2, 2, 2], 1)).toEqual(y);
    expect(retardedAverage(y, [2, 2, 2], 0)).toEqual(y);
  });

  it('flattens a step by the time constant', () => {
    const y = [0, 0, 10, 10, 10, 10];
    const dt = y.map(() => 1);
    const slow = retardedAverage(y, dt, 20);
    expect(slow[2]).toBeLessThan(1);
    const fast = retardedAverage(y, dt, 1.5);
    expect(fast[2]).toBeGreaterThan(4);
    expect(fast[5]).toBeGreaterThan(slow[5]!);
  });
});

describe('groups and indices', () => {
  it('groups atoms by element, alphabetically', () => {
    expect(elementGroups(['O', 'H', 'H', 'C'])).toEqual([
      { symbol: 'C', indices: [3] },
      { symbol: 'H', indices: [1, 2] },
      { symbol: 'O', indices: [0] },
    ]);
  });

  it('parses indices with ranges and drops what is out of range', () => {
    expect(parseIndices('0 2 4-6', 10)).toEqual([0, 2, 4, 5, 6]);
    expect(parseIndices('3,1, 1', 10)).toEqual([1, 3]);
    expect(parseIndices('6-4', 10)).toEqual([4, 5, 6]);
    expect(parseIndices('0 12 -3 x', 4)).toEqual([0]);
    expect(parseIndices('   ', 4)).toEqual([]);
  });

  it('has a time axis only when every frame carries one', () => {
    expect(timeAxis(md())).toHaveLength(14);
    const t = md();
    t.time[3] = NaN;
    expect(timeAxis(t)).toBeNull();
  });
});
