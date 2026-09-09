/**
 * Results analysis for the selected calculation: convergence traces, the Kohn-Sham orbital
 * browser (with on-demand cube export), density of states and band structure.
 *
 * All scientific data comes from the backend; this component only arranges it. Orbital cubes are
 * produced by a post-processing job, so "Show" may take a while and reports through the job
 * console like any other run.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  type BandStructure,
  type Calculation,
  type DosSpectrum,
  type KPathPoint,
  type OrbitalEntry,
  type OrbitalList,
} from '../api/client';
import { stackedDosSeries } from '../model/dosStack';
import { partitionRunSeries } from '../model/runSeries';
import { bandSeries, formatKPath } from '../model/bands';
import { useCalculationStore } from '../state/calculationStore';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import { coopsForBonds } from './coopRequests';
import { useVolumetricStore } from '../state/volumetricStore';
import {
  LineChart,
  type ChartMarker,
  type ChartSeries,
  type ChartYMarker,
} from './charts/LineChart';
import { channelOrbitals, channels, homoIndex, lumoIndex, stepIndex } from './analysis/orbitals';
import { ProtocolView } from './analysis/ProtocolView';
import { PlanesView } from './analysis/PlanesView';

type Section = 'convergence' | 'orbitals' | 'dos' | 'bands' | 'planes' | 'protocol';

const SERIES_COLORS = ['#2f6fdb', '#e07a3c', '#3cb371', '#9b59b6', '#c0392b'];
const SPIN_COLORS = ['#2f6fdb', '#c0392b'];
/** Figs. 6.4/6.9: filled bands dark, the ones the Fermi level crosses picked out, empty faint. */
const BAND_PALETTE = { occupied: '#333', partial: '#3cb371', empty: '#9aa6b8' };

function seriesColor(i: number): string {
  return SERIES_COLORS[i % SERIES_COLORS.length]!;
}

