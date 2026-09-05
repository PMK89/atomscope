import { useEffect, useState } from 'react';
import { applyCartesian, formatCartesian, parseCartesian } from '../editor/cartesian';
import { useToolStore } from '../editor/toolStore';
import { useStructureStore } from '../state/structureStore';

/** Modal text editor for atom coordinates ("El x y z" per line). */
export function CartesianEditor(): JSX.Element | null {
  const open = useToolStore((s) => s.cartesianEditorOpen);
  const setOpen = useToolStore((s) => s.setCartesianEditorOpen);
  const doc = useStructureStore((s) => s.doc);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setText(formatCartesian(doc));
      setError(null);
    }
  }, [open, doc]);
  if (!open) return null;
  const apply = (): void => {
    try {
      const lines = parseCartesian(text);
      const st = useStructureStore.getState();
      st.commit('Edit coordinates', applyCartesian(st.doc, lines));
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="dialog-backdrop" role="dialog" aria-label="Cartesian editor">
      <div className="dialog panel">
        <h3>Cartesian editor</h3>
        <p className="muted">
          One atom per line: element symbol followed by x y z in Å. Changing the number of atoms
          re-perceives bonds.
        </p>
        <textarea
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
          <button onClick={() => setText(formatCartesian(doc))}>Revert</button>
          <button onClick={() => setOpen(false)}>Close</button>
        </div>
      </div>
    </div>
  );
}
