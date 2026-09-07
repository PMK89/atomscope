/**
 * The project's ASE database: which of these calculations was on iron, spin-polarized, at 30 Ry?
 *
 * The query box takes an ASE selection string and sends it to the server unchanged. That syntax
 * is worth learning once and is the same one `ase db` uses on the command line, so the panel
 * teaches it with examples rather than wrapping it in a form that could express less.
 */
import { useCallback, useEffect, useState } from 'react';

import { api, type DatabaseRow } from '../api/client';
import { useCalculationStore } from '../state/calculationStore';

const EXAMPLES: { query: string; means: string }[] = [
  { query: 'Fe', means: 'contains iron' },
  { query: 'Fe,O', means: 'contains both iron and oxygen' },
  { query: 'natoms<4', means: 'fewer than four atoms' },
  { query: 'energy<-500', means: 'total energy below −500 eV' },
  { query: 'charge=-1', means: 'singly charged anions' },
  { query: 'magmom>0', means: 'has a magnetic moment' },
  { query: 'spin_polarized=True', means: 'a parameter, by name' },
  { query: 'Si,epwpsi=30', means: 'silicon at a 30 Ry cutoff' },
];

/** The columns worth a table: the identity, the chemistry, the answer. */
function Row({ row, onOpen }: { row: DatabaseRow; onOpen: (id: string) => void }): JSX.Element {
  const extras = Object.entries(row.keys ?? {})
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .slice(0, 6);
  return (
    <tr>
      <td>
        {row.calculation_id ? (
          <button className="link" onClick={() => onOpen(row.calculation_id!)}>
            {row.name ?? row.calculation_id}
          </button>
        ) : (
          (row.name ?? '—')
        )}
      </td>
      <td>{row.formula}</td>
      <td className="numeric">{row.natoms}</td>
      <td className="numeric">{row.energy == null ? '—' : row.energy.toFixed(3)}</td>
      <td className="numeric">{row.charge == null ? '0' : row.charge.toFixed(2)}</td>
      <td className="numeric">{row.magmom == null ? '—' : row.magmom.toFixed(2)}</td>
      <td title={extras.map(([k, v]) => `${k}=${String(v)}`).join('\n')}>
        {extras.length === 0 ? '—' : `${extras.length} more`}
      </td>
    </tr>
  );
}

export function DatabasePanel({ onError }: { onError: (message: string) => void }): JSX.Element {
  // selecting a row selects the calculation everywhere: the Analysis tab then shows its results
  const selectCalculation = useCalculationStore((s) => s.select);
  const [selection, setSelection] = useState('');
  const [applied, setApplied] = useState('');
  const [rows, setRows] = useState<DatabaseRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState<string | null>(null);

  const load = useCallback(
    async (query: string) => {
      setBusy(true);
      try {
        const result = await api.database.select(query || undefined);
        setRows(result.rows);
        setTotal(result.total);
        setApplied(query);
      } catch (e) {
        onError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [onError],
  );

  useEffect(() => {
    void load('');
    api.database
      .path()
      .then((p) => setPath(p.exists ? p.path : null))
      .catch(() => setPath(null));
  }, [load]);

  const reindex = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await api.database.reindex();
      if (result.problems?.length) onError(result.problems.join('; '));
      await load(applied);
      const p = await api.database.path();
      setPath(p.exists ? p.path : null);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel panel-body">
      <p className="muted">
        Every finished calculation in this project, selectable by what is in it. The query is an{' '}
        <code>ase.db</code> selection string.
      </p>

      <div className="form-row">
        <label htmlFor="db-selection">Selection</label>
        <input
          id="db-selection"
          value={selection}
          placeholder="Fe,epwpsi=30"
          onChange={(e) => setSelection(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void load(selection);
          }}
        />
      </div>
      <div className="button-row">
        <button className="primary" onClick={() => void load(selection)} disabled={busy}>
          Select
        </button>
        <button
          onClick={() => {
            setSelection('');
            void load('');
          }}
          disabled={busy || (!selection && !applied)}
        >
          All
        </button>
        <button onClick={() => void reindex()} disabled={busy} title="Rebuild from the project">
          Rebuild
        </button>
      </div>

      <p className="chart-legend">
        {EXAMPLES.map((e) => (
          <button
            key={e.query}
            className="link"
            title={e.means}
            onClick={() => {
              setSelection(e.query);
              void load(e.query);
            }}
          >
            <code>{e.query}</code>
          </button>
        ))}
      </p>

      {rows === null ? (
        <p className="muted">Reading the database…</p>
      ) : total === 0 ? (
        <p className="muted">
          No calculations indexed yet. A calculation joins the database when its results are
          collected; <strong>Rebuild</strong> indexes a project that finished before the database
          existed.
        </p>
      ) : (
        <>
          <p className="muted" role="status">
            {applied ? `${rows.length} of ${total} match ${applied}` : `${total} calculations`}
            {applied && rows.length === 0 && (
              <>
                {' '}
                — a bare word is read as <em>has this key</em>, so a typo matches nothing rather
                than failing.
              </>
            )}
          </p>
          <div className="orbital-table-wrap">
            <table className="orbital-table">
              <thead>
                <tr>
                  <th>calculation</th>
                  <th>formula</th>
                  <th className="numeric">atoms</th>
                  <th className="numeric">E [eV]</th>
                  <th className="numeric">magmom</th>
                  <th>parameters</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Row key={r.id} row={r} onOpen={selectCalculation} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {path && (
        <p className="muted">
          The file is <code>{path}</code> — <code>ase db</code> and <code>ase gui</code> open it
          directly.
        </p>
      )}
    </div>
  );
}