/** Poll a calculation until its job leaves the active states. */
async function waitForJob(
  calcId: string,
  onUpdate: (c: Calculation) => void,
): Promise<Calculation> {
  for (;;) {
    const calc = await api.calculations.get(calcId);
    onUpdate(calc);
    if (calc.status !== 'queued' && calc.status !== 'running') return calc;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
}

export function AnalysisPanel({ onError }: { onError: (m: string) => void }): JSX.Element {
  const selected = useCalculationStore((s) => s.calculations.find((c) => c.id === s.selectedId));
  const upsert = useCalculationStore((s) => s.upsert);
  const doc = useStructureStore((s) => s.doc);
  const selectedBonds = useSelectionStore((s) => s.bonds);
  const loadGrid = useVolumetricStore((s) => s.loadGrid);
  const addSurface = useVolumetricStore((s) => s.addSurface);

  const [section, setSection] = useState<Section>('convergence');
  const [logY, setLogY] = useState(true);
  const [orbitals, setOrbitals] = useState<OrbitalList | null>(null);
  const [kpoint, setKpoint] = useState(1);
  const [spin, setSpin] = useState(1);
  const [row, setRow] = useState(-1);
  const [busy, setBusy] = useState<string | null>(null);
  const [dos, setDos] = useState<DosSpectrum | null>(null);
  const [broadening, setBroadening] = useState(0.1);
  const [projection, setProjection] = useState<'none' | 'element' | 'atom'>('element');
  const [withCoops, setWithCoops] = useState(false);
  const [stackDos, setStackDos] = useState(true);
  const [bands, setBands] = useState<BandStructure | null>(null);
  const [path, setPath] = useState<KPathPoint[] | null>(null);
  const [nk, setNk] = useState(20);

  const calcId = selected?.id ?? null;
  const isCppaw = selected?.backend_id === 'cppaw';
  const done = selected?.status === 'completed';
  const fail = useCallback((e: unknown) => onError((e as Error).message), [onError]);

  // reset per-calculation state when the selection changes
  useEffect(() => {
    setOrbitals(null);
    setDos(null);
    setBands(null);
    setPath(null);
    setRow(-1);
  }, [calcId]);

  useEffect(() => {
    if (!calcId || !isCppaw || !done || section !== 'orbitals' || orbitals) return;
    api.cppaw.orbitals(calcId).then(setOrbitals).catch(fail);
  }, [calcId, isCppaw, done, section, orbitals, fail]);

  // A DOS already computed in this calculation's work directory is still there: reopening the
  // project used to say "No DOS computed yet" over a finished one, and recomputing it would
  // overwrite the control file -- losing any COOP or local-frame orbital it had been asked for.
  useEffect(() => {
    if (!calcId || !isCppaw || !done || section !== 'dos' || dos) return;
    api.cppaw
      .dos(calcId)
      .then(setDos)
      .catch(() => setDos(null)); // none computed yet is the ordinary case, not an error
  }, [calcId, isCppaw, done, section, dos]);

  useEffect(() => {
    if (!calcId || !isCppaw || !done || section !== 'bands' || path) return;
    api.cppaw
      .bandPath(calcId)
      .then((p) => setPath(p.points))
      .catch(() => setPath([]));
  }, [calcId, isCppaw, done, section, path]);

  // and likewise a band structure already computed: recomputing it is minutes of work for a
  // picture that is sitting in the work directory, which is what an example project is made of
  useEffect(() => {
    if (!calcId || !isCppaw || !done || section !== 'bands' || bands) return;
    api.cppaw
      .bands(calcId)
      .then(setBands)
      .catch(() => setBands(null)); // none computed yet is the ordinary case, not an error
  }, [calcId, isCppaw, done, section, bands]);

  const rows = useMemo(
    () => (orbitals ? channelOrbitals(orbitals.orbitals, kpoint, spin) : []),
    [orbitals, kpoint, spin],
  );
  const available = useMemo(
    () => (orbitals ? channels(orbitals.orbitals) : { kpoints: [1], spins: [1] }),
    [orbitals],
  );

  const charts = useMemo(() => partitionRunSeries(selected?.results?.series ?? []), [selected]);
  const { temperature } = charts;

  const convergence: ChartSeries[] = useMemo(
    () =>
      charts.convergence.map((s, i) => ({
        id: s.name,
        label: `${s.y_label} [${s.y_unit}]`,
        x: s.x,
        y: s.y,
        color: seriesColor(i),
      })),
    [charts],
  );

  /** What the thermostats are doing, against time: the course's Figs 5.1 and 5.2 in one chart. */
  const friction: ChartSeries[] = useMemo(
    () =>
      charts.friction.map((s, i) => ({
        id: s.name,
        label: s.y_label,
        x: s.x,
        y: s.y,
        color: seriesColor(i + 1),
      })),
    [charts],
  );

  const showOrbital = async (entry: OrbitalEntry): Promise<void> => {
    if (!calcId) return;
    setBusy(`orbital ${entry.band}`);
    try {
      let gridId = entry.grid_id;
      if (!gridId) {
        const started = await api.cppaw.exportOrbitals(calcId, {
          orbitals: [{ band: entry.band, kpoint: entry.kpoint, spin: entry.spin }],
        });
        upsert(started);
        const finished = await waitForJob(calcId, upsert);
        if (finished.status !== 'completed') {
          throw new Error(`orbital export ${finished.status}: ${finished.job?.error ?? ''}`);
        }
        const refreshed = await api.cppaw.orbitals(calcId);
        setOrbitals(refreshed);
        gridId =
          refreshed.orbitals.find(
            (o) => o.band === entry.band && o.kpoint === entry.kpoint && o.spin === entry.spin,
          )?.grid_id ?? null;
      }
      if (!gridId) throw new Error('no cube was produced for this orbital');
      await loadGrid(gridId, calcId);
      addSurface(gridId);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const runDos = async (): Promise<void> => {
    if (!calcId) return;
    setBusy('dos');
    try {
      upsert(
        await api.cppaw.requestDos(calcId, {
          broadening_ev: broadening,
          de_ev: 0.01,
          projection,
          l_channels: true,
          coops: withCoops ? coops : [],
        }),
      );
      const finished = await waitForJob(calcId, upsert);
      if (finished.status !== 'completed') throw new Error(`DOS job ${finished.status}`);
      setDos(await api.cppaw.dos(calcId));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const runBands = async (): Promise<void> => {
    if (!calcId) return;
    setBusy('bands');
    try {
      upsert(
        await api.cppaw.requestBands(calcId, {
          mode: 'interpolate',
          nk,
          ...(path && path.length > 0 ? { path } : {}),
        }),
      );
      const finished = await waitForJob(calcId, upsert);
      if (finished.status !== 'completed') throw new Error(`band job ${finished.status}`);
      setBands(await api.cppaw.bands(calcId));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  /**
   * A COOP is a population, not a count of states: it goes negative where the two orbitals are
   * antibonding, and it is one or two tenths where a density of states is several. Put on the
   * same axis it would be a flat line at zero, so the two get a chart each.
   */
  const dosCharts: { dos: ChartSeries[]; coop: ChartSeries[] } = useMemo(() => {
    if (!dos) return { dos: [], coop: [] };
    const asSeries = (s: (typeof dos.series)[number], i: number): ChartSeries => ({
      id: `${s.id}-${s.spin}`,
      label: s.spin === 'none' ? s.label : `${s.label} (${s.spin})`,
      x: dos.energies,
      // CP-PAW writes spin-down with a negative sign already; keep the file's convention
      y: s.dos,
      color: s.spin === 'down' ? SPIN_COLORS[1]! : seriesColor(i),
      dashed: s.spin === 'down',
    });
    return {
      dos: dos.series.filter((s) => s.kind !== 'coop').map(asSeries),
      coop: dos.series.filter((s) => s.kind === 'coop').map(asSeries),
    };
  }, [dos]);

  const dosLevel = dos?.fermi_level ?? dos?.homo_energy ?? undefined;

  /** The course's own DOS shape: the projections filled and stacked under the total's outline. */
  const stackedDos: ChartSeries[] = useMemo(() => {
    if (!dos) return [];
    // One colour per weight, both spins: the two halves of a projection are told apart by which
    // side of zero they are on, which is what CP-PAW's negative spin-down values already give us.
    // The total is not one series among the others but the envelope they add up to, so it keeps a
    // fixed dark colour -- the course's captions call it the black outline.
    const { stacked, outlines } = stackedDosSeries(dos, dosLevel, (s, i) =>
      s.id === 'total' ? '#333' : seriesColor(i),
    );
    return [...stacked, ...outlines];
  }, [dos, dosLevel]);

  const canStack = stackedDos.some((s) => s.baseline !== undefined);
  const dosSeries = stackDos && canStack ? stackedDos : dosCharts.dos;

  /** Overlap populations for the bonds currently selected in the viewport. */
  const coops = useMemo(() => coopsForBonds(doc, selectedBonds), [doc, selectedBonds]);

  const dosMarkers: ChartMarker[] = useMemo(
    () =>
      dosLevel === undefined
        ? []
        : [{ x: dosLevel, label: dos?.fermi_level != null ? 'E_F' : 'HOMO' }],
    [dos, dosLevel],
  );

  const bandChartSeries: ChartSeries[] = useMemo(
    () => (bands ? bandSeries(bands, BAND_PALETTE) : []),
    [bands],
  );

  /** The level every band is classified against, named for which of the two it is. */
  const bandMarkers: ChartYMarker[] = useMemo(() => {
    const level = bands?.fermi_level ?? bands?.homo_energy;
    if (level == null) return [];
    return [{ y: level, label: bands?.fermi_level != null ? 'E_F' : 'HOMO' }];
  }, [bands]);

  if (!selected) {
    return (
      <div className="panel">
        <p className="muted">Select a calculation to analyse its results.</p>
      </div>
    );
  }

  return (
    <div className="panel analysis-panel">
      <div className="tabs">
        {(['convergence', 'orbitals', 'dos', 'bands', 'planes', 'protocol'] as const).map((s) => (
          <button
            key={s}
            className={section === s ? 'tab active' : 'tab'}
            onClick={() => setSection(s)}
          >
            {s === 'dos'
              ? 'DOS'
              : s === 'bands'
                ? 'Bands'
                : s === 'orbitals'
                  ? 'Orbitals'
                  : s === 'protocol'
                    ? 'Protocol'
                    : s === 'planes'
                      ? 'Planes'
                      : 'Convergence'}
          </button>
        ))}
      </div>
      <p className="muted">
        {selected.name} ·{' '}
        <span className={`badge badge-${selected.status}`}>{selected.status}</span>
        {busy && <> · running {busy}…</>}
      </p>

      {section === 'convergence' && (
        <>
          {convergence.length === 0 ? (
            <p className="muted">No convergence data yet.</p>
          ) : (
            <>
              <label className="form-advanced-toggle">
                <input type="checkbox" checked={logY} onChange={(e) => setLogY(e.target.checked)} />
                Logarithmic y axis
              </label>
              <LineChart
                series={convergence.filter((s) => s.id !== 'energy')}
                logY={logY}
                xLabel="step"
                yLabel="eV"
                title="Convergence"
                settingsId="analysis.convergence"
              />
              <LineChart
                series={convergence.filter((s) => s.id === 'energy')}
                xLabel="step"
                yLabel="total energy [eV]"
                title="Total energy"
                settingsId="analysis.energy"
              />
              {temperature && (
                <LineChart
                  series={[
                    {
                      id: 'temperature',
                      label: 'temperature',
                      x: temperature.x,
                      y: temperature.y,
                      color: seriesColor(3),
                    },
                  ]}
                  xLabel={`time [${temperature.x_unit}]`}
                  yLabel="T [K]"
                  title="Temperature"
                  settingsId="analysis.temperature"
                />
              )}
              {friction.length > 0 && (
                <LineChart
                  series={friction}
                  xLabel="time [ps]"
                  yLabel="friction"
                  title="Thermostat friction"
                  settingsId="analysis.friction"
                />
              )}
            </>
          )}
        </>
      )}

      {section === 'orbitals' && (
        <>
          {!isCppaw || !done ? (
            <p className="muted">Orbitals are available for completed CP-PAW calculations.</p>
          ) : (
            <>
              <div className="form-row">
                <label htmlFor="orb-k">k-point</label>
                <select
                  id="orb-k"
                  value={kpoint}
                  onChange={(e) => setKpoint(Number(e.target.value))}
                >
                  {available.kpoints.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              {available.spins.length > 1 && (
                <div className="form-row">
                  <label htmlFor="orb-s">spin</label>
                  <select id="orb-s" value={spin} onChange={(e) => setSpin(Number(e.target.value))}>
                    {available.spins.map((s) => (
                      <option key={s} value={s}>
                        {s === 1 ? 'up' : 'down'}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="button-row">
                <button onClick={() => setRow(homoIndex(rows))} disabled={rows.length === 0}>
                  HOMO
                </button>
                <button onClick={() => setRow(lumoIndex(rows))} disabled={rows.length === 0}>
                  LUMO
                </button>
                <button
                  onClick={() => setRow(stepIndex(row, -1, rows.length))}
                  disabled={rows.length === 0}
                >
                  −
                </button>
                <button
                  onClick={() => setRow(stepIndex(row, 1, rows.length))}
                  disabled={rows.length === 0}
                >
                  +
                </button>
                <button
                  className="primary"
                  disabled={row < 0 || busy !== null}
                  onClick={() => void (rows[row] && showOrbital(rows[row]!))}
                >
                  Show
                </button>
              </div>
              <table className="orbital-table">
                <thead>
                  <tr>
                    <th>band</th>
                    <th>E [eV]</th>
                    <th>occ.</th>
                    <th>label</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o, i) => (
                    <tr
                      key={`${o.band}-${o.kpoint}-${o.spin}`}
                      className={
                        i === row
                          ? 'selected'
                          : o.label === 'HOMO' || o.label === 'LUMO'
                            ? 'frontier'
                            : ''
                      }
                      onClick={() => setRow(i)}
                    >
                      <td>{o.band}</td>
                      <td>{o.energy.toFixed(3)}</td>
                      <td>{o.occupation.toFixed(2)}</td>
                      <td>
                        {o.label}
                        {o.grid_id ? ' ●' : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && <p className="muted">No eigenvalues in this calculation.</p>}
            </>
          )}
        </>
      )}

      {section === 'dos' && (
        <>
          {!isCppaw || !done ? (
            <p className="muted">
              The density of states is computed for completed CP-PAW calculations.
            </p>
          ) : (
            <>
              <div className="form-row">
                <label htmlFor="dos-broad">Broadening [eV]</label>
                <input
                  id="dos-broad"
                  type="number"
                  step="0.01"
                  min="0.001"
                  value={broadening}
                  onChange={(e) => setBroadening(Number(e.target.value))}
                />
              </div>
              <div className="form-row">
                <label htmlFor="dos-proj">Projection</label>
                <select
                  id="dos-proj"
                  value={projection}
                  onChange={(e) => setProjection(e.target.value as typeof projection)}
                >
                  <option value="none">Total only</option>
                  <option value="element">Per element</option>
                  <option value="atom">Per atom</option>
                </select>
              </div>
              <label className="form-advanced-toggle">
                <input
                  type="checkbox"
                  checked={stackDos}
                  disabled={!canStack}
                  onChange={(e) => setStackDos(e.target.checked)}
                />
                Stack the projections under the total
              </label>
              <label className="form-advanced-toggle">
                <input
                  type="checkbox"
                  checked={withCoops}
                  disabled={coops.length === 0}
                  onChange={(e) => setWithCoops(e.target.checked)}
                />
                Overlap population for the selected bond
                {coops.length === 1 ? '' : 's'}
                {coops.length === 0 && ' (select a bond first)'}
              </label>
              {withCoops && coops.length > 0 && (
                <p className="muted">
                  {coops.map((c) => c.label).join(', ')} — a hybrid along the bond against
                  hydrogen&apos;s s orbital, which is the tutorial&apos;s own choice.
                </p>
              )}
              <div className="button-row">
                <button className="primary" onClick={() => void runDos()} disabled={busy !== null}>
                  Compute DOS
                </button>
              </div>
              {dos ? (
                <>
                  <LineChart
                    series={dosSeries}
                    markers={dosMarkers}
                    zeroLine
                    xLabel="E [eV]"
                    yLabel="DOS [states/eV]"
                    title="Density of states"
                    settingsId="analysis.dos"
                    height={240}
                  />
                  {dosCharts.coop.length > 0 && (
                    <>
                      <LineChart
                        series={dosCharts.coop}
                        markers={dosMarkers}
                        zeroLine
                        xLabel="E [eV]"
                        yLabel="COOP"
                        title="Crystal-orbital overlap population"
                        settingsId="analysis.coop"
                        height={200}
                      />
                      <p className="muted">
                        Positive where the two orbitals are bonding, negative where they are
                        antibonding.
                      </p>
                    </>
                  )}
                </>
              ) : (
                <p className="muted">No DOS computed yet.</p>
              )}
            </>
          )}
        </>
      )}

      {section === 'bands' && (
        <>
          {!isCppaw || !done ? (
            <p className="muted">Band structures are computed for completed CP-PAW calculations.</p>
          ) : (
            <>
              <div className="form-row">
                <label htmlFor="band-nk">k-points per segment</label>
                <input
                  id="band-nk"
                  type="number"
                  min="2"
                  value={nk}
                  onChange={(e) => setNk(Math.max(2, Math.round(Number(e.target.value))))}
                />
              </div>
              <p className="muted">
                Path: {path && path.length > 0 ? formatKPath(path) : 'default for this lattice'}
              </p>
              <div className="button-row">
                <button
                  className="primary"
                  onClick={() => void runBands()}
                  disabled={busy !== null}
                >
                  Compute bands
                </button>
              </div>
              {bands ? (
                <LineChart
                  series={bandChartSeries}
                  xTicks={bands.labels.map((l) => ({ value: l.distance, label: l.label }))}
                  markers={bands.labels.map((l) => ({ x: l.distance }))}
                  yMarkers={bandMarkers}
                  xLabel="k"
                  yLabel="E [eV]"
                  title="Band structure"
                  settingsId="analysis.bands"
                  height={260}
                />
              ) : (
                <p className="muted">No band structure computed yet.</p>
              )}
            </>
          )}
        </>
      )}
      {section === 'planes' && (
        <>
          {!isCppaw ? (
            <p className="muted">Field cuts come from CP-PAW&apos;s paw_wave.x.</p>
          ) : (
            <PlanesView calcId={selected.id} />
          )}
        </>
      )}

      {section === 'protocol' && (
        <>
          {!isCppaw ? (
            <p className="muted">Only CP-PAW calculations write a protocol.</p>
          ) : (
            <ProtocolView calcId={selected.id} />
          )}
        </>
      )}
    </div>
  );
}
