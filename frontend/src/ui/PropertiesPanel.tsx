import { bondsOfAtom, minimumImageDistance } from '../model/connectivity';
import { formula, type StructureDoc, type Vec3 } from '../model/structure';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import { useToolStore } from '../editor/toolStore';
import { BondTable } from './BondTable';
import { NumberField } from './NumberField';
import { normalizeSymbol } from '../editor/cartesian';
import { ELEMENT_BY_SYMBOL } from '../model/elements';
import { cartToFrac } from '../model/crystal';
import { SymmetrySection } from './SymmetrySection';

function cellLengths(doc: StructureDoc): [number, number, number] | null {
  if (!doc.cell) return null;
  return doc.cell.vectors.map((v) => Math.hypot(...v)) as [number, number, number];
}

/** Right-dock tab: selected atom(s) and structure-level properties, all editable via commit. */
export function PropertiesPanel({ onError }: { onError?: (m: string) => void }): JSX.Element {
  const doc = useStructureStore((s) => s.doc);
  const commit = useStructureStore((s) => s.commit);
  const selected = useSelectionStore((s) => s.atoms);
  const openEditor = useToolStore((s) => s.setCartesianEditorOpen);
  const idx = [...selected].filter((i) => i < doc.atoms.length).sort((a, b) => a - b);
  const atom = idx.length === 1 ? doc.atoms[idx[0]!] : undefined;
  const lengths = cellLengths(doc);

  const setAtom = (label: string, patch: Partial<StructureDoc['atoms'][number]>): void => {
    const i = idx[0]!;
    const atoms = [...doc.atoms];
    atoms[i] = { ...atoms[i]!, ...patch };
    commit(label, { ...doc, atoms });
  };

  return (
    <div className="panel properties-panel">
      <h3>Structure</h3>
      <div className="form-row">
        <label>Name</label>
        <input
          aria-label="Structure name"
          defaultValue={doc.name}
          key={doc.id + doc.name}
          onBlur={(e) =>
            e.target.value !== doc.name && commit('Rename', { ...doc, name: e.target.value })
          }
        />
      </div>
      <div className="form-row">
        <label>Formula</label>
        <span>{formula(doc) || '—'}</span>
      </div>
      <div className="form-row">
        <label>Atoms / bonds</label>
        <span>
          {doc.atoms.length} / {doc.bonds.length}
        </span>
      </div>
      <div className="form-row">
        <label>Charge</label>
        <NumberField
          value={doc.charge}
          digits={0}
          step={1}
          label="Charge"
          onCommit={(v) => commit('Set charge', { ...doc, charge: Math.round(v) })}
        />
      </div>
      <div className="form-row">
        <label>Multiplicity</label>
        <NumberField
          value={doc.multiplicity ?? 1}
          digits={0}
          step={1}
          label="Multiplicity"
          onCommit={(v) =>
            commit('Set multiplicity', { ...doc, multiplicity: Math.max(1, Math.round(v)) })
          }
        />
      </div>
      {lengths && doc.cell && (
        <div className="form-row">
          <label>Cell (Å)</label>
          <span>
            {lengths.map((l) => l.toFixed(3)).join(' × ')} · pbc{' '}
            {doc.cell.pbc.map((p) => (p ? 'T' : 'F')).join('')}
          </span>
        </div>
      )}
      <div className="button-row">
        <button onClick={() => openEditor(true)}>Cartesian editor…</button>
      </div>

      <SymmetrySection {...(onError ? { onError } : {})} />

      <h3>Selection</h3>
      {idx.length === 0 && <p className="muted">No atoms selected.</p>}
      {idx.length > 1 && (
        <p className="muted">
          {idx.length} atoms selected:{' '}
          {idx.map((i) => `${doc.atoms[i]!.element}${i + 1}`).join(', ')}
        </p>
      )}
      {atom && (
        <>
          <div className="form-row">
            <label>Atom</label>
            <span>
              {atom.element}
              {idx[0]! + 1} (index {idx[0]})
            </span>
          </div>
          <div className="form-row">
            <label>Element</label>
            <input
              aria-label="Atom element"
              key={atom.uid}
              defaultValue={atom.element}
              onBlur={(e) => {
                const el = normalizeSymbol(e.target.value);
                if (ELEMENT_BY_SYMBOL.has(el) && el !== 'X' && el !== atom.element) {
                  setAtom(`Change to ${el}`, { element: el });
                } else e.target.value = atom.element;
              }}
            />
          </div>
          <div className="form-row">
            <label>Position (Å)</label>
            <div className="form-vector">
              {atom.position.map((v, k) => (
                <NumberField
                  key={k}
                  value={v}
                  label={`Position ${'xyz'[k]}`}
                  onCommit={(x) => {
                    const p = [...atom.position] as Vec3;
                    p[k] = x;
                    setAtom('Move 1 atom', { position: p });
                  }}
                />
              ))}
            </div>
          </div>
          {doc.cell && (
            <div className="form-row">
              <label>Fractional</label>
              <span>
                {cartToFrac(atom.position, doc.cell)
                  .map((f) => f.toFixed(4))
                  .join(' ')}
              </span>
            </div>
          )}
          <div className="form-row">
            <label>Formal charge</label>
            <NumberField
              value={atom.formal_charge}
              digits={0}
              step={1}
              label="Formal charge"
              onCommit={(v) => setAtom('Set formal charge', { formal_charge: Math.round(v) })}
            />
          </div>
          <div className="form-row">
            <label>Label</label>
            <input
              aria-label="Atom label"
              key={`${atom.uid}-label`}
              defaultValue={atom.label ?? ''}
              onBlur={(e) => {
                const label = e.target.value || null;
                if (label !== (atom.label ?? null)) setAtom('Set label', { label });
              }}
            />
          </div>
          <h4>Bonds</h4>
          <ul className="tree">
            {bondsOfAtom(doc, idx[0]!).map((bi) => {
              const b = doc.bonds[bi]!;
              const other = b.a === idx[0] ? b.b : b.a;
              const o = doc.atoms[other]!;
              return (
                <li key={bi} className="muted">
                  {o.element}
                  {other + 1} · order {b.order} ·{' '}
                  {minimumImageDistance(atom.position, o.position, doc.cell).toFixed(3)} Å
                </li>
              );
            })}
            {bondsOfAtom(doc, idx[0]!).length === 0 && <li className="muted">none</li>}
          </ul>
        </>
      )}

      <h3>Bonds</h3>
      <BondTable />
    </div>
  );
}
