/**
 * Avogadro's Angle and Torsion Properties tables, as sections of the Properties tab: every angle
 * (or torsion) of the structure, or of the selection, with the value editable.
 *
 * Typing a value turns the far side of the bond, the same rule the bond table follows for a
 * length. A value inside a ring has no far side -- turning one part of a ring about an axis would
 * tear it open -- so it is shown read-only, the way a bond through the cell boundary is.
 */
import { useMemo } from 'react';
import { setAngle, setTorsion } from '../editor/edits';
import {
  AUTO_TABLE_ATOMS,
  angleRowCount,
  angleRows,
  MAX_ANGLE_ROWS,
  torsionRowCount,
  torsionRows,
} from '../model/angleTable';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import { NumberField } from './NumberField';

/** One table over rows that are all `{label, value, moving}`; the caller says how to commit one. */
function ValueTable<Row extends { label: string; value: number; moving: number[] | null }>({
  rows,
  total,
  heading,
  waiting,
  onCommit,
  explain,
}: {
  rows: Row[];
  total: number;
  heading: string;
  waiting: boolean;
  onCommit: (row: Row, value: number) => void;
  /** why a row cannot be typed; shown on the value and collected into the footnote */
  explain: (row: Row) => string;
}): JSX.Element {
  const selected = useSelectionStore((s) => s.atoms);
  if (waiting) {
    return (
      <p className="muted">
        {total} {heading.toLowerCase()}. Select atoms to list theirs.
      </p>
    );
  }
  if (rows.length === 0) return <p className="muted">No {heading.toLowerCase()}.</p>;
  return (
    <>
      {selected.size > 0 && (
        <p className="muted">
          {heading} of the {selected.size} selected atom(s).
        </p>
      )}
      <div className="orbital-table-wrap">
        <table className="orbital-table bond-table">
          <thead>
            <tr>
              <th>{heading.replace(/s$/, '')}</th>
              <th>Value (°)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td>
                  {r.moving === null ? (
                    <span title={explain(r)}>{r.value.toFixed(2)} *</span>
                  ) : (
                    <NumberField
                      value={r.value}
                      digits={2}
                      label={`value of ${r.label}`}
                      onCommit={(v) => onCommit(r, v)}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {[...new Set(rows.filter((r) => r.moving === null).map(explain))].map((why) => (
        <p className="muted" key={why}>
          * {why}
        </p>
      ))}
      {total > rows.length && (
        <p className="muted">
          Showing {MAX_ANGLE_ROWS} of {total}. Select atoms to see theirs.
        </p>
      )}
    </>
  );
}

export function AngleTable(): JSX.Element {
  const doc = useStructureStore((s) => s.doc);
  const commit = useStructureStore((s) => s.commit);
  const selected = useSelectionStore((s) => s.atoms);
  // the dock stays mounted, so this runs on every edit: do not enumerate a protein per keystroke
  const waiting = selected.size === 0 && doc.atoms.length > AUTO_TABLE_ATOMS;
  const rows = useMemo(() => (waiting ? [] : angleRows(doc, selected)), [doc, selected, waiting]);
  // the count is connectivity only: keyed on the document it would run on every frame of a drag
  const total = useMemo(
    () => angleRowCount(doc.atoms.length, doc.bonds, selected),
    [doc.atoms.length, doc.bonds, selected],
  );
  return (
    <ValueTable
      rows={rows}
      total={total}
      heading="Angles"
      waiting={waiting}
      onCommit={(r, v) => commit('Set angle', setAngle(doc, r.a, r.b, r.c, v, r.moving!))}
      explain={(r) =>
        r.straight
          ? 'a straight angle: the three atoms are in a line, so there is no plane to turn in.'
          : 'inside a ring: turning one side would tear it open.'
      }
    />
  );
}

export function TorsionTable(): JSX.Element {
  const doc = useStructureStore((s) => s.doc);
  const commit = useStructureStore((s) => s.commit);
  const selected = useSelectionStore((s) => s.atoms);
  const waiting = selected.size === 0 && doc.atoms.length > AUTO_TABLE_ATOMS;
  const rows = useMemo(() => (waiting ? [] : torsionRows(doc, selected)), [doc, selected, waiting]);
  const total = useMemo(
    () => torsionRowCount(doc.atoms.length, doc.bonds, selected),
    [doc.atoms.length, doc.bonds, selected],
  );
  return (
    <ValueTable
      rows={rows}
      total={total}
      heading="Torsions"
      waiting={waiting}
      onCommit={(r, v) => commit('Set torsion', setTorsion(doc, r.a, r.b, r.c, r.d, v, r.moving!))}
      explain={() => 'about a ring bond: turning one side would tear the ring open.'}
    />
  );
}
