/**
 * Avogadro's crystal paste dialog: a POSCAR that counts its species without naming them, and the
 * elements those counts belong to.
 *
 * VASP 4 kept the element symbols in the POTCAR beside the file, so a pasted POSCAR carries only
 * "2 4" and the reader has to be told that means two silicons and four oxygens. The backend says
 * how many species there are and how many atoms each has; this asks for the rest and pastes again.
 */
import { useEffect, useRef, useState } from 'react';
import { usePasteStore } from '../state/pasteStore';
import { pasteWithSpecies } from './clipboardActions';
import { dialogKeyHandler } from './dialogKeys';

export function SpeciesDialog({ onError }: { onError: (m: string) => void }): JSX.Element | null {
  const pending = usePasteStore((s) => s.pending);
  const cancel = usePasteStore((s) => s.cancel);
  const [symbols, setSymbols] = useState<string[]>([]);
  const first = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const counts = pending?.counts;

  useEffect(() => {
    if (!counts) return;
    setSymbols(counts.map(() => ''));
    const previous = document.activeElement as HTMLElement | null;
    first.current?.focus();
    return () => previous?.focus();
  }, [counts]);

  if (!pending) return null;
  const ready = symbols.length === pending.counts.length && symbols.every((s) => s.trim());
  const total = pending.counts.reduce((a, b) => a + b, 0);

  const paste = (): void => {
    const species = symbols.map((s) => s.trim());
    cancel();
    void pasteWithSpecies(pending.text, species, onError);
  };

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onKeyDown={dialogKeyHandler(dialog, cancel)}
    >
      <div
        className="dialog panel"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Elements of the pasted crystal"
      >
        <h3>Elements of the pasted crystal</h3>
        <p className="muted">
          This POSCAR counts {pending.counts.length} species ({total} atoms) but does not name them;
          VASP 4 kept the elements in the POTCAR. Say which element each one is.
        </p>
        {pending.counts.map((count, i) => (
          <div className="form-row" key={i}>
            <label htmlFor={`species-${i}`}>
              Species {i + 1} ({count} atom{count === 1 ? '' : 's'})
            </label>
            <input
              id={`species-${i}`}
              ref={i === 0 ? first : undefined}
              value={symbols[i] ?? ''}
              size={4}
              maxLength={3}
              onChange={(e) =>
                setSymbols((prev) => prev.map((s, j) => (j === i ? e.target.value : s)))
              }
            />
          </div>
        ))}
        <div className="button-row">
          <button type="button" onClick={paste} disabled={!ready}>
            Paste
          </button>
          <button type="button" onClick={cancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
