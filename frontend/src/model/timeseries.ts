/**
 * Time series from a trajectory: internal coordinates, collective modes and per-group
 * temperature -- what CP-PAW's `paw_tra` extracts from a `_r.tra` file.
 *
 * The formulas follow `paw_tra.f90` so the curves match the tool the course uses:
 *
 * - a **mode** is a scaled sum of bond, angle and torsion terms (`MODES`), which is how a
 *   proton-transfer or breathing coordinate is written down: `d(O1-H) - d(O2-H)`;
 * - its **velocity** is the non-uniform central difference of `VELOCITY`;
 * - the **group temperature** is `TEMPERATURE`'s: central differences of the positions give the
 *   velocities (exact for a Verlet propagator, where r(n+1) - r(n-1) = 2 v(n) dt), and the group
 *   gets `g = 3N` degrees of freedom -- the same choice `paw_tra` makes and warns about, since
 *   ignoring the three of the centre of mass underestimates the temperature slightly;
 * - the **running average** is `paw_tra`'s retardation: an exponential average with a time
 *   constant, not a boxcar.
 *
 * Geometry goes through `geometry.ts` rather than being redone here, so a dihedral plotted
 * against time carries the same sign as the same dihedral in the measurement table. Periodicity
 * is handled by unwrapping the chain of atoms -- each successive bond takes its shortest periodic
 * image -- which is what makes a bond across a cell boundary read 1.0 A and not 9.0 A, and
 * reproduces `ase.Atoms.get_distance/get_angle/get_dihedral(mic=True)` exactly.
 *
 * Everything here is pure: no React, no store, no network.
 */
import { elementBySymbol } from './elements';
import { add, angleDeg, dihedralDeg, distance, dot, invert3, mulRow, sub } from './geometry';
import type { Vec3 } from './structure';
import { frameCell, framePositions, type TrajectoryData } from './trajectory';

/** The three internal coordinates a mode can be built from, with the atom count each needs. */
export const TERM_ATOMS = { bond: 2, angle: 3, torsion: 4 } as const;
export type TermKind = keyof typeof TERM_ATOMS;

export interface ModeTerm {
  kind: TermKind;
  /** Atom indices; the angle's vertex is the middle one, as in `paw_tra`'s `!ANGLE`. */
  atoms: number[];
  /** Weight in the sum. A difference coordinate is two bonds with +1 and -1. */
  scale: number;
}

/** A curve against time, with the finite-difference window each point used (fs). */
export interface Series {
  /** fs */
  x: number[];
  y: number[];
  /** the time window the point was formed over, for the retarded average */
  dt: number[];
}

/**
 * One amu A^2/fs^2 expressed in kelvin: (m_u * (1e-10 m)^2 / (1e-15 s)^2) / k_B.
 * = 1.66053906660e-27 * 1e10 / 1.380649e-23. Cross-checked against `ase.units`.
 */
export const KIN_TO_KELVIN = 1202723.9488874401;

/** Positions of `atoms` in `frame`, unwrapped so each successive bond is the shortest image. */
export function micChain(t: TrajectoryData, frame: number, atoms: readonly number[]): Vec3[] {
  const src = framePositions(t, frame);
  const at = (i: number): Vec3 => [src[3 * i]!, src[3 * i + 1]!, src[3 * i + 2]!];
  const cell = frameCell(t, frame);
  const out: Vec3[] = [at(atoms[0]!)];
  for (let k = 1; k < atoms.length; k++) {
    const d = sub(at(atoms[k]!), at(atoms[k - 1]!));
    out.push(add(out[k - 1]!, cell ? minimumImage(d, cell) : d));
  }
  return out;
}

/**
 * The shortest periodic image of displacement `d`.
 *
 * Rounding the fractional coordinates is the whole answer for a cell that is not too skew; the
 * sweep over the 26 neighbours afterwards is what makes it right for one that is, and is
 * `paw_tra`'s own remedy (`BOND`).
 */
