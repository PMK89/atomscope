/**
 * Sweeps: several calculations that differ in one way, read as one curve.
 *
 * A convergence test asks "where can I stop?", so the plot is only half the answer -- the other
 * half is the smallest x from which the energy holds still, and that is stated rather than left
 * to be read off by eye.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type SweepCurve, type SweepSummary } from '../api/client';
import { LineChart } from './charts/LineChart';

/** One millihartree in eV: what a total energy is quoted to, and the default tolerance. */
const MILLIHARTREE = 0.0272113838;

const TOLERANCES: { label: string; value: number }[] = [
  { label: '1 mH', value: MILLIHARTREE },
  { label: '0.1 mH', value: MILLIHARTREE / 10 },
  { label: '10 meV', value: 0.01 },
  { label: '1 meV', value: 0.001 },
];

function axisLabel(curve: SweepCurve): string {
  const { label, unit } = curve.result;
  return unit ? `${label} [${unit}]` : label;
}

export function SweepPanel({ onError }: { onError: (m: string) => void }): JSX.Element {
  const [sweeps, setSweeps] = useState<SweepSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [curve, setCurve] = useState<SweepCurve | null>(null);
  const [tolerance, setTolerance] = useState(MILLIHARTREE);
  const [running, setRunning] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await api.sweeps.list();
      setSweeps(list);
      setSelected((s) => s ?? list[0]?.sweep_id ?? null);
    } catch (e) {
      onError((e as Error).message);
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selected) {
      setCurve(null);
      return;
    }
    api.sweeps
      .get(selected, tolerance)
      .then(setCurve)
      .catch((e: Error) => onError(e.message));
  }, [selected, tolerance, onError]);

  const run = async (): Promise<void> => {
    if (!selected) return;
    setRunning(true);
    try {
      // one point at a time on the server, so this resolves when the last one has finished
      setCurve(await api.sweeps.run(selected));
      await refresh();
    } catch (e) {
      onError(`Sweep failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  if (sweeps.length === 0) {
    return (
      <div className="panel-body">
        <p className="muted">
          No sweeps in this project. A sweep is several calculations that differ in one way — a
          cutoff, a cell size, a volume — plotted against that one number.
        </p>
      </div>
    );
  }

  const done = curve?.result.points.filter((p) => p.energy_ev !== null) ?? [];
  const pending = curve?.result.points.filter((p) => p.energy_ev === null) ?? [];

  return (
    <div className="panel-body">
      <div className="form-row">
        <label htmlFor="sweep-select">Sweep</label>
        <select
          id="sweep-select"
          value={selected ?? ''}
          onChange={(e) => setSelected(e.target.value)}
        >
          {sweeps.map((s) => (
            <option key={s.sweep_id} value={s.sweep_id}>
              {s.label} ({s.completed}/{s.points})
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="sweep-tolerance">Converged within</label>
        <select
          id="sweep-tolerance"
          value={tolerance}
          onChange={(e) => setTolerance(Number(e.target.value))}
        >
          {TOLERANCES.map((t) => (
            <option key={t.label} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="button-row">
        <button className="primary" onClick={() => void run()} disabled={running}>
          {running ? 'Running…' : 'Run remaining points'}
        </button>
      </div>

      {curve && (
        <>
          {done.length > 1 ? (
            <LineChart
              series={[
                {
                  id: 'energy',
                  label: 'total energy',
                  x: done.map((p) => p.x),
                  y: done.map((p) => p.energy_ev as number),
                  color: '#2f6fdb',
                },
              ]}
              xLabel={axisLabel(curve)}
              yLabel="total energy [eV]"
              title="Convergence"
              markers={
                curve.converged_from === null || curve.converged_from === undefined
                  ? []
                  : [{ x: curve.converged_from, label: 'converged' }]
              }
            />
          ) : (
            <p className="muted">
              {done.length === 1
                ? 'One point so far — a curve needs at least two.'
                : 'Nothing has run yet.'}
            </p>
          )}
          <p className="muted" role="status">
            {curve.converged_from === null || curve.converged_from === undefined
              ? done.length > 1
                ? `Not settled within ${(curve.tolerance_ev / MILLIHARTREE).toFixed(2)} mH anywhere in this range — the sweep needs to go further, or something other than ${curve.result.label.toLowerCase()} is moving the energy.`
                : ''
              : `Settled from ${curve.result.label.toLowerCase()} ${curve.converged_from}${curve.result.unit ? ` ${curve.result.unit}` : ''} onwards, within ${(curve.tolerance_ev / MILLIHARTREE).toFixed(2)} mH.`}
          </p>
          {pending.length > 0 && (
            <p className="muted">
              {pending.length} point{pending.length === 1 ? '' : 's'} still to run.
            </p>
          )}
        </>
      )}
    </div>
  );
}
