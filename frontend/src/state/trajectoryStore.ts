/**
 * The loaded trajectory, the displayed frame and playback state. The store holds no timer: the
 * player component calls `tick()` at `fps`; `tick` is a pure state transition (see advanceFrame).
 */
import { create } from 'zustand';
import { api } from '../api/client';
import {
  advanceFrame,
  trajectoryFromJson,
  trajectoryFromScalars,
  type ApiTrajectory,
  type LoopMode,
  type TrajectoryData,
} from '../model/trajectory';

export interface TrajectoryState {
  trajectory: TrajectoryData | null;
  frame: number;
  playing: boolean;
  direction: 1 | -1;
  fps: number;
  loop: LoopMode;
  /** Replace the trajectory (typed arrays, e.g. from the binary endpoint or an import). */
  load: (t: TrajectoryData) => void;
  /** Load from anything carrying a JSON trajectory, e.g. a ResultBundle or an import response. */
  loadFromResult: (result: { trajectory?: ApiTrajectory | null }) => void;
  /** Fetch scalars + binary positions of a calculation's trajectory. */
  loadFromCalculation: (calcId: string) => Promise<void>;
  clear: () => void;
  setFrame: (frame: number) => void;
  step: (delta: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  tick: () => void;
  setFps: (fps: number) => void;
  setLoop: (loop: LoopMode) => void;
}

const clampFrame = (frame: number, t: TrajectoryData | null): number =>
  t ? Math.min(Math.max(Math.round(frame), 0), Math.max(t.nFrames - 1, 0)) : 0;

export const useTrajectoryStore = create<TrajectoryState>((set, get) => ({
  trajectory: null,
  frame: 0,
  playing: false,
  direction: 1,
  fps: 15,
  loop: 'loop',
  load: (trajectory) => set({ trajectory, frame: 0, playing: false, direction: 1 }),
  loadFromResult: (result) => {
    if (result.trajectory) get().load(trajectoryFromJson(result.trajectory));
  },
  loadFromCalculation: async (calcId) => {
    const [scalars, positions] = await Promise.all([
      api.calculations.trajectoryScalars(calcId),
      api.calculations.trajectoryPositions(calcId),
    ]);
    get().load(trajectoryFromScalars(scalars, positions));
  },
  clear: () => set({ trajectory: null, frame: 0, playing: false, direction: 1 }),
  setFrame: (frame) => set((s) => ({ frame: clampFrame(frame, s.trajectory) })),
  step: (delta) =>
    set((s) => ({ frame: clampFrame(s.frame + delta, s.trajectory), playing: false })),
  play: () =>
    set((s) => {
      if (!s.trajectory || s.trajectory.nFrames <= 1) return s;
      // restart from the beginning when 'once' playback finished at an end
      const atEnd = s.direction > 0 ? s.frame >= s.trajectory.nFrames - 1 : s.frame <= 0;
      const restart = atEnd && s.loop === 'once';
      return { playing: true, frame: restart ? 0 : s.frame, direction: restart ? 1 : s.direction };
    }),
  pause: () => set({ playing: false }),
  togglePlay: () => (get().playing ? get().pause() : get().play()),
  tick: () =>
    set((s) => {
      if (!s.playing || !s.trajectory) return s;
      return advanceFrame(s.frame, s.direction, s.trajectory.nFrames, s.loop);
    }),
  setFps: (fps) => set({ fps: Math.min(Math.max(fps, 1), 120) }),
  setLoop: (loop) => set({ loop }),
}));
