import { useEffect, useRef, useState } from 'react';
import {
  applyCartesian,
  formatCoordinates,
  FORMAT_LABELS,
  parseCoordinates,
  sortedOrder,
  SORT_LABELS,
  UNIT_LABELS,
  type CoordinateFormat,
  type CoordinateUnit,
  type SortKey,
} from '../editor/cartesian';
import { reorderAtoms } from '../editor/edits';
import { useSelectionStore } from '../state/selectionStore';
import { useToolStore } from '../editor/toolStore';
import { dialogKeyHandler } from './dialogKeys';
import { useStructureStore } from '../state/structureStore';

/** Modal text editor for atom coordinates ("El x y z" per line). */
export function CartesianEditor(): JSX.Element | null {
  const open = useToolStore((s) => s.cartesianEditorOpen);
  const setOpen = useToolStore((s) => s.setCartesianEditorOpen);
  const doc = useStructureStore((s) => s.doc);
  const [text, setText] = useState('');
  const [unit, setUnit] = useState<CoordinateUnit>('angstrom');
  const [format, setFormat] = useState<CoordinateFormat>('xyz');
  const [error, setError] = useState<string | null>(null);
  const hasCell = !!doc.cell;
  const dialog = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!open) return;
    // a structure without a cell has no fractional coordinates; do not leave the box on them
    const shown = doc.cell || unit !== 'fractional' ? unit : 'angstrom';
    if (shown !== unit) setUnit(shown);
    setText(formatCoordinates(doc, shown, 5, format));
    setError(null);
  }, [open, doc, unit, format]);
  // move focus into the dialog and give it back to whatever had it when the dialog closes
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    textarea.current?.focus();
    return () => previous?.focus();
  }, [open]);
  if (!open) return null;
  const apply = (): void => {
    try {
      const lines = parseCoordinates(text, unit, doc.cell);
      const st = useStructureStore.getState();
      st.commit('Edit coordinates', applyCartesian(st.doc, lines));
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  /**
   * Sorting is an edit, not a view: the bonds, the per-atom properties, the constraints and the
   * residues are all by atom index, so the document is reordered and the text follows it. One
   * undo step, and it throws away whatever was typed into the box, which is what changing the
   * units already does.
   *
   * The selection is renumbered here. A pending Measure-tool pick is not -- it names atom
   * numbers that now mean other atoms, as it already does after a delete.
   */
  const sort = (key: SortKey): void => {
    if (key === 'none') return;
    const st = useStructureStore.getState();
    const order = sortedOrder(st.doc, key);
    if (order.every((from, to) => from === to)) return; // already in that order
    const place = new Map(order.map((from, to) => [from, to]));
    st.commit(`Sort atoms by ${SORT_LABELS[key].toLowerCase()}`, reorderAtoms(st.doc, order));
    const selection = useSelectionStore.getState();
    // the bond list itself is not reordered, only its endpoints renumbered, so it keeps its own
    selection.set(
      [...selection.atoms].map((i) => place.get(i)!).sort((a, b) => a - b),
      selection.bonds,
    );
    setError(null);
  };

  const onKeyDown = dialogKeyHandler(dialog, () => setOpen(false));
  return (
    <div className="dialog-backdrop" role="presentation" onKeyDown={onKeyDown}>
      <div
        className="dialog panel"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Cartesian editor"
      >
        <h3>Cartesian editor</h3>
        <div className="form-row">
          <label htmlFor="cartesian-unit">Units</label>
          <select
            id="cartesian-unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value as CoordinateUnit)}
          >
            {(['angstrom', 'bohr', 'fractional'] as const).map((u) => (
              <option key={u} value={u} disabled={u === 'fractional' && !hasCell}>
                {UNIT_LABELS[u]}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label htmlFor="cartesian-format">Format</label>
          <select
            id="cartesian-format"
            value={format}
            onChange={(e) => setFormat(e.target.value as CoordinateFormat)}
          >
            {(
              [
                'xyz',
                'xyz_numbered',
                'coords',
                'gamess',
                'gamess_name',
                'turbomole',
                'priroda',
              ] as const
            ).map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABELS[f]}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label htmlFor="cartesian-sort">Sort by</label>
          <select
            id="cartesian-sort"
            value="none"
            onChange={(e) => sort(e.target.value as SortKey)}
          >
            {(['none', 'element', 'x', 'y', 'z'] as const).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <p className="muted">
          One atom per line, x y z in {UNIT_LABELS[unit].toLowerCase()}
          {unit === 'fractional' ? ' coordinates of the cell' : ''}, laid out as the Format box
          says. What you type is read by its shape rather than by that box, so any of the layouts
          can be pasted in. Changing the units, the format or sorting rewrites the text from the
          structure. Changing the number of atoms re-perceives bonds. Sorting renumbers the atoms of
          the structure, in one undo step; by element puts the heaviest first.
          {!hasCell &&
            ' This structure has no unit cell, so fractional coordinates are not offered.'}
        </p>
        <textarea
          ref={textarea}
          aria-label="Coordinates"
          rows={16}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
        {error && <p className="form-error">{error}</p>}
        <div className="button-row">
          <button className="primary" onClick={apply}>
            Apply
          </button>
          <button onClick={() => setText(formatCoordinates(doc, unit, 5, format))}>Revert</button>
          <button onClick={() => setOpen(false)}>Close</button>
        </div>
      </div>
    </div>
  );
}
