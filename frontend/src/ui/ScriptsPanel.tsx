/**
 * Writing and running Python inside Atomscope (Avogadro's Python extensions and its Python
 * Terminal, AV-PLUG-004/007/009).
 *
 * A script is a file in the project's `scripts/` directory. Pressing Run stores it, saves the
 * structure on screen into the project so the script has something to act on, and starts a child
 * interpreter through the job manager -- so a script that loops forever can be cancelled, and its
 * output and traceback are read back from the run's own directory.
 *
 * Not a REPL. Avogadro's terminal kept one interpreter alive and fed it lines; here every run is
 * a fresh process, which is what makes cancelling and reporting a traceback simple and what stops
 * a half-finished script leaving state behind. The trade is that a variable does not survive
 * between runs.
 *
 * A script runs with the privileges of whoever started Atomscope. It is not sandboxed: it can read
 * and write the user's files, exactly as `python script.py` in a terminal can
 * (docs/architecture/security-model.md).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { api, ApiError, type Script, type ScriptRun } from '../api/client';
import { normalizeStructure } from '../model/structure';
import { useProjectStore } from '../state/projectStore';
import { useStructureStore } from '../state/structureStore';
import { confirmReplace } from './replaceDocument';

const NEW_SCRIPT = `from atomscope.scripting import save, value

# \`atoms\` is the structure on screen, as an ase.Atoms
value('formula', atoms.get_chemical_formula())
print(atoms)
`;

/** How often a running script's record and logs are re-read. */
const POLL_MS = 400;

const ACTIVE = (run: ScriptRun | null): boolean =>
  run !== null && (run.status === 'queued' || run.status === 'running');

