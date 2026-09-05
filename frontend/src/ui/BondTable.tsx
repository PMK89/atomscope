/**
 * Avogadro's Bond Properties table: every bond (or every bond of the selection) with its order,
 * whether it can rotate, and an editable length. Editing a length moves the smaller side, the
 * same rule the bond-centric tool follows.
 */
import { useMemo } from 'react';
import { setBondLength, setBondOrder } from '../editor/edits';
import { movingSide } from '../editor/tools/BondCentricTool';
import { bondRowCount, bondRows, MAX_BOND_ROWS } from '../model/bondTable';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import { NumberField } from './NumberField';

const ORDERS = [1, 2, 3] as const;

export function BondTable(): JSX.Element {
  const doc = useStructureStore((s) => s.doc);
  const commit = useStructureStore((s) => s.commit);
  const selected = useSelectionStore((s) => s.atoms);
  const rows = useMemo(() => bondRows(doc, selected), [doc, selected]);
  const total = useMemo(() => bondRowCount(doc, selected), [doc, selected]);

  if (doc.bonds.length === 0) return <p className="muted">No bonds.</p>;
  return (
    <>
      {selected.size > 0 && <p className="muted">Bonds of the {selected.size} selected atom(s).</p>}
      <div className="orbital-table-wrap">
        <table className="orbital-table bond-table">
          <thead>
            <tr>
              <th>Bond</th>
              <th>Order</th>
              <th>Rotatable</th>
              <th>Length (Å)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.index}>
                <td>{r.label}</td>
                <td>
                  <select
                    aria-label={`order of ${r.label}`}
                    value={r.order}
                    onChange={(e) =>
                      commit(
                        'Set bond order',
                        setBondOrder(doc, r.index, Number(e.target.value) as 1 | 2 | 3),
                      )
                    }
                  >
                    {ORDERS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                  {r.aromatic && ' ar'}
                </td>
                <td>{r.ring ? 'ring' : r.rotatable ? 'yes' : 'no'}</td>
                <td>
                  <NumberField
                    value={r.length}
                    digits={3}
                    label={`length of ${r.label}`}
                    onCommit={(v) =>
                      commit(
                        'Set bond length',
                        setBondLength(doc, r.index, v, movingSide(doc, r.index).atoms),
                      )
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > rows.length && (
        <p className="muted">
          Showing {MAX_BOND_ROWS} of {total} bonds. Select atoms to see theirs.
        </p>
      )}
    </>
  );
}
