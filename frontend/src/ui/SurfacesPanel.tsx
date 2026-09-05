/**
 * Isosurface controls (Avogadro "Surfaces" equivalent): grids of the selected calculation and
 * imported cube datasets, per-surface isovalue / colour / opacity / +- pair / resolution.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type GridRef, type VolumetricGrid } from '../api/client';
import { useCalculationStore } from '../state/calculationStore';
import { useProjectStore } from '../state/projectStore';
import { symmetricRange } from '../renderer/gridSampling';
import { SurfaceGenerator } from './SurfaceGenerator';
import {
  isDensityKind,
  isoToSlider,
  sliderRange,
  sliderToIso,
  STEP_OPTIONS,
  type LoadedGrid,
  type SurfaceDef,
  useVolumetricStore,
} from '../state/volumetricStore';

const KINDS: VolumetricGrid['kind'][] = [
  'electron_density',
  'spin_density',
  'orbital',
  'orbital_density',
  'electrostatic_potential',
  'density_difference',
  'other',
];

const fmt = (v: number): string =>
  Math.abs(v) >= 1e-3 || v === 0 ? v.toPrecision(4) : v.toExponential(3);

/** Dragging the isovalue slider commits only after this idle time, so meshing is not spammed. */
export const ISOVALUE_DEBOUNCE_MS = 100;

export function SurfacesPanel({ onError }: { onError: (m: string) => void }): JSX.Element {
  const project = useProjectStore((s) => s.info);
  const calculations = useCalculationStore((s) => s.calculations);
  const selectedId = useCalculationStore((s) => s.selectedId);
  const vol = useVolumetricStore();
  const [datasets, setDatasets] = useState<GridRef[]>([]);
  const [cubePath, setCubePath] = useState('');
  const [cubeKind, setCubeKind] = useState<VolumetricGrid['kind']>('electron_density');

  const selected = calculations.find((c) => c.id === selectedId);
  const calcGrids: GridRef[] = (selected?.results?.grids ?? []).map((grid) => ({
    grid,
    calculation_id: selected?.id ?? null,
  }));

  const refreshDatasets = useCallback(async () => {
    if (!project) {
      setDatasets([]);
      return;
    }
    const refs = await api.grids.list();
    setDatasets(refs.filter((r) => !r.calculation_id));
  }, [project]);

  useEffect(() => {
    refreshDatasets().catch((e: Error) => onError(e.message));
  }, [refreshDatasets]); // eslint-disable-line react-hooks/exhaustive-deps

  const importCube = async (): Promise<void> => {
    if (!cubePath.trim()) return;
    await api.io.importCube({ path: cubePath.trim(), kind: cubeKind });
    setCubePath('');
    // the cube's embedded structure was saved into the project as well
    await Promise.all([refreshDatasets(), useProjectStore.getState().refresh()]);
  };

  const addSurface = async (ref: GridRef): Promise<void> => {
    await vol.loadGrid(ref.grid.id, ref.calculation_id ?? null);
    useVolumetricStore.getState().addSurface(ref.grid.id);
  };

  const fail = (e: Error): void => onError(e.message);

  return (
    <div className="panel surfaces-panel">
      <h3>Grids</h3>
      {!project && <p className="muted">Open a project to see volumetric data.</p>}
      {project && calcGrids.length === 0 && datasets.length === 0 && (
        <p className="muted">
          No grids: run a calculation with density/orbital output or import a cube.
        </p>
      )}
      {[...calcGrids, ...datasets].map((ref) => (
        <GridCard
          key={ref.grid.id}
          ref_={ref}
          loaded={vol.grids[ref.grid.id]}
          loading={Boolean(vol.loading[ref.grid.id])}
          onAdd={() => void addSurface(ref).catch(fail)}
        />
      ))}
      {project && (
        <div className="form-row">
          <label htmlFor="cube-path">Import cube</label>
          <div>
            <input
              id="cube-path"
              placeholder="/path/to/file.cube"
              value={cubePath}
              onChange={(e) => setCubePath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void importCube().catch(fail);
              }}
            />
            <select
              aria-label="cube kind"
              value={cubeKind}
              onChange={(e) => setCubeKind(e.target.value as VolumetricGrid['kind'])}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <button onClick={() => void importCube().catch(fail)} disabled={!cubePath.trim()}>
              Import
            </button>
          </div>
        </div>
      )}

      <h3>Create surfaces</h3>
      <SurfaceGenerator
        onError={onError}
        onCreated={async (grid) => {
          await refreshDatasets();
          await addSurface({ grid, calculation_id: null });
        }}
      />

      <h3>Surfaces</h3>
      {vol.surfaces.length === 0 && <p className="muted">No surfaces yet.</p>}
      {vol.surfaces.map((def) => {
        const grid = vol.grids[def.gridId];
        return grid ? (
          <SurfaceCard
            key={def.id}
            def={def}
            grid={grid}
            available={[...calcGrids, ...datasets]}
            onError={onError}
          />
        ) : null;
      })}
    </div>
  );
}

