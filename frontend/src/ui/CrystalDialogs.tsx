/** Modal dialogs opened from the Build menu / Crystal tab: supercell, slab and crystal library. */
import { useEffect, useState } from 'react';
import { api, type LibraryEntry } from '../api/client';
import { parseMiller, parseRepeat } from '../model/crystal';
import { normalizeStructure } from '../model/structure';
import { useCrystalStore } from '../state/crystalStore';
import { useStructureStore } from '../state/structureStore';
import { commitCrystalOp } from './crystalActions';

export function CrystalDialogs({ onError }: { onError: (m: string) => void }): JSX.Element | null {
  const dialog = useCrystalStore((s) => s.dialog);
  const close = useCrystalStore((s) => s.closeDialog);
  if (dialog === 'supercell') return <SupercellDialog onClose={close} onError={onError} />;
  if (dialog === 'slab') return <SlabDialog onClose={close} onError={onError} />;
  if (dialog === 'library') return <LibraryDialog onClose={close} onError={onError} />;
  return null;
}

interface DialogProps {
  onClose: () => void;
  onError: (m: string) => void;
}

function Dialog({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="dialog-backdrop" role="dialog" aria-label={title}>
      <div className="dialog panel">
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function SupercellDialog({ onClose, onError }: DialogProps): JSX.Element {
  const [text, setText] = useState<[string, string, string]>(['2', '2', '2']);
  const [error, setError] = useState<string | null>(null);
  const build = async (): Promise<void> => {
    let repeat: [number, number, number];
    try {
      repeat = parseRepeat(text);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const ok = await commitCrystalOp(
      `Supercell ${repeat.join('x')}`,
      (structure) => api.crystal.supercell({ structure, repeat }),
      onError,
    );
    if (ok) onClose();
  };
  return (
    <Dialog title="Supercell">
      <p className="muted">Repeat the unit cell along a, b and c (creates real atoms).</p>
      <div className="form-row">
        <label>Repeats a b c</label>
        <div className="form-vector">
          {(['a', 'b', 'c'] as const).map((axis, i) => (
            <input
              key={axis}
              aria-label={`Supercell ${axis}`}
              value={text[i]}
              onChange={(e) => {
                const next = [...text] as [string, string, string];
                next[i] = e.target.value;
                setText(next);
              }}
            />
          ))}
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="button-row">
        <button className="primary" onClick={() => void build()}>
          Build supercell
        </button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}

function SlabDialog({ onClose, onError }: DialogProps): JSX.Element {
  const [miller, setMiller] = useState('1 1 1');
  const [layers, setLayers] = useState('3');
  const [vacuum, setVacuum] = useState('10');
  const [error, setError] = useState<string | null>(null);
  const build = async (): Promise<void> => {
    let hkl: [number, number, number];
    try {
      hkl = parseMiller(miller);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const n = Number(layers);
    const v = Number(vacuum);
    if (!Number.isInteger(n) || n < 1 || !(v >= 0)) {
      setError('layers must be a positive integer and vacuum >= 0');
      return;
    }
    const ok = await commitCrystalOp(
      `Slab (${hkl.join(' ')})`,
      (structure) => api.crystal.slab({ structure, miller: hkl, layers: n, vacuum: v }),
      onError,
    );
    if (ok) onClose();
  };
  return (
    <Dialog title="Surface slab">
      <p className="muted">
        Cut a slab of the current bulk crystal perpendicular to the (h k l) plane; vacuum is added
        on both sides along c.
      </p>
      <div className="form-row">
        <label htmlFor="slab-miller">Miller indices h k l</label>
        <input id="slab-miller" value={miller} onChange={(e) => setMiller(e.target.value)} />
      </div>
      <div className="form-row">
        <label htmlFor="slab-layers">Layers</label>
        <input id="slab-layers" value={layers} onChange={(e) => setLayers(e.target.value)} />
      </div>
      <div className="form-row">
        <label htmlFor="slab-vacuum">Vacuum (Å)</label>
        <input id="slab-vacuum" value={vacuum} onChange={(e) => setVacuum(e.target.value)} />
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="button-row">
        <button className="primary" onClick={() => void build()}>
          Build slab
        </button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}

function LibraryDialog({ onClose, onError }: DialogProps): JSX.Element {
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [category, setCategory] = useState<string>('');
  const [filter, setFilter] = useState('');
  useEffect(() => {
    api.crystal
      .library()
      .then((list) => {
        setEntries(list);
        setCategory((c) => c || list[0]?.category || '');
      })
      .catch((e: Error) => onError(`Crystal library: ${e.message}`));
  }, [onError]);

  const categories = [...new Set((entries ?? []).map((e) => e.category))];
  const needle = filter.trim().toLowerCase();
  const shown = (entries ?? []).filter(
    (e) =>
      (needle
        ? e.name.toLowerCase().includes(needle) || e.formula.toLowerCase().includes(needle)
        : true) &&
      (needle || e.category === category),
  );

  const load = async (entry: LibraryEntry): Promise<void> => {
    try {
      const s = await api.crystal.libraryEntry(entry.category, entry.name);
      useStructureStore.getState().commit(`Insert ${entry.name}`, normalizeStructure(s));
      onClose();
    } catch (e) {
      onError(`Load ${entry.name} failed: ${(e as Error).message}`);
    }
  };

  return (
    <Dialog title="Crystal library">
      <div className="form-row">
        <label htmlFor="library-category">Category</label>
        <select
          id="library-category"
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
        <label htmlFor="library-filter">Search</label>
        <input
          id="library-filter"
          placeholder="name or formula (all categories)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {entries === null && <p className="muted">Loading…</p>}
      <ul className="tree crystal-library" aria-label="Library entries">
        {shown.map((e) => (
          <li key={`${e.category}/${e.name}`}>
            <button
              className="tree-item"
              disabled={!e.readable}
              title={e.readable ? `${e.category}/${e.name}` : 'not readable by ASE'}
              onClick={() => void load(e)}
            >
              {e.name} <span className="muted">{e.formula}</span>
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
