/**
 * Molecular symmetry in the Properties panel (Avogadro 1: View > Properties > Symmetry).
 *
 * Detection is a backend call rather than a local computation because it needs the atomic masses
 * and the same tolerance semantics as `symmetrize`, whose idealized geometry is committed as one
 * undo step.
 */
import { useState } from 'react';
import { api, type PointGroupResult } from '../api/client';
import { toApiStructure } from '../api/structureBody';
import { normalizeStructure } from '../model/structure';
import { useStructureStore } from '../state/structureStore';

type Tolerance = 'loose' | 'normal' | 'tight';

const TOLERANCES: { id: Tolerance; label: string }[] = [
  { id: 'loose', label: 'Loose (0.3 A)' },
  { id: 'normal', label: 'Normal (0.1 A)' },
  { id: 'tight', label: 'Tight (0.02 A)' },
];

/** Schoenflies symbols carry an infinity that the backend writes as '*'. */
export function prettySymbol(symbol: string): string {
  return symbol.replace('*', '∞');
}

export function SymmetrySection({ onError }: { onError?: (m: string) => void }): JSX.Element {
  const doc = useStructureStore((s) => s.doc);
  const commit = useStructureStore((s) => s.commit);
  const [tolerance, setTolerance] = useState<Tolerance>('normal');
  const [result, setResult] = useState<PointGroupResult | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = (e: Error): void => (onError ? onError(e.message) : undefined);

  const detect = async (): Promise<void> => {
    setBusy(true);
    try {
      setResult(await api.chem.pointGroup({ structure: toApiStructure(doc), tolerance }));
    } finally {
      setBusy(false);
    }
  };

  const idealize = async (): Promise<void> => {
    setBusy(true);
    try {
      const idealized = await api.chem.symmetrize({
        structure: toApiStructure(doc),
        tolerance,
      });
      const next = normalizeStructure({ ...idealized, id: doc.id });
      commit('Symmetrize', {
        ...next,
        // keep atom identities so the selection and the undo history stay meaningful
        atoms: next.atoms.map((a, i) => {
          const uid = doc.atoms[i]?.uid;
          return uid ? { ...a, uid } : a;
        }),
      });
      setResult(
        await api.chem.pointGroup({ structure: toApiStructure({ ...doc, ...next }), tolerance }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3>Symmetry</h3>
      <div className="form-row">
        <label htmlFor="symmetry-tolerance">Tolerance</label>
        <select
          id="symmetry-tolerance"
          value={tolerance}
          onChange={(e) => {
            setTolerance(e.target.value as Tolerance);
            setResult(null);
          }}
        >
          {TOLERANCES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label>Point group</label>
        <span data-testid="point-group">
          {result ? prettySymbol(result.symbol) : '—'}
          {result && result.order > 0 ? ` (order ${result.order})` : ''}
        </span>
      </div>
      {result && (
        <div className="form-row">
          <label>Operations</label>
          <span className="muted">{result.operations.join(', ')}</span>
        </div>
      )}
      <div className="button-row">
        <button onClick={() => void detect().catch(fail)} disabled={busy || !doc.atoms.length}>
          Detect symmetry
        </button>
        <button onClick={() => void idealize().catch(fail)} disabled={busy || !doc.atoms.length}>
          Symmetrize
        </button>
      </div>
    </>
  );
}
