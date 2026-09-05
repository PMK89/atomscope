/**
 * Frontend view of a backend Trajectory: positions live in one Float32Array (frames x atoms x 3),
 * per-frame scalars in Float64Arrays (NaN = missing). Everything here is pure; no React, no Three.
 */
import type { components } from '../api/schema';
import type { StructureDoc, Vec3 } from './structure';

export type ApiTrajectory = components['schemas']['Trajectory'];
export type ApiFrame = components['schemas']['Frame'];
export type TrajectoryScalars = components['schemas']['TrajectoryScalars'];
export type Mat3 = [Vec3, Vec3, Vec3];
export type LoopMode = 'once' | 'loop' | 'pingpong';

export interface TrajectoryData {
  id: string;
  name: string;
  kind: string;
  symbols: string[];
  nFrames: number;
  nAtoms: number;
  /** nFrames * nAtoms * 3, Å */
  positions: Float32Array;
  /** One cell per frame, or null when no frame carries a cell. */
  cells: (Mat3 | null)[] | null;
  /** eV, NaN where missing */
  energy: Float64Array;
  /** fs, NaN where missing */
  time: Float64Array;
  /** K, NaN where missing */
  temperature: Float64Array;
  /** NaN where missing */
  step: Float64Array;
}

const toArray = (values: readonly (number | null | undefined)[]): Float64Array =>
  Float64Array.from(values, (v) => (v == null ? NaN : v));

export function framePositions(t: TrajectoryData, frame: number): Float32Array {
  const n = t.nAtoms * 3;
  return t.positions.subarray(frame * n, (frame + 1) * n);
}

export function frameCell(t: TrajectoryData, frame: number): Mat3 | null {
  return t.cells?.[frame] ?? null;
}

export function trajectoryFromJson(traj: ApiTrajectory): TrajectoryData {
  const frames = traj.frames ?? [];
  const nAtoms = traj.symbols.length;
  const positions = new Float32Array(frames.length * nAtoms * 3);
  frames.forEach((f, k) => {
    const base = k * nAtoms * 3;
    f.positions.forEach((p, i) => {
      positions[base + 3 * i] = p[0];
      positions[base + 3 * i + 1] = p[1];
      positions[base + 3 * i + 2] = p[2];
    });
  });
  const cells = frames.map((f) => f.cell ?? null);
  return {
    id: traj.id,
    name: traj.name,
    kind: traj.kind,
    symbols: [...traj.symbols],
    nFrames: frames.length,
    nAtoms,
    positions,
    cells: cells.some((c) => c !== null) ? cells : null,
    energy: toArray(frames.map((f) => f.energy)),
    time: toArray(frames.map((f) => f.time)),
    temperature: toArray(frames.map((f) => f.temperature)),
    step: toArray(frames.map((f) => f.step)),
  };
}

/** Combine the scalars endpoint with the binary positions stream. */
export function trajectoryFromScalars(
  sc: TrajectoryScalars,
  positions: Float32Array,
): TrajectoryData {
  if (positions.length !== sc.n_frames * sc.n_atoms * 3) {
    throw new Error(
      `positions length ${positions.length} does not match ${sc.n_frames} frames x ${sc.n_atoms} atoms`,
    );
  }
  return {
    id: sc.id,
    name: sc.name,
    kind: sc.kind,
    symbols: [...sc.symbols],
    nFrames: sc.n_frames,
    nAtoms: sc.n_atoms,
    positions,
    cells: sc.cells.some((c) => c !== null) ? sc.cells : null,
    energy: toArray(sc.energy),
    time: toArray(sc.time),
    temperature: toArray(sc.temperature),
    step: toArray(sc.step),
  };
}

const orNull = (v: number | undefined): number | null => (v == null || Number.isNaN(v) ? null : v);

export function trajectoryToJson(t: TrajectoryData): ApiTrajectory {
  const frames: ApiFrame[] = [];
  for (let k = 0; k < t.nFrames; k++) {
    const src = framePositions(t, k);
    const positions: Vec3[] = [];
    for (let i = 0; i < t.nAtoms; i++)
      positions.push([src[3 * i]!, src[3 * i + 1]!, src[3 * i + 2]!]);
    frames.push({
      positions,
      cell: frameCell(t, k),
      energy: orNull(t.energy[k]),
      time: orNull(t.time[k]),
      temperature: orNull(t.temperature[k]),
      step: orNull(t.step[k]),
    });
  }
  return { id: t.id, name: t.name, kind: t.kind, symbols: [...t.symbols], frames };
}

/** The document with atom positions (and cell, if the frame has one) replaced by frame `k`. */
export function frameToStructure(
  doc: StructureDoc,
  t: TrajectoryData,
  k: number,
): StructureDoc | null {
  if (doc.atoms.length !== t.nAtoms || k < 0 || k >= t.nFrames) return null;
  const src = framePositions(t, k);
  const atoms = doc.atoms.map((a, i) => ({
    ...a,
    position: [src[3 * i]!, src[3 * i + 1]!, src[3 * i + 2]!] as Vec3,
  }));
  const cell = frameCell(t, k);
  return {
    ...doc,
    atoms,
    cell: cell ? { vectors: cell, pbc: doc.cell?.pbc ?? [true, true, true] } : doc.cell,
  };
}

export interface PlaybackStep {
  frame: number;
  direction: 1 | -1;
  playing: boolean;
}

/** One playback tick: the next frame under the loop mode, or stop at the end for 'once'. */
export function advanceFrame(
  frame: number,
  direction: 1 | -1,
  nFrames: number,
  loop: LoopMode,
): PlaybackStep {
  if (nFrames <= 1) return { frame: 0, direction, playing: false };
  const last = nFrames - 1;
  let next = frame + direction;
  if (next >= 0 && next <= last) return { frame: next, direction, playing: true };
  switch (loop) {
    case 'once':
      return { frame: Math.min(Math.max(frame, 0), last), direction, playing: false };
    case 'loop':
      next = direction > 0 ? 0 : last;
      return { frame: next, direction, playing: true };
    case 'pingpong': {
      const flipped: 1 | -1 = direction > 0 ? -1 : 1;
      return { frame: frame + flipped, direction: flipped, playing: true };
    }
  }
}

/** Time label in fs or ps for a readout. */
export function formatTime(fs: number): string {
  if (Number.isNaN(fs)) return '–';
  return Math.abs(fs) >= 1000 ? `${(fs / 1000).toFixed(3)} ps` : `${fs.toFixed(1)} fs`;
}
