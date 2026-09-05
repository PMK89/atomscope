import { useEffect, useRef, useState } from 'react';
import {
  applyCartesian,
  formatCoordinates,
  parseCoordinates,
  UNIT_LABELS,
  type CoordinateUnit,
} from '../editor/cartesian';
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
  const [error, setError] = useState<string | null>(null);
  const hasCell = !!doc.cell;
  const dialog = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!open) return;
    // a structure without a cell has no fractional coordinates; do not leave the box on them
    const shown = doc.cell || unit !== 'fractional' ? unit : 'angstrom';
    if (shown !== unit) setUnit(shown);
    setText(formatCoordinates(doc, shown));
    setError(null);
  }, [open, doc, unit]);
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
        <p className="muted">
          One atom per line: element symbol followed by x y z in {UNIT_LABELS[unit].toLowerCase()}
          {unit === 'fractional' ? ' coordinates of the cell' : ''}. Changing the units rewrites the
          text from the structure. Changing the number of atoms re-perceives bonds.
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
          <button onClick={() => setText(formatCoordinates(doc, unit))}>Revert</button>
          <button onClick={() => setOpen(false)}>Close</button>
        </div>
      </div>
    </div>
  );
}
