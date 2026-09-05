/**
 * Build > Insert dialogs: the fragment library, a peptide, a nucleic acid and a nanotube or
 * graphene sheet (Avogadro 1's Build > Insert submenu).
 *
 * Everything is inserted through `/api/build/insert`, so one rule covers all of them: with a
 * single atom selected the fragment is attached to it (replacing a hydrogen), otherwise it is
 * placed beside the existing molecule. The result is one labelled undo step.
 */
import { useEffect, useState } from 'react';
import { api, type FragmentInfo, type Structure } from '../api/client';
import { toApiStructure } from '../api/structureBody';
import { normalizeStructure } from '../model/structure';
import { useBuildStore } from '../state/buildStore';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';

interface DialogProps {
  onClose: () => void;
  onError: (m: string) => void;
}

export function BuildDialogs({ onError }: { onError: (m: string) => void }): JSX.Element | null {
  const dialog = useBuildStore((s) => s.dialog);
  const close = useBuildStore((s) => s.closeDialog);
  if (dialog === 'fragment') return <FragmentDialog onClose={close} onError={onError} />;
  if (dialog === 'peptide') return <PeptideDialog onClose={close} onError={onError} />;
  if (dialog === 'nucleic') return <NucleicDialog onClose={close} onError={onError} />;
  if (dialog === 'nanotube') return <NanotubeDialog onClose={close} onError={onError} />;
  return null;
}

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="dialog panel">
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

/** The atom the fragment should attach to: exactly one selected atom, else nowhere in particular. */
function attachAtom(): number | undefined {
  const selected = [...useSelectionStore.getState().atoms];
  return selected.length === 1 ? selected[0] : undefined;
}

/** Insert `make()`'s structure into the document and commit it under `label`. */
async function insert(
  label: string,
  make: () => Promise<Structure>,
  onError: (m: string) => void,
): Promise<boolean> {
  try {
    const doc = useStructureStore.getState().doc;
    const fragment = await make();
    const merged = await api.build.insert({
      structure: toApiStructure(doc),
      fragment,
      ...(attachAtom() === undefined ? {} : { attach_atom: attachAtom()! }),
    });
    useStructureStore.getState().commit(label, {
      ...normalizeStructure(merged),
      id: doc.id,
      name: doc.name,
    });
    return true;
  } catch (e) {
    onError(`${label} failed: ${(e as Error).message}`);
    return false;
  }
}

