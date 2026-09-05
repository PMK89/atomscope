/**
 * Avogadro's Constraints dialog: the geometric constraints the force field has to respect,
 * added from the current selection and held with the document (File ▸ Save keeps them).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CONSTRAINT_KINDS,
  constraintRows,
  constraintsJson,
  kindInfo,
  makeConstraint,
  parseConstraintsJson,
  rowKey,
  withRowValue,
  withoutRows,
  type ConstraintKind,
  type ConstraintRow,
} from '../editor/constraints';
import { useToolStore } from '../editor/toolStore';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import { dialogKeyHandler } from './dialogKeys';

const FOCUSABLE = 'input, select, button:not([disabled])';

const fmt = (v: number | null, unit: string): string =>
  v === null ? '—' : `${v.toFixed(3)}${unit ? ` ${unit}` : ''}`;

/** "C1, O3" for the atoms of a row, in the numbering the labels use. */
const atomNames = (row: ConstraintRow, elements: readonly string[]): string =>
  row.atoms.map((i) => `${elements[i] ?? '?'}${i + 1}`).join(', ');

export function ConstraintsDialog(): JSX.Element | null {
  const open = useToolStore((s) => s.constraintsDialogOpen);
  const setOpen = useToolStore((s) => s.setConstraintsDialogOpen);
  const doc = useStructureStore((s) => s.doc);
  const selection = useSelectionStore((s) => s.atoms);
  const [kind, setKind] = useState<ConstraintKind>('fix');
  const [atomText, setAtomText] = useState<string[]>(['']);
  const [valueText, setValueText] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  // what is being typed into a row's value field, until Enter or blur commits it
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const rows = useMemo(() => constraintRows(doc), [doc]);
  const elements = useMemo(() => doc.atoms.map((a) => a.element), [doc]);
  const arity = kindInfo(kind).atoms;

  // the selection fills the atom fields, in the order the atoms were picked
  useEffect(() => {
    const chosen = [...selection].slice(0, arity);
    setAtomText(
      Array.from({ length: arity }, (_, i) =>
        chosen[i] === undefined ? '' : String(chosen[i]! + 1),
      ),
    );
  }, [selection, arity]);
  useEffect(() => {
    if (open) setError(null);
    else setPicked(new Set());
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => previous?.focus();
  }, [open]);
  if (!open) return null;

  const commit = (label: string, constraints: ReturnType<typeof withoutRows>): void => {
    const st = useStructureStore.getState();
    st.commit(label, { ...st.doc, constraints });
    setPicked(new Set());
  };

  const add = (): void => {
    // an empty field is not atom zero
    const atoms = atomText.map((t) => (t.trim() === '' ? NaN : Number(t.trim()) - 1));
    if (atoms.some((n) => !Number.isFinite(n))) {
      setError('every atom field needs a number');
      return;
    }
    const raw = valueText.trim();
    const value = raw === '' ? null : Number(raw);
    if (value !== null && !Number.isFinite(value)) {
      setError('the value has to be a number, or empty to hold what the geometry has');
      return;
    }
    const made = makeConstraint(doc, kind, atoms, value);
    if (typeof made === 'string') {
      setError(made);
      return;
    }
    setError(null);
    commit(`Add ${kindInfo(kind).label.toLowerCase()} constraint`, [...doc.constraints, made]);
    setValueText('');
  };

  const draft = (row: ConstraintRow, text: string): void =>
    setDrafts((d) => ({ ...d, [rowKey(row)]: text }));

  /**
   * Commit what was typed into a row. Committing on every keystroke instead would make "-60"
   * and "1.54" impossible to type: the intermediate "-" and "1." are not numbers, and each
   * keystroke that did parse would be its own undo step.
   */
  const commitDraft = (row: ConstraintRow): void => {
    const text = drafts[rowKey(row)];
    if (text === undefined) return;
    const raw = text.trim();
    const value = raw === '' ? null : Number(raw);
    setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([key]) => key !== rowKey(row))));
    if (value !== null && !Number.isFinite(value)) {
      setError(`${raw} is not a number`);
      return;
    }
    setError(null);
    if (value !== row.value) commit('Constraint value', withRowValue(doc, row, value));
  };

  const toggle = (i: number): void =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const save = (): void => {
    const blob = new Blob([constraintsJson(doc.constraints)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.name || 'structure'}-constraints.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const load = async (f: File | undefined): Promise<void> => {
    if (!f) return;
    try {
      commit('Load constraints', parseConstraintsJson(await f.text()));
      setError(null);
    } catch (e) {
      setError(`Could not read ${f.name}: ${(e as Error).message}`);
    }
  };

  const onKeyDown = dialogKeyHandler(dialog, () => setOpen(false));

  return (
    <div className="dialog-backdrop" role="presentation" onKeyDown={onKeyDown}>
      <div
        className="dialog panel"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Constraints"
      >
        <h3>Constraints</h3>
        <p className="muted">
          Held by geometry optimization and conformer search. A distance, angle or torsion with no
          value of its own keeps whatever the geometry has when the optimization starts. Ignored
          atoms are left out of the force field entirely; ASE-driven calculations do not see them.
        </p>
        <div className="orbital-table-wrap">
          <table className="orbital-table constraint-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Atoms</th>
                <th>Value</th>
                <th>Now</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const info = kindInfo(row.kind);
                return (
                  <tr
                    key={rowKey(row)}
                    className={picked.has(i) ? 'selected' : ''}
                    onClick={() => toggle(i)}
                  >
                    <td>{info.label}</td>
                    <td>{atomNames(row, elements)}</td>
                    <td>
                      {row.current === null ? (
                        '—'
                      ) : (
                        <input
                          aria-label={`value of constraint ${i + 1}`}
                          value={
                            drafts[rowKey(row)] ?? (row.value === null ? '' : String(row.value))
                          }
                          placeholder="as built"
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => draft(row, e.target.value)}
                          onBlur={() => commitDraft(row)}
                          onKeyDown={(e) => e.key === 'Enter' && commitDraft(row)}
                        />
                      )}
                    </td>
                    <td>{fmt(row.current, info.unit)}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No constraints yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="constraint-add">
          <label htmlFor="constraint-kind">Add</label>
          <select
            id="constraint-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as ConstraintKind)}
          >
            {CONSTRAINT_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          {atomText.map((t, i) => (
            // the atom fields are positional, so the index is the identity
            <input
              key={i}
              aria-label={`atom ${i + 1}`}
              value={t}
              onChange={(e) =>
                setAtomText((a) => a.map((old, j) => (j === i ? e.target.value : old)))
              }
            />
          ))}
          {kindInfo(kind).unit && (
            <input
              className="constraint-value"
              aria-label="target value"
              placeholder={`as built (${kindInfo(kind).unit})`}
              value={valueText}
              onChange={(e) => setValueText(e.target.value)}
            />
          )}
          <button onClick={add}>Add</button>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="button-row">
          <button
            disabled={picked.size === 0}
            onClick={() =>
              commit(
                'Delete constraints',
                withoutRows(
                  doc,
                  rows.filter((_, i) => picked.has(i)),
                ),
              )
            }
          >
            Delete selected
          </button>
          <button disabled={rows.length === 0} onClick={() => commit('Delete constraints', [])}>
            Delete all
          </button>
          <button onClick={save}>Save…</button>
          <button onClick={() => file.current?.click()}>Load…</button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              void load(e.target.files?.[0]);
              // let the same file be chosen again after it was edited on disk
              e.target.value = '';
            }}
          />
          <button className="primary" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
