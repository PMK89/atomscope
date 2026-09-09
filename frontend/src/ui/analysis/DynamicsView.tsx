/**
 * Time series from the loaded trajectory: what CP-PAW's `paw_tra` is run for.
 *
 * Two things the course asks of a molecular-dynamics run and a player cannot give. The
 * temperature of a *group* of atoms, which is how a run is judged to have equilibrated and how
 * the light atoms are seen to run hot while the heavy ones lag (ch. 5.7, Fig. 5.4); and an
 * internal coordinate against time, which is how a reaction is read off a trajectory -- a
 * proton transfer is the difference of two bond lengths, and `paw_tra` calls such a combination
 * a mode (ch. 5.8, Figs. 5.5/5.6).
 *
 * The arithmetic is `model/timeseries.ts`; this component only arranges it. The trajectory comes
 * from the trajectory store, so the curve and the animation are always the same frames.
 */
import { useMemo, useState } from 'react';

import { useSelectionStore } from '../../state/selectionStore';
import { useTrajectoryStore } from '../../state/trajectoryStore';
import {
  TERM_ATOMS,
  derivative,
  elementGroups,
  groupTemperature,
  modeSeries,
  modeUnit,
  parseIndices,
  retardedAverage,
  termIsValid,
  timeAxis,
  type ModeTerm,
  type TermKind,
} from '../../model/timeseries';
import { LineChart, type ChartSeries } from '../charts/LineChart';

type Kind = 'temperature' | 'mode';
type Grouping = 'all' | 'element' | 'indices';

const COLORS = ['#2f6fdb', '#e07a3c', '#3cb371', '#9b59b6', '#c0392b', '#0e8b8b'];
const color = (i: number): string => COLORS[i % COLORS.length]!;

const TERM_LABEL: Record<TermKind, string> = {
  bond: 'Bond',
  angle: 'Angle',
  torsion: 'Torsion',
};

