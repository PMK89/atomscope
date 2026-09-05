import { useEffect, useMemo } from 'react';
import { api } from '../api/client';
import {
  formatTime,
  frameToStructure,
  trajectoryToJson,
  type LoopMode,
  type TrajectoryData,
} from '../model/trajectory';
import { useStructureStore } from '../state/structureStore';
import { useTrajectoryStore } from '../state/trajectoryStore';

const LOOP_LABELS: Record<LoopMode, string> = { once: 'Once', loop: 'Loop', pingpong: 'Ping-pong' };

/** Energy vs frame as an inline SVG polyline; only the marker depends on the current frame. */
function Sparkline({ t, frame }: { t: TrajectoryData; frame: number }): JSX.Element | null {
  const W = 140;
  const H = 28;
  const geometry = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const e of t.energy) {
      if (Number.isNaN(e)) continue;
      min = Math.min(min, e);
      max = Math.max(max, e);
    }
    if (!Number.isFinite(min)) return null;
    const span = max - min || 1;
    const x = (k: number): number => (t.nFrames > 1 ? (k / (t.nFrames - 1)) * (W - 2) + 1 : W / 2);
    const y = (e: number): number => H - 2 - ((e - min) / span) * (H - 4);
    const points: string[] = [];
    t.energy.forEach((e, k) => {
      if (!Number.isNaN(e)) points.push(`${x(k).toFixed(1)},${y(e).toFixed(1)}`);
    });
    return { points: points.join(' '), x, y };
  }, [t]);
  if (!geometry) return null;
  const e = t.energy[frame] ?? NaN;
  return (
    <svg
      className="trajectory-sparkline"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="energy per frame"
    >
      <polyline points={geometry.points} fill="none" stroke="var(--accent)" strokeWidth="1" />
      <line
        x1={geometry.x(frame)}
        x2={geometry.x(frame)}
        y1={0}
        y2={H}
        stroke="var(--fg)"
        strokeOpacity="0.4"
      />
      {!Number.isNaN(e) && (
        <circle cx={geometry.x(frame)} cy={geometry.y(e)} r="2.5" fill="var(--accent)" />
      )}
    </svg>
  );
}

export function TrajectoryPlayer({
  onError,
}: {
  onError: (msg: string) => void;
}): JSX.Element | null {
  const s = useTrajectoryStore();
  const doc = useStructureStore((st) => st.doc);
  const commit = useStructureStore((st) => st.commit);
  const t = s.trajectory;

  // playback timer: one tick per 1/fps while playing
  useEffect(() => {
    if (!s.playing) return;
    const id = setInterval(() => useTrajectoryStore.getState().tick(), 1000 / s.fps);
    return () => clearInterval(id);
  }, [s.playing, s.fps]);

  if (!t) return null;
  const last = Math.max(t.nFrames - 1, 0);
  const energy = t.energy[s.frame] ?? NaN;
  const temperature = t.temperature[s.frame] ?? NaN;
  const time = t.time[s.frame] ?? NaN;
  const step = t.step[s.frame] ?? NaN;
  const canLoadFrame = doc.atoms.length === t.nAtoms;

  const loadFrame = (): void => {
    const next = frameToStructure(doc, t, s.frame);
    if (next) commit(`load trajectory frame ${s.frame}`, next);
  };

  const exportXyz = async (): Promise<void> => {
    try {
      const res = await api.io.exportTrajectory({ trajectory: trajectoryToJson(t) });
      const blob = new Blob([res.text ?? ''], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${t.name || 'trajectory'}.xyz`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      onError(`Trajectory export failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="trajectory-player" data-testid="trajectory-player">
      <button onClick={() => s.setFrame(0)} title="First frame" aria-label="first frame">
        ⏮
      </button>
      <button onClick={() => s.step(-1)} title="Previous frame" aria-label="previous frame">
        ◀
      </button>
      <button
        onClick={s.togglePlay}
        disabled={t.nFrames <= 1}
        title={s.playing ? 'Pause' : 'Play'}
        aria-label={s.playing ? 'pause' : 'play'}
      >
        {s.playing ? '⏸' : '▶'}
      </button>
      <button onClick={() => s.step(1)} title="Next frame" aria-label="next frame">
        ▶|
      </button>
      <button onClick={() => s.setFrame(last)} title="Last frame" aria-label="last frame">
        ⏭
      </button>
      <input
        type="range"
        min={0}
        max={last}
        value={s.frame}
        aria-label="frame"
        onChange={(e) => s.setFrame(Number(e.target.value))}
      />
      <label>
        fps{' '}
        <input
          type="number"
          min={1}
          max={120}
          value={s.fps}
          aria-label="fps"
          onChange={(e) => s.setFps(Number(e.target.value))}
        />
      </label>
      <select
        value={s.loop}
        aria-label="loop mode"
        onChange={(e) => s.setLoop(e.target.value as LoopMode)}
      >
        {(Object.keys(LOOP_LABELS) as LoopMode[]).map((m) => (
          <option key={m} value={m}>
            {LOOP_LABELS[m]}
          </option>
        ))}
      </select>
      <span className="trajectory-readout">
        <span>
          frame {s.frame + 1}/{t.nFrames}
        </span>
        {!Number.isNaN(step) && <span>step {step}</span>}
        {!Number.isNaN(time) && <span>t = {formatTime(time)}</span>}
        {!Number.isNaN(energy) && <span>E = {energy.toFixed(4)} eV</span>}
        {!Number.isNaN(temperature) && <span>T = {temperature.toFixed(1)} K</span>}
      </span>
      <Sparkline t={t} frame={s.frame} />
      <button
        onClick={loadFrame}
        disabled={!canLoadFrame}
        title="Commit this frame to the structure"
      >
        Load frame as structure
      </button>
      <button onClick={() => void exportXyz()}>Export XYZ</button>
      <button onClick={s.clear} title="Close trajectory" aria-label="close trajectory">
        ✕
      </button>
    </div>
  );
}