export function minimumImage(d: Vec3, cell: readonly [Vec3, Vec3, Vec3]): Vec3 {
  const inv = invert3([cell[0], cell[1], cell[2]]);
  const frac = mulRow(d, inv);
  const wrapped: Vec3 = [
    frac[0] - Math.round(frac[0]),
    frac[1] - Math.round(frac[1]),
    frac[2] - Math.round(frac[2]),
  ];
  let best = mulRow(wrapped, [cell[0], cell[1], cell[2]]);
  let shortest = dot(best, best);
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      for (let k = -1; k <= 1; k++) {
        if (i === 0 && j === 0 && k === 0) continue;
        const shift = mulRow([i, j, k], [cell[0], cell[1], cell[2]]);
        const candidate = add(best, shift);
        const length2 = dot(candidate, candidate);
        if (length2 < shortest - 1e-12) {
          best = candidate;
          shortest = length2;
        }
      }
    }
  }
  return best;
}

/** Unit a term is measured in. */
export function termUnit(kind: TermKind): string {
  return kind === 'bond' ? 'Å' : '°';
}

/** Whether the indices are the right count for the kind and all inside the trajectory. */
export function termIsValid(t: TrajectoryData, term: ModeTerm): boolean {
  if (term.atoms.length !== TERM_ATOMS[term.kind]) return false;
  return term.atoms.every((i) => Number.isInteger(i) && i >= 0 && i < t.nAtoms);
}

/** One internal coordinate through every frame: Å for a bond, degrees for an angle or torsion. */
export function termSeries(t: TrajectoryData, term: ModeTerm): number[] {
  const out: number[] = [];
  for (let f = 0; f < t.nFrames; f++) {
    const q = micChain(t, f, term.atoms);
    out.push(
      term.kind === 'bond'
        ? distance(q[0]!, q[1]!)
        : term.kind === 'angle'
          ? angleDeg(q[0]!, q[1]!, q[2]!)
          : dihedralDeg(q[0]!, q[1]!, q[2]!, q[3]!),
    );
  }
  return out;
}

/**
 * The scaled sum of the terms, `paw_tra`'s `!MODE`. Terms whose indices do not fit the
 * trajectory are skipped rather than throwing, so a half-typed row in a form is harmless.
 */
export function modeSeries(t: TrajectoryData, terms: readonly ModeTerm[]): number[] {
  const out = new Array<number>(t.nFrames).fill(0);
  for (const term of terms) {
    if (!termIsValid(t, term)) continue;
    const values = termSeries(t, term);
    for (let f = 0; f < t.nFrames; f++) out[f] = out[f]! + term.scale * values[f]!;
  }
  return out;
}

/**
 * Unit of a mode: the terms' own when they agree, otherwise none -- a mode mixing a length with
 * an angle has no unit, and `paw_tra` adds them just the same.
 */
export function modeUnit(terms: readonly ModeTerm[]): string {
  const kinds = new Set(terms.map((term) => term.kind));
  if (kinds.size !== 1) return '';
  return termUnit([...kinds][0]!);
}

/**
 * `paw_tra`'s `VELOCITY`: the central difference that allows an uneven time axis, one-sided at
 * the two ends. Returns zero for a point whose neighbour shares its time.
 */
export function derivative(x: readonly number[], y: readonly number[]): number[] {
  const n = Math.min(x.length, y.length);
  const v = new Array<number>(n).fill(0);
  if (n < 2) return v;
  for (let i = 1; i < n - 1; i++) {
    const tp = x[i + 1]! - x[i]!;
    const tm = x[i - 1]! - x[i]!;
    if (tp === 0 || tm === 0) continue;
    const xp = y[i + 1]! - y[i]!;
    const xm = y[i - 1]! - y[i]!;
    v[i] = ((tp / tm) * xm - (tm / tp) * xp) / (tp - tm);
  }
  if (x[1]! !== x[0]!) v[0] = (y[1]! - y[0]!) / (x[1]! - x[0]!);
  if (x[n - 1]! !== x[n - 2]!) v[n - 1] = (y[n - 1]! - y[n - 2]!) / (x[n - 1]! - x[n - 2]!);
  return v;
}

/**
 * How many propagation steps lie between stored frames, or null when the frames do not say.
 *
 * A trajectory written every Nth step still gives a velocity by central differences, but it is
 * the average over 2N steps rather than the instantaneous one, so the kinetic energy -- and the
 * temperature with it -- comes out low by however much the velocity decorrelates in that window.
 * Atomscope's own runs store every step (ASE's `attach` defaults to an interval of one, and
 * CP-PAW's `NWRITE` governs protocol reports, not `_r.tra`), so this is about imported
 * trajectories; the median is taken rather than the first difference because an import may have
 * a ragged step column.
 */