/** A name a script file can have: the id is the file stem, so it has to be one. */
const idFromName = (name: string): string =>
  name
    .trim()
    .replace(/\.py$/i, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

export function ScriptsPanel({ onError }: { onError: (m: string) => void }): JSX.Element {
  const project = useProjectStore((s) => s.info);
  const structures = useProjectStore((s) => s.structures);
  const refreshProject = useProjectStore((s) => s.refresh);
  const doc = useStructureStore((s) => s.doc);
  const load = useStructureStore((s) => s.load);

  const [scripts, setScripts] = useState<Script[]>([]);
  const [examples, setExamples] = useState<Script[]>([]);
  const [scriptId, setScriptId] = useState('');
  const [source, setSource] = useState('');
  const [saved, setSaved] = useState('');
  const [inputId, setInputId] = useState('');
  // the id is what the poll watches and the record is what it writes: an effect that depended on
  // the record would re-arm itself on every tick, poll without pause, and overwrite the next run
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<ScriptRun | null>(null);
  const [output, setOutput] = useState<{ stdout: string[]; stderr: string[] }>({
    stdout: [],
    stderr: [],
  });
  const [busy, setBusy] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  /** Where the caret has to go once React has re-rendered the editor's value (see `onKeyDown`). */
  const caret = useRef<number | null>(null);

  const fail = useCallback(
    (e: unknown): void => {
      onError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
    },
    [onError],
  );

  const reload = useCallback(async (): Promise<void> => {
    const [list, ships] = await Promise.all([api.scripts.list(), api.scripts.examples()]);
    setScripts(list);
    setExamples(ships);
    return undefined;
  }, []);

  useEffect(() => {
    if (!project) {
      setScripts([]);
      setScriptId('');
      return;
    }
    reload().catch(fail);
  }, [project, reload, fail]);

  const select = (id: string): void => {
    const found = scripts.find((s) => s.id === id);
    setScriptId(id);
    setSource(found?.source ?? '');
    setSaved(found?.source ?? '');
    setRunId(null);
    setRun(null);
    setOutput({ stdout: [], stderr: [] });
  };

  const create = (): void => {
    const name = window.prompt('Name for the new script', 'my-script');
    if (name === null) return;
    const id = idFromName(name);
    if (!id) {
      onError('a script name needs at least one letter, digit, - or _');
      return;
    }
    api.scripts
      .put(id, NEW_SCRIPT)
      .then(async () => {
        await reload();
        setScriptId(id);
        setSource(NEW_SCRIPT);
        setSaved(NEW_SCRIPT);
      })
      .catch(fail);
  };

  const save = useCallback(async (): Promise<void> => {
    if (!scriptId) return;
    await api.scripts.put(scriptId, source);
    setSaved(source);
    await reload();
  }, [scriptId, source, reload]);

  const remove = (): void => {
    if (!scriptId || !window.confirm(`Delete the script ${scriptId}.py?`)) return;
    api.scripts
      .delete(scriptId)
      .then(async () => {
        await reload();
        setScriptId('');
        setSource('');
        setSaved('');
      })
      .catch(fail);
  };

  const useExample = (id: string): void => {
    const found = examples.find((e) => e.id === id);
    if (!found) return;
    // an example is read-only: it is copied into a project script of the same name
    api.scripts
      .put(found.id, found.source)
      .then(async () => {
        await reload();
        setScriptId(found.id);
        setSource(found.source);
        setSaved(found.source);
      })
      .catch(fail);
  };

  const start = async (): Promise<void> => {
    if (!scriptId) return;
    setBusy(true);
    setRunId(null);
    setRun(null);
    setOutput({ stdout: [], stderr: [] });
    try {
      await api.scripts.put(scriptId, source);
      setSaved(source);
      let structureId: string | null = null;
      if (inputId === '') {
        // the structure on screen is the script's `atoms`; the project is how it gets there, so
        // it is saved first -- the same upsert the project panel's Save does
        await api.structures.put(doc);
        await refreshProject();
        structureId = doc.id ?? null;
      } else if (inputId !== 'none') {
        structureId = inputId;
      }
      const started = await api.scripts.run(scriptId, structureId);
      setRun(started);
      setRunId(started.id);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const cancel = (): void => {
    if (runId) api.scripts.cancelRun(runId).then(setRun).catch(fail);
  };

  // Read the record and both logs until the run is no longer active, then once more -- the last
  // lines, the values and the saved structures all land at the end. The next poll is scheduled
  // from the previous one rather than by an interval, so a slow answer cannot pile requests up.
  useEffect(() => {
    if (runId === null) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async (): Promise<void> => {
      const [record, out, err] = await Promise.all([
        api.scripts.getRun(runId),
        api.scripts.runLog(runId, 'stdout'),
        api.scripts.runLog(runId, 'stderr'),
      ]);
      if (!live) return;
      setOutput({ stdout: out.lines, stderr: err.lines });
      setRun(record);
      if (ACTIVE(record)) {
        timer = setTimeout(() => void tick().catch(fail), POLL_MS);
      } else if (record.structure_ids.length > 0) {
        // the structures the script saved are the project's now, so the lists that show them
        // (this panel's input select, the project panel) have to be told
        await refreshProject();
      }
    };
    void tick().catch(fail);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [runId, fail, refreshProject]);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [output]);

  const open = async (id: string): Promise<void> => {
    if (!confirmReplace()) return;
    load(normalizeStructure(await api.structures.get(id)));
  };

  // A controlled textarea puts the caret at the end of the new value, so an indent inserted in
  // the middle would jump. Restoring it in a layout effect rather than an animation frame is what
  // makes it deterministic: the frame could land after the next keystroke had already been typed.
  useLayoutEffect(() => {
    if (caret.current !== null && editorRef.current) {
      editorRef.current.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  }, [source]);

  /** Tab indents instead of leaving the textarea, which is what a code editor has to do. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: from, selectionEnd: to } = e.currentTarget;
      setSource(`${source.slice(0, from)}    ${source.slice(to)}`);
      caret.current = from + 4;
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void start();
    }
  };

  if (!project) {
    return (
      <div className="panel scripts-panel">
        <p className="muted">
          Scripts live in the project&rsquo;s <code>scripts/</code> directory. Open or create a
          project first.
        </p>
      </div>
    );
  }

  const values = Object.entries(run?.values ?? {});
  return (
    <div className="panel scripts-panel">
      <div className="form-row">
        <label htmlFor="script-id">script</label>
        <select id="script-id" value={scriptId} onChange={(e) => select(e.target.value)}>
          <option value="">choose a script…</option>
          {scripts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id}.py
            </option>
          ))}
        </select>
      </div>
      <div className="button-row">
        <button onClick={create}>New…</button>
        <button onClick={() => void save().catch(fail)} disabled={!scriptId || source === saved}>
          Save
        </button>
        <button onClick={remove} disabled={!scriptId}>
          Delete
        </button>
      </div>
      {examples.length > 0 && (
        <div className="form-row">
          <label htmlFor="script-example">start from</label>
          <select
            id="script-example"
            value=""
            onChange={(e) => {
              useExample(e.target.value);
              e.currentTarget.value = '';
            }}
          >
            <option value="">an example…</option>
            {examples.map((e) => (
              <option key={e.id} value={e.id}>
                {e.id}.py
              </option>
            ))}
          </select>
        </div>
      )}
      <textarea
        ref={editorRef}
        className="script-editor"
        aria-label="Script source"
        spellCheck={false}
        value={source}
        onChange={(e) => setSource(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={!scriptId}
        rows={16}
      />
      <div className="form-row">
        <label htmlFor="script-input">input</label>
        <select id="script-input" value={inputId} onChange={(e) => setInputId(e.target.value)}>
          <option value="">the structure on screen</option>
          <option value="none">no structure</option>
          {structures.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name || s.id}
            </option>
          ))}
        </select>
      </div>
      <div className="button-row">
        <button onClick={() => void start()} disabled={!scriptId || busy || ACTIVE(run)}>
          Run
        </button>
        <button onClick={cancel} disabled={!ACTIVE(run)}>
          Cancel
        </button>
        {run && (
          <span className={run.status === 'failed' ? 'status-error' : 'muted'} role="status">
            {run.status}
          </span>
        )}
      </div>
      <p className="muted">
        Ctrl+Enter runs. A script runs as a separate program with your own permissions — it is not
        sandboxed, so treat one from elsewhere as you would any program.
      </p>
      {(output.stdout.length > 0 || output.stderr.length > 0) && (
        <div className="console script-output" ref={outputRef} data-testid="script-output">
          {output.stdout.map((line, i) => (
            <div key={`o${i}`} className="console-line">
              {line}
            </div>
          ))}
          {output.stderr.map((line, i) => (
            <div key={`e${i}`} className="console-line stream-stderr">
              {line}
            </div>
          ))}
        </div>
      )}
      {run?.error && (
        <p className="error-text">
          {run.error.type}: {run.error.message}
        </p>
      )}
      {values.length > 0 && (
        <table className="script-values">
          <tbody>
            {values.map(([key, v]) => (
              <tr key={key}>
                <th scope="row">{key}</th>
                <td>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {run && run.structure_ids.length > 0 && (
        <div className="script-outputs">
          <p className="muted">
            {run.structure_ids.length === 1
              ? 'The script saved one structure:'
              : `The script saved ${run.structure_ids.length} structures:`}
          </p>
          {run.structure_ids.map((id) => (
            <div key={id} className="form-row">
              <span>{structures.find((s) => s.id === id)?.name ?? id}</span>
              <button onClick={() => void open(id).catch(fail)}>Open</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