export function DynamicsView({ calcId }: { calcId: string }): React.ReactElement {
  const trajectory = useTrajectoryStore((s) => s.trajectory);
  const setFrame = useTrajectoryStore((s) => s.setFrame);
  const selectedAtoms = useSelectionStore((s) => s.atoms);

  const [kind, setKind] = useState<Kind>('temperature');
  const [grouping, setGrouping] = useState<Grouping>('all');
  const [indexText, setIndexText] = useState('');
  const [tau, setTau] = useState(0);
  const [terms, setTerms] = useState<ModeTerm[]>([{ kind: 'bond', atoms: [0, 1], scale: 1 }]);
  const [velocity, setVelocity] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const time = useMemo(() => (trajectory ? timeAxis(trajectory) : null), [trajectory]);

  const groups = useMemo(() => {
    if (!trajectory) return [];
    const all = [...Array(trajectory.nAtoms).keys()];
    if (grouping === 'all') return [{ label: 'All atoms', indices: all }];
    if (grouping === 'element')
      return elementGroups(trajectory.symbols).map((g) => ({
        label: g.symbol,
        indices: g.indices,
      }));
    const picked = parseIndices(indexText, trajectory.nAtoms);
    return picked.length > 0 ? [{ label: `Atoms ${indexText.trim()}`, indices: picked }] : [];
  }, [trajectory, grouping, indexText]);

  const temperatureSeries = useMemo<ChartSeries[]>(() => {
    if (!trajectory || time === null) return [];
    return groups.map((g, i) => {
      const series = groupTemperature(trajectory, g.indices, time);
      return {
        id: g.label,
        label: tau > 0 ? `${g.label} (τ ${tau} fs)` : g.label,
        x: series.x,
        y: tau > 0 ? retardedAverage(series.y, series.dt, tau) : series.y,
        color: color(i),
      };
    });
  }, [trajectory, time, groups, tau]);

  const modeChart = useMemo<{ series: ChartSeries[]; unit: string }>(() => {
    if (!trajectory) return { series: [], unit: '' };
    const valid = terms.filter((term) => termIsValid(trajectory, term));
    if (valid.length === 0) return { series: [], unit: '' };
    const x = time ?? [...Array(trajectory.nFrames).keys()];
    const values = modeSeries(trajectory, valid);
    const base = modeUnit(valid);
    const y = velocity ? derivative(x, values) : values;
    const unit = velocity ? `${base || '1'}/${time ? 'fs' : 'frame'}` : base;
    const dt = x.map((v, i) => (i === 0 ? 0 : v - x[i - 1]!));
    return {
      series: [
        {
          id: 'mode',
          label: velocity ? 'Mode velocity' : 'Mode',
          x,
          y: tau > 0 ? retardedAverage(y, dt, tau) : y,
          color: color(0),
        },
      ],
      unit,
    };
  }, [trajectory, terms, time, velocity, tau]);

  const setTerm = (i: number, patch: Partial<ModeTerm>): void =>
    setTerms((list) => list.map((term, k) => (k === i ? { ...term, ...patch } : term)));

  const addTerm = (): void =>
    setTerms((list) => [...list, { kind: 'bond', atoms: [0, 1], scale: 1 }]);

  const addFromSelection = (): void => {
    const picked = [...selectedAtoms].sort((a, b) => a - b);
    const kindForCount = (Object.keys(TERM_ATOMS) as TermKind[]).find(
      (k) => TERM_ATOMS[k] === picked.length,
    );
    if (!kindForCount) {
      setError('Select two, three or four atoms to make a bond, angle or torsion term.');
      return;
    }
    setError(null);
    setTerms((list) => [...list, { kind: kindForCount, atoms: picked, scale: 1 }]);
  };

  if (!trajectory) {
    return (
      <div className="dynamics-view">
        <p className="muted">
          No trajectory loaded. Load this calculation&apos;s trajectory from the Calculation panel
          to plot a temperature or an internal coordinate against time.
        </p>
        <button
          onClick={() =>
            void useTrajectoryStore
              .getState()
              .loadFromCalculation(calcId)
              .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
          }
        >
          Load trajectory
        </button>
        {error && <p className="form-error">{error}</p>}
      </div>
    );
  }

  const chart = kind === 'temperature' ? temperatureSeries : modeChart.series;

  return (
    <div className="dynamics-view">
      <p className="muted">
        {trajectory.name} · {trajectory.nFrames} frames · {trajectory.nAtoms} atoms
        {time === null && ' · no time axis'}
      </p>

      <div className="form-row">
        <label htmlFor="dynamics-kind">Series</label>
        <select id="dynamics-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          <option value="temperature">Temperature of a group</option>
          <option value="mode">Internal coordinate / mode</option>
        </select>
      </div>

      {kind === 'temperature' && (
        <>
          <div className="form-row">
            <label htmlFor="dynamics-group">Atoms</label>
            <select
              id="dynamics-group"
              value={grouping}
              onChange={(e) => setGrouping(e.target.value as Grouping)}
            >
              <option value="all">All atoms</option>
              <option value="element">One curve per element</option>
              <option value="indices">Chosen indices</option>
            </select>
          </div>
          {grouping === 'indices' && (
            <div className="form-row">
              <label htmlFor="dynamics-indices">Indices</label>
              <input
                id="dynamics-indices"
                value={indexText}
                placeholder="0 2 4-6"
                onChange={(e) => setIndexText(e.target.value)}
              />
            </div>
          )}
          {time === null && (
            <p className="form-error">
              This trajectory carries no time for its frames, so a velocity -- and with it a
              temperature -- cannot be formed. A geometry optimisation has no time axis; a
              molecular-dynamics run does.
            </p>
          )}
        </>
      )}

      {kind === 'mode' && (
        <>
          <table className="mode-terms">
            <thead>
              <tr>
                <th>Term</th>
                <th>Atoms</th>
                <th>Scale</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {terms.map((term, i) => (
                <tr key={i} className={termIsValid(trajectory, term) ? undefined : 'row-invalid'}>
                  <td>
                    <select
                      aria-label={`Term ${i + 1} kind`}
                      value={term.kind}
                      onChange={(e) => {
                        const next = e.target.value as TermKind;
                        const want = TERM_ATOMS[next];
                        const atoms = [...Array(want).keys()].map((k) => term.atoms[k] ?? k);
                        setTerm(i, { kind: next, atoms });
                      }}
                    >
                      {(Object.keys(TERM_ATOMS) as TermKind[]).map((k) => (
                        <option key={k} value={k}>
                          {TERM_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {term.atoms.map((atom, k) => (
                      <input
                        key={k}
                        type="number"
                        className="index-input"
                        aria-label={`Term ${i + 1} atom ${k + 1}`}
                        min={0}
                        max={trajectory.nAtoms - 1}
                        value={atom}
                        onChange={(e) =>
                          setTerm(i, {
                            atoms: term.atoms.map((v, j) => (j === k ? Number(e.target.value) : v)),
                          })
                        }
                      />
                    ))}
                  </td>
                  <td>
                    <input
                      type="number"
                      className="index-input"
                      aria-label={`Term ${i + 1} scale`}
                      step={0.5}
                      value={term.scale}
                      onChange={(e) => setTerm(i, { scale: Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <button
                      aria-label={`Remove term ${i + 1}`}
                      onClick={() => setTerms((list) => list.filter((_, k) => k !== i))}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="term-actions">
            <button onClick={addTerm}>Add term</button>
            <button onClick={addFromSelection}>Add from selection</button>
            <label className="form-advanced-toggle">
              <input
                type="checkbox"
                checked={velocity}
                onChange={(e) => setVelocity(e.target.checked)}
              />
              Plot the time derivative
            </label>
          </div>
          <p className="muted">
            A mode is the scaled sum of its terms, as <code>paw_tra</code> defines one: a proton
            transfer is two bonds with scales +1 and −1. The angle&apos;s vertex is its middle atom.
            Bonds are in Å, angles and torsions in degrees, and each is taken across the shortest
            periodic image.
          </p>
        </>
      )}

      <div className="form-row">
        <label htmlFor="dynamics-tau">Running average τ (fs)</label>
        <input
          id="dynamics-tau"
          type="number"
          min={0}
          step={10}
          value={tau}
          onChange={(e) => setTau(Math.max(0, Number(e.target.value)))}
        />
      </div>

      {error && <p className="form-error">{error}</p>}

      {chart.length === 0 || chart[0]!.x.length === 0 ? (
        <p className="muted">Nothing to plot yet.</p>
      ) : (
        <LineChart
          series={chart}
          xLabel={time === null ? 'frame' : 'fs'}
          yLabel={kind === 'temperature' ? 'K' : modeChart.unit}
          title={`${kind === 'temperature' ? 'Group temperature' : 'Mode'}${
            tau > 0 ? ` · τ ${tau} fs` : ''
          }`}
          settingsId={`analysis.dynamics.${kind}`}
          onPick={(x) => {
            if (time === null) {
              setFrame(Math.round(x));
              return;
            }
            // the nearest frame to the picked time, so clicking a feature shows the geometry
            let best = 0;
            time.forEach((t, i) => {
              if (Math.abs(t - x) < Math.abs(time[best]! - x)) best = i;
            });
            setFrame(best);
          }}
        />
      )}
      <p className="muted">
        The temperature uses g = 3N degrees of freedom for the group, as <code>paw_tra</code>
        does; ignoring the three of the centre of mass underestimates it slightly. The running
        average is <code>paw_tra</code>&apos;s retardation: exponential with time constant τ, and τ
        = 0 leaves the series raw. Clicking the chart shows that frame in the viewport.
      </p>
    </div>
  );
}
