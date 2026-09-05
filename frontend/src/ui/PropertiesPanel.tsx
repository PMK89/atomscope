import { useEffect } from 'react';
import { bondsOfAtom, minimumImageDistance } from '../model/connectivity';
import { formula, molecularWeight, type StructureDoc, type Vec3 } from '../model/structure';
import { partialCharges } from '../renderer/labels';
import { setPartialCharge } from '../editor/edits';
import { useAtomTypeStore } from '../state/atomTypeStore';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import { useToolStore } from '../editor/toolStore';
import { AngleTable, TorsionTable } from './AngleTable';
import { BondTable } from './BondTable';
import { NumberField } from './NumberField';
import { normalizeSymbol } from '../editor/cartesian';
import { ELEMENT_BY_SYMBOL } from '../model/elements';
import { cartToFrac } from '../model/crystal';
import { SymmetrySection } from './SymmetrySection';

/** A quantity attached to the document (a dipole from partial charges, an energy from an output). */
function quantity(q: { value: number; unit: string }): string {
  const abs = Math.abs(q.value);
  const value =
    abs !== 0 && (abs < 1e-3 || abs >= 1e6) ? q.value.toExponential(4) : q.value.toFixed(4);
  return `${value} ${q.unit}`;
}

function cellLengths(doc: StructureDoc): [number, number, number] | null {
  if (!doc.cell) return null;
  return doc.cell.vectors.map((v) => Math.hypot(...v)) as [number, number, number];
}

/**
 * "Valence" means two things -- Avogadro's column was Open Babel's `GetValence()`, the number of
 * bonds -- so both are shown rather than one being picked.
 */
function valence(doc: StructureDoc, atom: number): string {
  const bonds = bondsOfAtom(doc, atom);
  const sum = bonds.reduce((total, bi) => total + (doc.bonds[bi]?.order ?? 0), 0);
  return `${bonds.length} bond${bonds.length === 1 ? '' : 's'}, order sum ${Number(sum.toFixed(2))}`;
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
  const charges = partialCharges(doc);

  // Open Babel's atom type is a function of the current graph, so it is fetched per revision and
  // only while an atom is selected -- nothing else on this panel shows it (state/atomTypeStore.ts)
  const revision = useStructureStore((s) => s.revision);
  const typing = useAtomTypeStore((s) => s.typing);
  const loadTypes = useAtomTypeStore((s) => s.load);
  const wantsTypes = atom !== undefined;
  useEffect(() => {
    if (wantsTypes) void loadTypes(doc, revision);
  }, [wantsTypes, doc, revision, loadTypes]);

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
        <label>Molecular weight</label>
        <span>{molecularWeight(doc).toFixed(3)} g/mol</span>
      </div>
      {doc.residues.length > 0 && (
        <div className="form-row">
          <label>Residues</label>
          <span>{doc.residues.length}</span>
        </div>
      )}
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
      {Object.entries(doc.properties).map(([key, q]) => (
        <div className="form-row" key={key}>
          <label>{key.replace(/_/g, ' ')}</label>
          <span>{quantity(q)}</span>
        </div>
      ))}
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
            <label>Type</label>
            <span>{typing?.types[idx[0]!] ?? '—'}</span>
          </div>
          <div className="form-row">
            <label>Valence</label>
            <span>{valence(doc, idx[0]!)}</span>
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
          {charges.length > 0 && (
            <div className="form-row">
              <label>Partial charge</label>
              <NumberField
                value={charges[idx[0]!]!}
                digits={3}
                step={0.01}
                label="Partial charge"
                onCommit={(v) => commit('Set partial charge', setPartialCharge(doc, idx[0]!, v))}
              />
            </div>
          )}
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

      <h3>Angles</h3>
      <AngleTable />

      <h3>Torsions</h3>
      <TorsionTable />
    </div>
  );
}
