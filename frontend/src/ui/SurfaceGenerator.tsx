/**
 * "Create Surfaces" (Avogadro 1: Extensions > Create Surfaces...): load a wavefunction file
 * (Gaussian fchk, Molden, GAMESS-US log) and evaluate an orbital, the density, the spin density, the
 * electrostatic potential or the van der Waals volume on a grid.
 *
 * The point count is estimated here from the loaded geometry so the cost of a request is visible
 * before it is sent -- the electrostatic potential is a grid integral and the backend refuses
 * grids above ESP_LIMIT points.
 */
import { useState } from 'react';
import {
  api,
  type SurfaceRequest,
  type VolumetricGrid,
  type WavefunctionInfo,
} from '../api/client';
import { useProjectStore } from '../state/projectStore';

type Kind = SurfaceRequest['kind'];

const KIND_LABELS: Record<Kind, string> = {
  orbital: 'Molecular orbital',
  density: 'Electron density',
  spin_density: 'Spin density',
  electrostatic_potential: 'Electrostatic potential',
  vdw: 'Van der Waals',
};

/** Avogadro's Low..Very High resolution presets, as a grid spacing in Angstrom. */
export const RESOLUTIONS: { label: string; spacing: number }[] = [
  { label: 'Low', spacing: 0.4 },
  { label: 'Medium', spacing: 0.25 },
  { label: 'High', spacing: 0.15 },
  { label: 'Very high', spacing: 0.1 },
];

/** How often to ask how far the evaluation has got. */
const POLL_MS = 300;

/** Mirrors MAX_ESP_POINTS in routes_wavefunction.py. */
export const ESP_LIMIT = 200_000;

/** Point count of the box the backend would build (bounding_box in cubes.py). */
export function estimatePoints(
  positions: readonly (readonly [number, number, number])[],
  padding: number,
  spacing: number,
): number {
  if (positions.length === 0 || !(spacing > 0)) return 0;
  let n = 1;
  for (let d = 0; d < 3; d++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of positions) {
      const v = p[d] as number;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const span = hi - lo + 2 * padding;
    n *= Math.max(2, Math.ceil(span / spacing) + 1);
  }
  return n;
}

export function SurfaceGenerator({
  onError,
  onCreated,
}: {
  onError: (message: string) => void;
  onCreated: (grid: VolumetricGrid) => void | Promise<void>;
}): JSX.Element {
  const project = useProjectStore((s) => s.info);
  const [path, setPath] = useState('');
  const [info, setInfo] = useState<WavefunctionInfo | null>(null);
  const [kind, setKind] = useState<Kind>('orbital');
  const [orbital, setOrbital] = useState<number | null>(null);
  const [spacing, setSpacing] = useState(0.25);
  const [padding, setPadding] = useState(3.5);
  /** The evaluation in flight: its token, so it can be stopped, and how far it has got. */
  const [running, setRunning] = useState<{ id: string; progress: number } | null>(null);

  const load = async (): Promise<void> => {
    const loaded = await api.wavefunction.load({ path: path.trim() });
    setInfo(loaded);
    setOrbital(loaded.homo_index);
    await useProjectStore.getState().refresh();
  };

  const positions = (info?.structure.atoms ?? []).map(
    (a) => a.position as readonly [number, number, number],
  );
  const points = estimatePoints(positions, padding, spacing);
  const tooLarge = kind === 'electrostatic_potential' && points > ESP_LIMIT;

  /**
   * Start the evaluation and follow it. The backend hands back a token at once and does the
   * arithmetic beside the request, so the panel can show how far it has got and stop it -- what
   * Avogadro's modal progress dialog did, without a modal (AV-UI-022).
   */
  const calculate = async (): Promise<void> => {
    if (!info) return;
    const body: SurfaceRequest = {
      path: info.source,
      kind,
      padding,
      spacing,
      vdw_scale: 1,
      ...(kind === 'orbital' && orbital !== null ? { orbital_index: orbital } : {}),
    };
    let task = await api.wavefunction.surface(body);
    setRunning({ id: task.id, progress: task.progress });
    try {
      while (task.status === 'running') {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        task = await api.wavefunction.surfaceStatus(task.id);
        setRunning({ id: task.id, progress: task.progress });
      }
      if (task.status === 'failed') throw new Error(task.error ?? 'the evaluation failed');
      if (task.status === 'cancelled') return; // asked for by the user: not an error
      if (task.grid) await onCreated(task.grid);
    } finally {
      setRunning(null);
    }
  };

  const cancel = async (): Promise<void> => {
    if (running) await api.wavefunction.cancelSurface(running.id);
  };

  const fail = (e: Error): void => onError(e.message);

  return (
    <div className="surface-generator">
      <div className="form-row">
        <label htmlFor="wf-path">Wavefunction</label>
        <div>
          <input
            id="wf-path"
            placeholder="/path/to/molecule.fchk"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void load().catch(fail);
            }}
          />
          <button onClick={() => void load().catch(fail)} disabled={!path.trim() || !project}>
            Load
          </button>
        </div>
      </div>
      {!project && <p className="muted">Open a project to create surfaces.</p>}
      {info && (
        <>
          <p className="muted" data-testid="wf-summary">
            {info.format} &middot; {info.n_electrons} electrons &middot; {info.n_basis} basis
            functions &middot; {info.orbitals.length} orbitals
            {info.coefficient_convention && (
              <> &middot; coefficients read as {info.coefficient_convention}</>
            )}
          </p>
          <div className="form-row">
            <label htmlFor="wf-kind">Surface type</label>
            <select id="wf-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          {kind === 'orbital' && (
            <div className="form-row">
              <label htmlFor="wf-orbital">Orbital</label>
              <select
                id="wf-orbital"
                value={orbital ?? ''}
                onChange={(e) => setOrbital(Number(e.target.value))}
              >
                {info.orbitals.map((mo) => (
                  <option key={`${mo.spin}-${mo.index}`} value={mo.index}>
                    {mo.index + 1}. {mo.label}
                    {mo.energy == null ? '' : ` (${(mo.energy * 27.2114).toFixed(2)} eV)`}
                    {mo.occupation > 0 ? '' : ' - virtual'}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="form-row">
            <label htmlFor="wf-resolution">Resolution</label>
            <select
              id="wf-resolution"
              value={spacing}
              onChange={(e) => setSpacing(Number(e.target.value))}
            >
              {RESOLUTIONS.map((r) => (
                <option key={r.label} value={r.spacing}>
                  {r.label} ({r.spacing} A)
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label htmlFor="wf-padding">Padding (A)</label>
            <input
              id="wf-padding"
              type="number"
              min={1}
              max={10}
              step={0.5}
              value={padding}
              onChange={(e) => setPadding(Number(e.target.value))}
            />
          </div>
          <p className="muted" data-testid="wf-points">
            {points.toLocaleString()} grid points
            {tooLarge && ' - too many for the electrostatic potential, lower the resolution'}
          </p>
          <div className="button-row">
            <button
              className="primary"
              onClick={() => void calculate().catch(fail)}
              disabled={running !== null || tooLarge}
            >
              {running ? `Calculating… ${Math.round(running.progress * 100)}%` : 'Calculate'}
            </button>
            {running && <button onClick={() => void cancel().catch(fail)}>Cancel</button>}
          </div>
        </>
      )}
    </div>
  );
}
