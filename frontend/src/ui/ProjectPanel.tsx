import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { normalizeStructure } from '../model/structure';
import { useCalculationStore } from '../state/calculationStore';
import { useProjectStore } from '../state/projectStore';
import { useStructureStore } from '../state/structureStore';

export function ProjectPanel({ onError }: { onError: (m: string) => void }): JSX.Element {
  const project = useProjectStore();
  const calcs = useCalculationStore();
  const doc = useStructureStore((s) => s.doc);
  const load = useStructureStore((s) => s.load);
  const [path, setPath] = useState('');

  useEffect(() => {
    project.refresh().catch((e: Error) => onError(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (project.info) {
      calcs.refresh().catch((e: Error) => onError(e.message));
      calcs.connect();
    } else {
      calcs.disconnect();
      calcs.clear();
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
