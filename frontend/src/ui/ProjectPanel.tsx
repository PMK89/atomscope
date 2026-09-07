import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { normalizeStructure } from '../model/structure';
import { useCalculationStore } from '../state/calculationStore';
import { useProjectStore } from '../state/projectStore';
import { useVolumetricStore } from '../state/volumetricStore';
import { startViewSettingsSync } from '../state/viewSettingsSync';
import { useStructureStore } from '../state/structureStore';

export function ProjectPanel({ onError }: { onError: (m: string) => void }): JSX.Element {
  const project = useProjectStore();
  const calcs = useCalculationStore();
  const doc = useStructureStore((s) => s.doc);
  const load = useStructureStore((s) => s.load);
  const [path, setPath] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exported, setExported] = useState<string | null>(null);

  useEffect(() => {
    project.refresh().catch((e: Error) => onError(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (project.info) {
      calcs.refresh().catch((e: Error) => onError(e.message));
      calcs.connect();
      const stop = startViewSettingsSync(onError);
      return stop;
    } else {
      calcs.disconnect();
      calcs.clear();
      useVolumetricStore.getState().clear();
    }
  }, [project.info?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (p: Promise<unknown>): void => {
    p.catch((e: Error) => onError(e.message));
  };

  const saveCurrent = async (): Promise<void> => {
    await api.structures.put(doc);
    await project.refresh();
  };

  const openStructure = async (id: string): Promise<void> => {
    load(normalizeStructure(await api.structures.get(id)));
  };

  if (!project.info) {
    return (
      <div className="panel">
        <h3>Project</h3>
        <p className="muted">No project open. Enter a directory path on this machine.</p>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/home/user/projects/demo"
          aria-label="Project path"
        />
        <div className="button-row">
          <button onClick={() => run(project.open(path))} disabled={!path}>
            Open
          </button>
          <button
            onClick={() =>
              run(project.create(path, path.split('/').filter(Boolean).pop() ?? 'project'))
            }
            disabled={!path}
          >
            Create
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>{project.info.manifest.name}</h3>
      <p className="muted" title={project.info.path}>
        {project.info.path}
      </p>
      <div className="button-row">
        <button onClick={() => run(saveCurrent())}>Save current structure</button>
        <button onClick={() => run(project.close())}>Close</button>
      </div>

      <details className="form-section">
        <summary>Export a copy</summary>
        <p className="muted">
          A copy that opens like any project, without the restart files — they are most of a
          finished project&apos;s size and are needed only to continue a run or pull out a new
          orbital. Everything already computed comes along.
        </p>
        <div className="form-row">
          <label htmlFor="export-path">Copy to</label>
          <input
            id="export-path"
            value={exportTo}
            placeholder="/home/user/share/course"
            onChange={(e) => setExportTo(e.target.value)}
          />
        </div>
        <div className="button-row">
          <button
            disabled={!exportTo}
            onClick={() => {
              setExported(null);
              api.project
                .exportTo({ path: exportTo })
                .then((r) => {
                  const left = (r.skipped ?? []).reduce((n, s) => n + s.bytes, 0);
                  setExported(
                    `${r.files} files, ${(r.bytes_copied / 2 ** 20).toFixed(1)} MB` +
                      (left ? ` — ${(left / 2 ** 20).toFixed(1)} MB left out` : ''),
                  );
                })
                .catch((e: Error) => onError(e.message));
            }}
          >
            Export
          </button>
        </div>
        {exported && (
          <p className="muted" role="status">
            {exported}. See <code>EXPORT.md</code> in the copy for what it does not contain.
          </p>
        )}
      </details>
      <h4>Structures ({project.structures.length})</h4>
      <ul className="tree">
        {project.structures.map((s) => (
          <li key={s.id}>
            <button
              className={s.id === doc.id ? 'tree-item active' : 'tree-item'}
              onClick={() => run(openStructure(s.id))}
            >
              {s.name}{' '}
              <span className="muted">
                {s.formula}, {s.n_atoms} atoms{s.periodic ? ', periodic' : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <h4>Calculations ({calcs.calculations.length})</h4>
      <ul className="tree">
        {calcs.calculations.map((c) => (
          <li key={c.id}>
            <button
              className={c.id === calcs.selectedId ? 'tree-item active' : 'tree-item'}
              onClick={() => calcs.select(c.id ?? null)}
            >
              {c.name} <span className={`badge badge-${c.status}`}>{c.status}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
