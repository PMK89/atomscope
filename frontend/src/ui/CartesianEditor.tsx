import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { applyCartesian, formatCartesian, parseCartesian } from '../editor/cartesian';
import { useToolStore } from '../editor/toolStore';
import { useStructureStore } from '../state/structureStore';

const FOCUSABLE = 'textarea, button:not([disabled])';

/** Modal text editor for atom coordinates ("El x y z" per line). */
export function CartesianEditor(): JSX.Element | null {
  const open = useToolStore((s) => s.cartesianEditorOpen);
  const setOpen = useToolStore((s) => s.setCartesianEditorOpen);
  const doc = useStructureStore((s) => s.doc);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (open) {
      setText(formatCartesian(doc));
      setError(null);
    }
  }, [open, doc]);
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
      const lines = parseCartesian(text);
      const st = useStructureStore.getState();
      st.commit('Edit coordinates', applyCartesian(st.doc, lines));
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  /** Keep Tab inside the dialog and let Escape close it. */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
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
        <p className="muted">
          One atom per line: element symbol followed by x y z in Å. Changing the number of atoms
          re-perceives bonds.
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
          <button onClick={() => setText(formatCartesian(doc))}>Revert</button>
          <button onClick={() => setOpen(false)}>Close</button>
        </div>
      </div>
    </div>
  );
}