function FragmentDialog({ onClose, onError }: DialogProps): JSX.Element {
  const [fragments, setFragments] = useState<FragmentInfo[] | null>(null);
  const [category, setCategory] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    api.build
      .fragments()
      .then((list) => {
        setFragments(list);
        setCategory((c) => c || list[0]?.category || '');
      })
      .catch((e: Error) => onError(`Fragment library: ${e.message}`));
  }, [onError]);

  const categories = [...new Set((fragments ?? []).map((f) => f.category))];
  const needle = filter.trim().toLowerCase();
  const shown = (fragments ?? []).filter((f) =>
    needle
      ? f.name.toLowerCase().includes(needle) || f.formula.toLowerCase().includes(needle)
      : f.category === category,
  );

  const add = async (fragment: FragmentInfo): Promise<void> => {
    const doc = useStructureStore.getState().doc;
    try {
      const merged = await api.build.insert({
        structure: toApiStructure(doc),
        fragment_id: fragment.id,
        ...(attachAtom() === undefined ? {} : { attach_atom: attachAtom()! }),
      });
      useStructureStore.getState().commit(`Insert ${fragment.name}`, {
        ...normalizeStructure(merged),
        id: doc.id,
        name: doc.name,
      });
      onClose();
    } catch (e) {
      onError(`Insert ${fragment.name} failed: ${(e as Error).message}`);
    }
  };

  return (
    <Dialog title="Insert fragment" onClose={onClose}>
      <p className="muted">
        Select a single atom first to attach the fragment there (a selected hydrogen is replaced).
      </p>
      <div className="form-row">
        <label htmlFor="fragment-category">Category</label>
        <select
          id="fragment-category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          disabled={Boolean(needle)}
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="fragment-filter">Search</label>
        <input
          id="fragment-filter"
          placeholder="name or formula (all categories)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {fragments === null && <p className="muted">Loading…</p>}
      <ul className="tree crystal-library" aria-label="Fragments">
        {shown.map((f) => (
          <li key={f.id}>
            <button className="tree-item" title={f.id} onClick={() => void add(f)}>
              {f.name} <span className="muted">{f.formula}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="button-row">
        <button onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}

function PeptideDialog({ onClose, onError }: DialogProps): JSX.Element {
  const [sequence, setSequence] = useState('AGA');
  // the preset names are the backend's (alpha_helix, not alpha-helix): take them from the API and
  // do not offer one that is not in the list, or Insert posts a name the schema rejects
  const [presets, setPresets] = useState<string[]>([]);
  const [preset, setPreset] = useState('');
  const [phi, setPhi] = useState(-57);
  const [psi, setPsi] = useState(-47);

  useEffect(() => {
    api.build
      .peptidePresets()
      .then((p) => {
        const names = [...Object.keys(p.presets), 'custom'];
        setPresets(names);
        setPreset((current) => (names.includes(current) ? current : (names[0] ?? '')));
      })
      .catch((e: Error) => onError(`Peptide presets: ${e.message}`));
  }, [onError]);

  const build = async (): Promise<void> => {
    const ok = await insert(
      `Insert peptide ${sequence}`,
      () =>
        api.build.peptide({
          sequence,
          preset,
          omega: 180,
          ...(preset === 'custom' ? { phi, psi } : {}),
        }),
      onError,
    );
    if (ok) onClose();
  };

  return (
    <Dialog title="Insert peptide" onClose={onClose}>
      <div className="form-row">
        <label htmlFor="peptide-sequence">Sequence</label>
        <input
          id="peptide-sequence"
          value={sequence}
          onChange={(e) => setSequence(e.target.value.toUpperCase())}
          placeholder="one-letter codes, e.g. AGA"
        />
      </div>
      <div className="form-row">
        <label htmlFor="peptide-preset">Conformation</label>
        <select id="peptide-preset" value={preset} onChange={(e) => setPreset(e.target.value)}>
          {presets.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      {preset === 'custom' && (
        <div className="form-row">
          <label htmlFor="peptide-phi">phi / psi</label>
          <div className="form-vector">
            <input
              id="peptide-phi"
              type="number"
              value={phi}
              onChange={(e) => setPhi(Number(e.target.value))}
            />
            <input
              aria-label="psi"
              type="number"
              value={psi}
              onChange={(e) => setPsi(Number(e.target.value))}
            />
          </div>
        </div>
      )}
      <div className="button-row">
        <button
          className="primary"
          onClick={() => void build()}
          disabled={!sequence.trim() || !preset}
        >
          Insert
        </button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}

function NucleicDialog({ onClose, onError }: DialogProps): JSX.Element {
  const [sequence, setSequence] = useState('GATC');
  const [kind, setKind] = useState<'dna' | 'rna'>('dna');
  const [form, setForm] = useState<'A' | 'B' | 'Z'>('B');
  const [doubleStrand, setDoubleStrand] = useState(true);

  const build = async (): Promise<void> => {
    const ok = await insert(
      `Insert ${kind.toUpperCase()} ${sequence}`,
      () => api.build.nucleic({ sequence, kind, form, double_strand: doubleStrand }),
      onError,
    );
    if (ok) onClose();
  };

  return (
    <Dialog title="Insert nucleic acid" onClose={onClose}>
      <div className="form-row">
        <label htmlFor="nucleic-sequence">Sequence</label>
        <input
          id="nucleic-sequence"
          value={sequence}
          onChange={(e) => setSequence(e.target.value.toUpperCase())}
          placeholder="A C G T / U"
        />
      </div>
      <div className="form-row">
        <label htmlFor="nucleic-kind">Type</label>
        <select
          id="nucleic-kind"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as 'dna' | 'rna');
            if (e.target.value === 'rna') setDoubleStrand(false);
          }}
        >
          <option value="dna">DNA</option>
          <option value="rna">RNA</option>
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="nucleic-form">Form</label>
        <select
          id="nucleic-form"
          value={form}
          onChange={(e) => setForm(e.target.value as 'A' | 'B' | 'Z')}
        >
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="Z">Z</option>
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="nucleic-double">Double strand</label>
        <input
          id="nucleic-double"
          type="checkbox"
          checked={doubleStrand}
          onChange={(e) => setDoubleStrand(e.target.checked)}
        />
      </div>
      <div className="button-row">
        <button className="primary" onClick={() => void build()} disabled={!sequence.trim()}>
          Insert
        </button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}

function NanotubeDialog({ onClose, onError }: DialogProps): JSX.Element {
  const [shape, setShape] = useState<'nanotube' | 'graphene'>('nanotube');
  const [n, setN] = useState(5);
  const [m, setM] = useState(5);
  const [length, setLength] = useState(3);
  const [periodic, setPeriodic] = useState(false);

  const build = async (): Promise<void> => {
    const label =
      shape === 'nanotube' ? `Insert (${n},${m}) nanotube` : `Insert ${n}x${m} graphene`;
    const ok = await insert(
      label,
      () =>
        shape === 'nanotube'
          ? api.build.nanotube({ n, m, length, periodic, symbol: 'C', bond: 1.42 })
          : api.build.graphene({ n, m, periodic, kind: 'armchair', saturated: true, bond: 1.42 }),
      onError,
    );
    if (ok) onClose();
  };

  return (
    <Dialog title="Insert nanotube or graphene" onClose={onClose}>
      <div className="form-row">
        <label htmlFor="tube-shape">Shape</label>
        <select
          id="tube-shape"
          value={shape}
          onChange={(e) => setShape(e.target.value as 'nanotube' | 'graphene')}
        >
          <option value="nanotube">Carbon nanotube</option>
          <option value="graphene">Graphene sheet</option>
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="tube-n">n, m</label>
        <div className="form-vector">
          <input
            id="tube-n"
            type="number"
            min={1}
            value={n}
            onChange={(e) => setN(Math.max(1, Math.round(Number(e.target.value))))}
          />
          <input
            aria-label="m"
            type="number"
            min={0}
            value={m}
            onChange={(e) => setM(Math.max(0, Math.round(Number(e.target.value))))}
          />
        </div>
      </div>
      {shape === 'nanotube' && (
        <div className="form-row">
          <label htmlFor="tube-length">Unit cells</label>
          <input
            id="tube-length"
            type="number"
            min={1}
            value={length}
            onChange={(e) => setLength(Math.max(1, Math.round(Number(e.target.value))))}
          />
        </div>
      )}
      <div className="form-row">
        <label htmlFor="tube-periodic">Periodic</label>
        <input
          id="tube-periodic"
          type="checkbox"
          checked={periodic}
          onChange={(e) => setPeriodic(e.target.checked)}
        />
      </div>
      <div className="button-row">
        <button className="primary" onClick={() => void build()}>
          Insert
        </button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}