export function frameStride(t: TrajectoryData): number | null {
  if (t.nFrames < 2) return null;
  const gaps: number[] = [];
  for (let f = 1; f < t.nFrames; f++) {
    const gap = t.step[f]! - t.step[f - 1]!;
    if (!Number.isFinite(gap)) return null;
    gaps.push(gap);
  }
  gaps.sort((a, b) => a - b);
  const middle = gaps[Math.floor(gaps.length / 2)]!;
  return middle > 0 ? middle : null;
}

/** The time axis in fs, or null when any frame lacks a time -- nothing here is meaningful then. */
export function timeAxis(t: TrajectoryData): number[] | null {
  if (t.nFrames === 0) return null;
  const out: number[] = [];
  for (let f = 0; f < t.nFrames; f++) {
    const v = t.time[f]!;
    if (!Number.isFinite(v)) return null;
    out.push(v);
  }
  return out;
}

/**
 * Temperature of the atoms in `indices`, frame by frame (`paw_tra`'s `TEMPERATURE`, its group
 * branch). The first and last frame have no central difference and are left out, so the series
 * is two points shorter than the trajectory.
 *
 * The displacement is minimum-imaged: a trajectory whose positions are wrapped into the cell --
 * which is what `ase.io.write` produces from a wrapped `Atoms` -- would otherwise show one atom
 * crossing the boundary as a velocity of a whole cell per step.
 */
export function groupTemperature(
  t: TrajectoryData,
  indices: readonly number[],
  time: readonly number[],
): Series {
  const series: Series = { x: [], y: [], dt: [] };
  if (indices.length === 0 || t.nFrames < 3) return series;
  const masses = indices.map((i) => elementBySymbol(t.symbols[i] ?? 'X').mass);
  for (let f = 1; f < t.nFrames - 1; f++) {
    const dt = time[f + 1]! - time[f - 1]!;
    if (dt === 0) continue;
    const cell = frameCell(t, f);
    const before = framePositions(t, f - 1);
    const after = framePositions(t, f + 1);
    let kinetic = 0;
    indices.forEach((atom, k) => {
      const d: Vec3 = [
        after[3 * atom]! - before[3 * atom]!,
        after[3 * atom + 1]! - before[3 * atom + 1]!,
        after[3 * atom + 2]! - before[3 * atom + 2]!,
      ];
      const step = cell ? minimumImage(d, cell) : d;
      kinetic += 0.5 * masses[k]! * (dot(step, step) / (dt * dt));
    });
    series.x.push(time[f]!);
    series.y.push((kinetic / (1.5 * indices.length)) * KIN_TO_KELVIN);
    series.dt.push(dt);
  }
  return series;
}

/**
 * `paw_tra`'s retardation: an exponential running average with time constant `tauFs`, over a
 * series whose points span `dt` each. A tau below the point spacing leaves the series alone,
 * which is how "no averaging" is expressed.
 */
export function retardedAverage(
  y: readonly number[],
  dt: readonly number[],
  tauFs: number,
): number[] {
  const out: number[] = [];
  let average = 0;
  for (let i = 0; i < y.length; i++) {
    const window = dt[i] ?? 0;
    const alpha = i === 0 || tauFs < window || tauFs <= 0 ? 1 : 1 - Math.exp(-window / tauFs);
    average = alpha * y[i]! + (1 - alpha) * average;
    out.push(average);
  }
  return out;
}

/** The distinct elements of a trajectory with the atoms of each: the groups Fig. 5.4 splits by. */
export function elementGroups(symbols: readonly string[]): { symbol: string; indices: number[] }[] {
  const byElement = new Map<string, number[]>();
  symbols.forEach((symbol, i) => {
    const list = byElement.get(symbol);
    if (list) list.push(i);
    else byElement.set(symbol, [i]);
  });
  return [...byElement.entries()]
    .map(([symbol, indices]) => ({ symbol, indices }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** Atom indices from a text field: "0 1 4-6" or "0,1,4-6". Out-of-range indices are dropped. */
export function parseIndices(text: string, nAtoms: number): number[] {
  const out = new Set<number>();
  for (const token of text.split(/[\s,]+/).filter(Boolean)) {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(token);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      for (let i = Math.min(lo, hi); i <= Math.max(lo, hi); i++) {
        if (i < nAtoms) out.add(i);
      }
      continue;
    }
    const one = Number(token);
    if (Number.isInteger(one) && one >= 0 && one < nAtoms) out.add(one);
  }
  return [...out].sort((a, b) => a - b);
}
