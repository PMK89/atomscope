/**
 * Sweeps: several calculations that differ in one way, read as one curve.
 *
 * A convergence test asks "where can I stop?", so the plot is only half the answer -- the other
 * half is the smallest x from which the energy holds still, and that is stated rather than left
 * to be read off by eye.
 *
 * Two of the course's sweeps are read off a *fitted* curve instead (Figs 6.6, 6.7): a cubic
 * through energy against scaled lattice constant, and Murnaghan's equation of state through
 * energy against volume. The equation of state gets a chart of its own because it is a function
 * of the volume, not of whatever the sweep happened to vary -- fitting it to a percentage would
 * give a bulk modulus in the wrong units.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type FitKind,
  type SweepCurve,
  type SweepFit,
  type SweepSummary,
} from '../api/client';
import { LineChart, type ChartSeries } from './charts/LineChart';

/** One millihartree in eV: what a total energy is quoted to, and the default tolerance. */
const MILLIHARTREE = 0.0272113838;

const FITS: { label: string; value: 'none' | FitKind }[] = [
  { label: 'none', value: 'none' },
  { label: 'cubic (Fig. 6.6)', value: 'cubic' },
  { label: 'Murnaghan equation of state (Fig. 6.7)', value: 'murnaghan' },
];

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
  const [fitKind, setFitKind] = useState<'none' | FitKind>('none');
  const [volumePerA3, setVolumePerA3] = useState('');
  const [fit, setFit] = useState<SweepFit | null>(null);
  const [fitNote, setFitNote] = useState<string | null>(null);

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

  // The fit follows the curve: a sweep that has just run has different points to fit.
  useEffect(() => {
    if (!selected || fitKind === 'none' || curve === null) {
      setFit(null);
      setFitNote(null);
      return;
    }
    const vbl = volumePerA3.trim() === '' ? undefined : Number(volumePerA3);
    if (vbl !== undefined && !(vbl > 0)) {
      setFit(null);
      setFitNote('The volume per lattice constant cubed has to be a positive number.');
      return;
    }
    let live = true;
    api.sweeps
      .fit(selected, fitKind, vbl)
      .then((f) => {
        if (!live) return;
        setFit(f);
        setFitNote(null);
      })
      .catch((e: Error) => {
        if (!live) return;
        setFit(null);
        // a fit that cannot be made is an ordinary answer here ("too few points", "not
        // periodic"), so it is reported in place rather than raised to the error banner
        setFitNote(e.message);
      });
    return () => {
      live = false;
    };
  }, [selected, fitKind, volumePerA3, curve]);

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
  /** The finished points that also have a cell volume -- the only ones an EOS can be drawn on. */
  const eosPoints = done.filter((p) => p.volume_a3 !== null && p.volume_a3 !== undefined);

  /**
   * How big the basis set actually got at each point. The course draws this in a second panel
   * under the energy (Fig. 8.1): a cutoff convergence is only readable next to the cost of it,
   * and the two counts are what the tutorial's convergence tables list beside every energy.
   */
  const counts: ChartSeries[] = (
    [
      ['plane_waves_wavefunction', 'wave functions', '#2f6fdb'],
      ['plane_waves_density', 'density', '#c2571a'],
    ] as const
  )
    .map(([key, label, color]) => {
      const have = done.filter((p) => p.properties?.[key] !== undefined);
      return {
        id: key,
        label,
        color,
        x: have.map((p) => p.x),
        y: have.map((p) => p.properties![key] as number),
      };
    })
    .filter((series) => series.y.length > 1);
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
      <div className="form-row">
        <label htmlFor="sweep-fit">Fitted curve</label>
        <select
          id="sweep-fit"
          value={fitKind}
          onChange={(e) => setFitKind(e.target.value as 'none' | FitKind)}
        >
          {FITS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      {fitKind === 'murnaghan' && (
        <>
          <div className="form-row">
            <label htmlFor="sweep-vbl">Cell volume / a³</label>
            <input
              id="sweep-vbl"
              value={volumePerA3}
              onChange={(e) => setVolumePerA3(e.target.value)}
              placeholder="leave empty for no lattice constant"
            />
          </div>
          <p className="muted">
            <code>paw_murnaghan.x</code>&apos;s <code>-vbl</code>: 1 for a conventional cubic cell,
            0.25 for the two-atom primitive cell of a face-centred lattice. Without it the
            equilibrium volume is still reported, but no lattice constant is derived from it.
          </p>
        </>
      )}
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
                // the cubic is a function of the sweep's own x, so it belongs on these axes
                ...(fit?.kind === 'cubic'
                  ? [
                      {
                        id: 'cubic',
                        label: 'cubic fit',
                        x: fit.curve.x,
                        y: fit.curve.y,
                        color: '#c2571a',
                        dashed: true,
                      },
                    ]
                  : []),
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
          {fitNote !== null && <p className="muted">{fitNote}</p>}
          {fit?.kind === 'cubic' && fit.cubic && (
            <p className="muted" role="status">
              {fit.cubic.x_min === null || fit.cubic.x_min === undefined
                ? 'The cubic has no minimum in this range — the sweep falls away without turning.'
                : `Minimum at ${axisLabel(curve)} ${fit.cubic.x_min.toFixed(3)}${
                    fit.cubic.extrapolated ? ' — outside the points that were run' : ''
                  }. Residuals ${(fit.rms_ev * 1000).toFixed(2)} meV rms.`}
            </p>
          )}
          {fit?.kind === 'murnaghan' && fit.murnaghan && (
            <>
              <LineChart
                series={[
                  {
                    id: 'eos-points',
                    label: 'total energy',
                    x: eosPoints.map((p) => p.volume_a3 as number),
                    y: eosPoints.map((p) => p.energy_ev as number),
                    color: '#2f6fdb',
                  },
                  {
                    id: 'eos-fit',
                    label: 'Murnaghan',
                    x: fit.curve.x,
                    y: fit.curve.y,
                    color: '#c2571a',
                    dashed: true,
                  },
                ]}
                xLabel="cell volume [Å³]"
                yLabel="total energy [eV]"
                title="Equation of state"
                markers={[{ x: fit.murnaghan.v0_a3, label: 'V₀' }]}
                settingsId="sweeps.eos"
              />
              <p className="muted" role="status">
                B₀ = {fit.murnaghan.b0_gpa.toFixed(2)} GPa · B′ = {fit.murnaghan.bp.toFixed(3)} · V₀
                = {fit.murnaghan.v0_a3.toFixed(3)} Å³
                {fit.murnaghan.lattice_constant_a !== null &&
                  fit.murnaghan.lattice_constant_a !== undefined &&
                  ` · a₀ = ${fit.murnaghan.lattice_constant_a.toFixed(4)} Å`}{' '}
                · E₀ = {fit.murnaghan.e0_ev.toFixed(4)} eV · residuals{' '}
                {(fit.rms_ev * 1000).toFixed(2)} meV rms. Everything is per the cell that was swept.
              </p>
              {fit.murnaghan.extrapolated && (
                <p className="muted">
                  The equilibrium volume lies outside the volumes that were computed, so it is an
                  extrapolation — widen the sweep until the points bracket their own minimum.
                </p>
              )}
            </>
          )}
          {counts.length > 0 && (
            <LineChart
              series={counts}
              xLabel={axisLabel(curve)}
              yLabel="plane waves"
              title="Basis-set size"
            />
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
