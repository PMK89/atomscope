import { useEffect, useMemo, useState } from 'react';
import {
  api,
  type BackendInfo,
  type Calculation,
  type ParameterValues,
  type ValidationReport,
} from '../api/client';
import { schemaDefaults } from '../model/schema';
import { normalizeStructure } from '../model/structure';
import { useCalculationStore } from '../state/calculationStore';
import { useProjectStore } from '../state/projectStore';
import { useStructureStore } from '../state/structureStore';
import { SchemaForm } from './forms/SchemaForm';

export function CalculationPanel({ onError }: { onError: (m: string) => void }): JSX.Element {
  const project = useProjectStore((s) => s.info);
  const doc = useStructureStore((s) => s.doc);
  const load = useStructureStore((s) => s.load);
  const store = useCalculationStore();
  const [backends, setBackends] = useState<BackendInfo[]>([]);
  const [backendId, setBackendId] = useState('');
  const [values, setValues] = useState<ParameterValues>({});
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [name, setName] = useState('');
  const [tab, setTab] = useState<'setup' | 'input' | 'results'>('setup');

  const selected: Calculation | undefined = store.calculations.find(
    (c) => c.id === store.selectedId,
  );
  const schema = backendId ? store.schemas[backendId] : undefined;

  useEffect(() => {
    api.backends
      .list()
      .then((b) => {
        setBackends(b);
        if (!backendId && b[0]) setBackendId(b[0].id);
      })
      .catch((e: Error) => onError(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!backendId) return;
    store
      .loadSchema(backendId)
      .then((s) => {
        if (!selected) setValues(schemaDefaults(s));
      })
      .catch((e: Error) => onError(e.message));
  }, [backendId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected) return;
    setBackendId(selected.backend_id);
    setValues(selected.values ?? {});
    setName(selected.name);
    setReport(null);
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = selected?.status === 'queued' || selected?.status === 'running';
  // A calculation that has run is immutable; changes go into a fork (reproducibility).
  const frozen =
    selected?.status === 'completed' ||
    selected?.status === 'failed' ||
    selected?.status === 'cancelled';
  const fail = (e: Error): void => onError(e.message);

  const fork = async (restart: boolean): Promise<void> => {
    if (!selected) return;
    const c = await api.calculations.fork(selected.id, {
      values: restart ? { ...values, start: 'restart' } : values,
      name: `${selected.name} (${restart ? 'continued' : 'fork'})`,
      restart_from_parent: restart,
    });
    store.upsert(c);
    store.select(c.id);
    setTab('setup');
  };

  const createOrUpdate = async (): Promise<Calculation> => {
    if (selected && selected.backend_id === backendId) {
      const c = await api.calculations.updateValues(selected.id ?? '', values);
      store.upsert(c);
      return c;
    }
    if (!project) throw new Error('open or create a project first');
    await api.structures.put(doc);
    const c = await api.calculations.create({
      name: name || `${doc.name} ${backendId}`,
      backend_id: backendId,
      structure_id: doc.id ?? '',
      values,
      resources: { cores: 1, mpi: false },
    });
    store.upsert(c);
    store.select(c.id ?? null);
    return c;
  };

  const onValidate = async (): Promise<void> => {
    const c = await createOrUpdate();
    setReport(await api.calculations.validate(c.id));
  };
  const onGenerate = async (): Promise<void> => {
    const c = await createOrUpdate();
    const rep = await api.calculations.validate(c.id);
    setReport(rep);
    if ((rep.issues ?? []).some((i) => i.severity === 'error')) return;
    await api.calculations.generate(c.id);
    store.upsert(await api.calculations.get(c.id));
    setTab('input');
  };
  const onRun = async (): Promise<void> => {
    const c = await createOrUpdate();
    const rep = await api.calculations.validate(c.id);
    setReport(rep);
    if ((rep.issues ?? []).some((i) => i.severity === 'error')) return;
    store.upsert(await api.calculations.run(c.id));
  };
  const onCancel = async (): Promise<void> => {
    if (selected) store.upsert(await api.calculations.cancel(selected.id ?? ''));
  };
  const loadResultStructure = async (): Promise<void> => {
    if (selected?.result_structure_id)
      load(normalizeStructure(await api.structures.get(selected.result_structure_id)));
  };

  const energy = useMemo(() => selected?.results?.properties?.['energy'], [selected]);

  return (
    <div className="panel calc-panel">
      <div className="tabs">
        {(['setup', 'input', 'results'] as const).map((t) => (
          <button key={t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
            {t === 'setup' ? 'Setup' : t === 'input' ? 'Generated input' : 'Results'}
          </button>
        ))}
      </div>
      {tab === 'setup' && (
        <>
          <div className="form-row">
            <label htmlFor="calc-name">Name</label>
            <input
              id="calc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`${doc.name} calculation`}
              disabled={busy}
            />
          </div>
          <div className="form-row">
            <label htmlFor="calc-backend">Backend</label>
            <select
              id="calc-backend"
              value={backendId}
              disabled={busy || Boolean(selected)}
              onChange={(e) => setBackendId(e.target.value)}
            >
              {backends.map((b) => (
                <option key={b.id} value={b.id} disabled={!b.executables.available}>
                  {b.name}
                  {b.executables.available ? '' : ' (not available)'}
                </option>
              ))}
            </select>
          </div>
          {frozen && (
            <p className="muted">
              This calculation has run and is read-only. Fork it to change parameters or continue
              from its restart file.
            </p>
          )}
          {schema ? (
            <SchemaForm
              schema={schema}
              values={values}
              onChange={setValues}
              report={report}
              disabled={busy || frozen}
            />
          ) : (
            <p className="muted">Loading schema…</p>
          )}
          <div className="button-row">
            <button onClick={() => void onValidate().catch(fail)} disabled={busy || frozen}>
              Validate
            </button>
            <button onClick={() => void onGenerate().catch(fail)} disabled={busy || frozen}>
              Generate input
            </button>
            <button
              className="primary"
              onClick={() => void onRun().catch(fail)}
              disabled={busy || frozen}
            >
              Run
            </button>
            {frozen && <button onClick={() => void fork(false).catch(fail)}>Fork</button>}
            {frozen && selected?.backend_id === 'cppaw' && (
              <button onClick={() => void fork(true).catch(fail)}>Continue from restart</button>
            )}
            {busy && <button onClick={() => void onCancel().catch(fail)}>Cancel</button>}
            {selected && (
              <button
                onClick={() => {
                  store.select(null);
                  setReport(null);
                  setName('');
                }}
              >
                New
              </button>
            )}
          </div>
          {selected && (
            <p className="muted">
              {selected.name}:{' '}
              <span className={`badge badge-${selected.status}`}>{selected.status}</span>
              {selected.job?.exit_code != null && ` exit ${selected.job.exit_code}`}
              {selected.job?.error && ` — ${selected.job.error}`}
            </p>
          )}
        </>
      )}
      {tab === 'input' && (
        <div className="generated">
          {selected?.generated ? (
            selected.generated.files.map((f) => (
              <details key={f.name} open>
                <summary>
                  {f.name} <span className="muted">({f.role})</span>
                </summary>
                <pre>{f.text}</pre>
              </details>
            ))
          ) : (
            <p className="muted">No input generated yet.</p>
          )}
        </div>
      )}
      {tab === 'results' && (
        <div className="results">
          {selected?.results ? (
            <>
              {energy && (
                <p>
                  Energy: <b>{energy.value.toFixed(6)}</b> {energy.unit}
                </p>
              )}
              {selected.results.converged != null && (
                <p>Converged: {String(selected.results.converged)}</p>
              )}
              {selected.results.trajectory && (
                <p>Trajectory frames: {selected.results.trajectory.frames?.length ?? 0}</p>
              )}
              {selected.results.warnings?.map((w) => (
                <p key={w} className="form-error">
                  {w}
                </p>
              ))}
              {selected.result_structure_id && (
                <button onClick={() => void loadResultStructure().catch(fail)}>
                  Load final structure
                </button>
              )}
            </>
          ) : (
            <p className="muted">No results yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
