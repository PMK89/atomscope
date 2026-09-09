/**
 * A nudged elastic band between the structure on screen and another one in the project.
 *
 * A NEB needs two endpoints, and a document has one -- so the second comes from the project's
 * own structure list. What comes back is the band as a trajectory the player steps through and
 * the energy against distance along it, which together are what a NEB is for: the barrier is the
 * top of that curve, and the geometry at the top is the transition state.
 */
import { useState } from 'react';

import { api, type NebResponse } from '../api/client';
import { toApiStructure } from '../api/structureBody';
import { trajectoryFromJson } from '../model/trajectory';
import { useProjectStore } from '../state/projectStore';
import { useStructureStore } from '../state/structureStore';
import { useTrajectoryStore } from '../state/trajectoryStore';
import { LineChart, type ChartMarker } from './charts/LineChart';

const CALCULATORS = [
  { value: 'emt', label: 'EMT (metals)' },
  { value: 'openbabel', label: 'Open Babel force field' },
  { value: 'lj', label: 'Lennard-Jones' },
  { value: 'morse', label: 'Morse' },
];

export function NebPanel(): React.ReactElement {
  const doc = useStructureStore((s) => s.doc);
  const structures = useProjectStore((s) => s.structures);
  const loadTrajectory = useTrajectoryStore((s) => s.load);

  const [finalId, setFinalId] = useState('');
  const [calculator, setCalculator] = useState('emt');
  const [images, setImages] = useState(7);
  const [climb, setClimb] = useState(false);
  const [fmax, setFmax] = useState(0.05);
  const [maxSteps, setMaxSteps] = useState(100);
  const [result, setResult] = useState<NebResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // the document itself is one end, so it is not offered as the other
  const others = structures.filter((s) => s.id !== doc.id);

  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const final = await api.structures.get(finalId);
      const r = await api.analysis.neb({
        initial: toApiStructure(doc),
        final,
        calculator,
        force_field: 'mmff94',
        images,
        k: 0.1,
        climb,
        interpolation: 'idpp',
        optimizer: 'bfgs',
        fmax,
        max_steps: maxSteps,
      });
      setResult(r);
      loadTrajectory(trajectoryFromJson(r.trajectory));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const markers: ChartMarker[] =
    result === null ? [] : [{ x: result.energy.x[result.transition_index]!, label: 'TS' }];

  return (
    <div className="panel neb-panel">
      <p className="muted">
        The structure on screen is one end of the band. Pick the other from the project.
      </p>
      <div className="form-row">
        <label htmlFor="neb-final">other end</label>
        <select id="neb-final" value={finalId} onChange={(e) => setFinalId(e.target.value)}>
          <option value="">choose a structure…</option>
          {others.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name || s.id}
            </option>
          ))}
        </select>
      </div>
      {others.length === 0 && (
        <p className="muted">
          The project has no second structure yet. Save the other end (File ▸ Export…, or edit and
          add it) and it will appear here.
        </p>
      )}
      <div className="form-row">
        <label htmlFor="neb-calc">calculator</label>
        <select id="neb-calc" value={calculator} onChange={(e) => setCalculator(e.target.value)}>
          {CALCULATORS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="neb-images">images</label>
        <input
          id="neb-images"
          type="number"
          min="3"
          max="31"
          value={images}
          onChange={(e) => setImages(Number(e.target.value))}
        />
      </div>
      <div className="form-row">
        <label htmlFor="neb-fmax">force convergence</label>
        <input
          id="neb-fmax"
          type="number"
          step="any"
          min="0"
          value={fmax}
          onChange={(e) => setFmax(Number(e.target.value))}
        />
      </div>
      <div className="form-row">
        <label htmlFor="neb-steps">maximum steps</label>
        <input
          id="neb-steps"
          type="number"
          min="1"
          value={maxSteps}
          onChange={(e) => setMaxSteps(Number(e.target.value))}
        />
      </div>
      <label className="check">
        <input type="checkbox" checked={climb} onChange={(e) => setClimb(e.target.checked)} />
        Climbing image (pulls the top image onto the saddle)
      </label>
      <div className="button-row">
        <button className="primary" onClick={() => void run()} disabled={busy || finalId === ''}>
          {busy ? 'Relaxing the band…' : 'Run NEB'}
        </button>
      </div>
      {error !== null && <p className="muted">{error}</p>}
      {result !== null && (
        <>
          <p className="muted">
            Barrier <strong>{result.barrier.toFixed(3)} eV</strong> at image{' '}
            {result.transition_index} · {result.steps} steps ·{' '}
            {result.converged ? 'converged' : 'not converged'}
          </p>
          {result.note !== null && result.note !== undefined && (
            <p className="muted">{result.note}</p>
          )}
          <LineChart
            series={[
              {
                id: 'band',
                label: 'band',
                x: result.energy.x,
                y: result.energy.y,
                color: '#2f6fdb',
              },
            ]}
            markers={markers}
            xLabel="distance along the band [Å]"
            yLabel="ΔE [eV]"
            title="Reaction path"
            height={220}
            settingsId="analysis.neb"
          />
          <p className="muted">
            The band is loaded as a trajectory — step through it with the player to see the path.
          </p>
        </>
      )}
    </div>
  );
}