function GridCard({
  ref_,
  loaded,
  loading,
  onAdd,
}: {
  ref_: GridRef;
  loaded: LoadedGrid | undefined;
  loading: boolean;
  onAdd: () => void;
}): JSX.Element {
  const g = ref_.grid;
  const s = loaded?.stats;
  return (
    <div className="grid-card">
      <h4>
        <span>
          {g.name}
          {g.orbital?.energy != null && ` (${g.orbital.energy.toFixed(3)} eV)`}
        </span>
        <button onClick={onAdd} disabled={loading}>
          {loading ? 'Loading…' : 'Add surface'}
        </button>
      </h4>
      <p className="muted">
        {g.kind.replace(/_/g, ' ')} · {g.shape.join(' × ')} · {g.unit}
        {ref_.calculation_id ? '' : ' · dataset'}
      </p>
      {s && (
        <p className="muted">
          min {fmt(s.min)} · max {fmt(s.max)} · mean {fmt(s.mean)} · suggested{' '}
          {fmt(s.suggested_isovalue)}
        </p>
      )}
    </div>
  );
}

function SurfaceCard({
  def,
  grid,
  available,
  onError,
}: {
  def: SurfaceDef;
  grid: LoadedGrid;
  /** every grid in the project, loaded or not: a colour source is loaded on demand */
  available: GridRef[];
  onError: (m: string) => void;
}): JSX.Element {
  const update = useVolumetricStore((s) => s.updateSurface);
  const remove = useVolumetricStore((s) => s.removeSurface);
  const warning = useVolumetricStore((s) => s.warnings[def.id] ?? s.warnings[`${def.id}-neg`]);
  // any other loaded grid can paint this surface: an electrostatic potential on a density is the
  // usual pair, but nothing here assumes that
  // every other grid in the project can paint this surface -- an electrostatic potential on a
  // density is the usual pair -- and one that is not loaded yet is fetched when it is chosen
  const loaded = useVolumetricStore((s) => s.grids);
  const others = useMemo(() => {
    const byId = new Map(available.map((r) => [r.grid.id, r]));
    // a grid already loaded belongs in the list even if the project listing has not caught up
    for (const g of Object.values(loaded)) {
      if (!byId.has(g.meta.id)) {
        byId.set(g.meta.id, { grid: g.meta, calculation_id: g.calculationId });
      }
    }
    byId.delete(def.gridId);
    return [...byId.values()];
  }, [available, loaded, def.gridId]);
  const chooseColorGrid = async (gridId: string): Promise<void> => {
    if (!gridId) {
      update(def.id, { colorGridId: null, colorRange: null });
      return;
    }
    const ref = available.find((r) => r.grid.id === gridId);
    try {
      if (!useVolumetricStore.getState().grids[gridId]) {
        await useVolumetricStore.getState().loadGrid(gridId, ref?.calculation_id ?? null);
      }
      update(def.id, { colorGridId: gridId, colorRange: null });
    } catch (e) {
      onError(`Could not load ${ref?.grid.name ?? gridId}: ${(e as Error).message}`);
    }
  };
  const found = useVolumetricStore((s) => s.colorRanges[def.id]);
  const [lowText, setLowText] = useState('');
  const [highText, setHighText] = useState('');
  useEffect(() => {
    // with no range of its own the surface uses the symmetric scale, so show that, not the extremes
    const [lo, hi] = def.colorRange ?? (found ? symmetricRange(found[0], found[1]) : [0, 0]);
    setLowText(fmt(lo));
    setHighText(fmt(hi));
  }, [def.colorRange, found]);
  const commitRange = (): void => {
    const lo = Number(lowText);
    const hi = Number(highText);
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo)
      update(def.id, { colorRange: [lo, hi] });
  };
  const range = sliderRange(grid.stats, grid.meta.kind);
  const [text, setText] = useState(fmt(def.isovalue));
  useEffect(() => setText(fmt(def.isovalue)), [def.isovalue]);
  const commitText = (): void => {
    const v = Number(text);
    if (Number.isFinite(v) && v !== def.isovalue) update(def.id, { isovalue: v });
    else setText(fmt(def.isovalue));
  };
  // the slider is driven locally while dragging and committed to the store when it settles
  const [slider, setSlider] = useState<number | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );
  const dragIsovalue = (t: number): void => {
    setSlider(t);
    setText(fmt(sliderToIso(t, range)));
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      debounce.current = null;
      setSlider(null);
      update(def.id, { isovalue: sliderToIso(t, range) });
    }, ISOVALUE_DEBOUNCE_MS);
  };
  const id = (suffix: string): string => `${def.id}-${suffix}`;
  return (
    <div className="surface-card">
      <h4>
        <span>
          <i className="surface-swatch" style={{ background: def.color }} />
          {def.pair && <i className="surface-swatch" style={{ background: def.negativeColor }} />}
          {grid.meta.name}
        </span>
        <span>
          <label>
            <input
              type="checkbox"
              checked={def.visible}
              onChange={(e) => update(def.id, { visible: e.target.checked })}
            />{' '}
            visible
          </label>{' '}
          <button onClick={() => remove(def.id)} aria-label="delete surface">
            ✕
          </button>
        </span>
      </h4>
      <div className="form-row">
        <label htmlFor={id('iso')}>Isovalue{range.log ? ' (log)' : ''}</label>
        <div>
          <input
            id={id('iso')}
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={slider ?? isoToSlider(def.isovalue, range)}
            onChange={(e) => dragIsovalue(Number(e.target.value))}
          />
          <input
            aria-label="isovalue"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitText();
            }}
          />
        </div>
      </div>
      <div className="form-row">
        <label htmlFor={id('color')}>Colour</label>
        <div>
          <input
            id={id('color')}
            type="color"
            value={def.color}
            onChange={(e) => update(def.id, { color: e.target.value })}
          />
          {def.pair && (
            <input
              aria-label="negative colour"
              type="color"
              value={def.negativeColor}
              onChange={(e) => update(def.id, { negativeColor: e.target.value })}
            />
          )}
        </div>
      </div>
      <div className="form-row">
        <label htmlFor={id('colorby')}>Colour by</label>
        <select
          id={id('colorby')}
          value={def.colorGridId ?? ''}
          onChange={(e) => void chooseColorGrid(e.target.value)}
        >
          <option value="">One colour</option>
          {others.map((r) => (
            <option key={r.grid.id} value={r.grid.id}>
              {r.grid.name}
            </option>
          ))}
        </select>
      </div>
      {def.colorGridId && (
        <div className="form-row">
          <label htmlFor={id('range-lo')}>Scale (blue → red)</label>
          <div className="form-vector">
            <input
              id={id('range-lo')}
              aria-label="colour scale low"
              value={lowText}
              onChange={(e) => setLowText(e.target.value)}
              onBlur={commitRange}
              onKeyDown={(e) => e.key === 'Enter' && commitRange()}
            />
            <input
              aria-label="colour scale high"
              value={highText}
              onChange={(e) => setHighText(e.target.value)}
              onBlur={commitRange}
              onKeyDown={(e) => e.key === 'Enter' && commitRange()}
            />
          </div>
        </div>
      )}
      {def.colorGridId && found && (
        <p className="muted">
          On this surface: {fmt(found[0])} … {fmt(found[1])}
          {def.colorRange && (
            <>
              {' '}
              <button onClick={() => update(def.id, { colorRange: null })}>use this range</button>
            </>
          )}
        </p>
      )}
      <div className="form-row">
        <label htmlFor={id('opacity')}>Opacity</label>
        <input
          id={id('opacity')}
          type="range"
          min={0.05}
          max={1}
          step={0.05}
          value={def.opacity}
          onChange={(e) => update(def.id, { opacity: Number(e.target.value) })}
        />
      </div>
      {grid.stats.has_negative && !isDensityKind(grid.meta.kind) && (
        <div className="form-row">
          <label htmlFor={id('pair')}>± pair</label>
          <input
            id={id('pair')}
            type="checkbox"
            checked={def.pair}
            onChange={(e) => update(def.id, { pair: e.target.checked })}
          />
        </div>
      )}
      {warning && <p className="form-error">{warning}</p>}
      <div className="form-row">
        <label htmlFor={id('step')}>Resolution</label>
        <select
          id={id('step')}
          value={def.step}
          onChange={(e) => update(def.id, { step: Number(e.target.value) })}
        >
          {STEP_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === 1 ? 'full' : `1/${s}`}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
