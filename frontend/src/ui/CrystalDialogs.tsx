/**
 * Modal dialogs opened from the Build menu / Crystal tab: supercell, slab, crystal library and
 * the space-group table.
 */
import { useEffect, useRef, useState } from 'react';
import { dialogKeyHandler } from './dialogKeys';
import { api, type LibraryEntry, type SpacegroupSetting, type SurfaceKind } from '../api/client';
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
  if (dialog === 'spacegroup') return <SpacegroupDialog onClose={close} onError={onError} />;
  return null;
}

interface DialogProps {
  onClose: () => void;
  onError: (m: string) => void;
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
  const dialog = useRef<HTMLDivElement>(null);
  return (
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-label={title}
      onKeyDown={dialogKeyHandler(dialog, onClose)}
    >
      <div className="dialog panel" ref={dialog}>
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
    <Dialog title="Supercell" onClose={onClose}>
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

/**
 * Two ways to make a surface, in one dialog.
 *
 * `Miller indices` cuts any plane out of the bulk crystal on screen, which is the general answer
 * and needs no table of facets. The named builders (`ase.build.fcc111` and its family) instead
 * build the slab from an element and a facet -- and carry the **named adsorption sites** with it,
 * which is what lets an adsorbate be placed "on the hcp site" afterwards. A cut plane cannot know
 * what to call its sites, so it has none.
 */
function SlabDialog({ onClose, onError }: DialogProps): JSX.Element {
  const [miller, setMiller] = useState('1 1 1');
  const [layers, setLayers] = useState('3');
  const [vacuum, setVacuum] = useState('10');
  const [error, setError] = useState<string | null>(null);
  const [kinds, setKinds] = useState<SurfaceKind[]>([]);
  const [kind, setKind] = useState('');
  const [symbol, setSymbol] = useState('Cu');
  const [repeat, setRepeat] = useState<[string, string]>(['2', '2']);
  const [a, setA] = useState('');
  const [c, setC] = useState('');
  const [orthogonal, setOrthogonal] = useState(false);
  const doc = useStructureStore((s) => s.doc);

  useEffect(() => {
    api.crystal
      .surfaceKinds()
      .then(setKinds)
      .catch((e: Error) => onError(e.message));
  }, [onError]);

  const entry = kinds.find((k) => k.id === kind) ?? null;
  const named = kind !== '';

  const buildMiller = async (): Promise<boolean> => {
    if (!doc.cell) {
      setError('cutting a plane needs a unit cell; pick a named surface above, or add a cell');
      return false;
    }
    let hkl: [number, number, number];
    try {
      hkl = parseMiller(miller);
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
    const n = Number(layers);
    const v = Number(vacuum);
    if (!Number.isInteger(n) || n < 1 || !(v >= 0)) {
      setError('layers must be a positive integer and vacuum >= 0');
      return false;
    }
    return commitCrystalOp(
      `Slab (${hkl.join(' ')})`,
      (structure) => api.crystal.slab({ structure, miller: hkl, layers: n, vacuum: v }),
      onError,
    );
  };

  const buildNamed = async (): Promise<boolean> => {
    const size: [number, number, number] = [Number(repeat[0]), Number(repeat[1]), Number(layers)];
    if (size.some((n) => !Number.isInteger(n) || n < 1)) {
      setError('the two repeats and the layer count must be positive integers');
      return false;
    }
    const v = Number(vacuum);
    if (!(v >= 0)) {
      setError('vacuum must be zero or more');
      return false;
    }
    try {
      // a named surface is built from an element, not from the document, so it replaces it
      // rather than transforming it -- the same commit the crystal library does
      const built = await api.crystal.buildSurface({
        kind,
        symbol: symbol.trim(),
        size,
        a: a.trim() === '' ? null : Number(a),
        c: c.trim() === '' ? null : Number(c),
        vacuum: v,
        orthogonal: entry?.orthogonal_option ? orthogonal : null,
      });
      useStructureStore.getState().commit(`Build ${symbol}(${entry?.facet ?? kind})`, {
        ...normalizeStructure(built),
        // keep the document's identity, as every other crystal operation does
        id: doc.id,
      });
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  const build = async (): Promise<void> => {
    setError(null);
    if (await (named ? buildNamed() : buildMiller())) onClose();
  };

  return (
    <Dialog title="Surface slab" onClose={onClose}>
      <div className="form-row">
        <label htmlFor="slab-kind">Surface</label>
        <select id="slab-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Miller indices of the crystal on screen</option>
          {kinds.map((k) => (
            <option key={k.id} value={k.id}>
              {k.lattice} ({k.facet})
            </option>
          ))}
        </select>
      </div>
      {named ? (
        <>
          <p className="muted">
            {entry && entry.sites.length > 0
              ? `Built from the element, with named adsorption sites: ${entry.sites.join(', ')}.`
              : 'Built from the element. This facet has no named adsorption sites.'}
          </p>
          <div className="form-row">
            <label htmlFor="slab-symbol">Element</label>
            <input
              id="slab-symbol"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              size={4}
            />
          </div>
          <div className="form-row">
            <label htmlFor="slab-repeat-a">Surface repeats</label>
            <input
              id="slab-repeat-a"
              aria-label="Repeats along the first surface vector"
              value={repeat[0]}
              onChange={(e) => setRepeat([e.target.value, repeat[1]])}
              size={3}
            />
            <input
              aria-label="Repeats along the second surface vector"
              value={repeat[1]}
              onChange={(e) => setRepeat([repeat[0], e.target.value])}
              size={3}
            />
          </div>
          <div className="form-row">
            <label htmlFor="slab-a">a (Å)</label>
            <input
              id="slab-a"
              value={a}
              onChange={(e) => setA(e.target.value)}
              placeholder="ASE default"
            />
          </div>
          {entry?.takes_c && (
            <div className="form-row">
              <label htmlFor="slab-c">c (Å)</label>
              <input
                id="slab-c"
                value={c}
                onChange={(e) => setC(e.target.value)}
                placeholder="ASE default"
              />
            </div>
          )}
          {entry?.orthogonal_option && (
            <label className="check">
              <input
                type="checkbox"
                checked={orthogonal}
                onChange={(e) => setOrthogonal(e.target.checked)}
              />
              Orthogonal surface cell
            </label>
          )}
        </>
      ) : (
        <>
          <p className="muted">
            Cut a slab of the current bulk crystal perpendicular to the (h k l) plane; vacuum is
            added on both sides along c. A cut plane carries no named adsorption sites — pick a
            named surface above for those.
            {!doc.cell && ' The structure on screen has no unit cell, so there is nothing to cut.'}
          </p>
          <div className="form-row">
            <label htmlFor="slab-miller">Miller indices h k l</label>
            <input id="slab-miller" value={miller} onChange={(e) => setMiller(e.target.value)} />
          </div>
        </>
      )}
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
    <Dialog title="Crystal library" onClose={onClose}>
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

/**
 * Avogadro's Set Spacegroup (crystallographyextension.cpp:2495-2559): a table of every setting
 * with the International number, the Hall name and the Hermann-Mauguin name, the current group
 * preselected. 530 rows, not 230 — a group with more than one setting has one row per setting,
 * and which one is chosen decides where Fill puts the atoms.
 *
 * Two differences. The chosen setting is remembered by the panel rather than written onto the
 * document: the group of a filled cell is a function of its atoms, so an asserted one beside it
 * would be a second truth. And there is a filter box, because 530 rows is a long scroll; it is
 * the one the crystal library already has.
 */
function SpacegroupDialog({ onClose, onError }: DialogProps): JSX.Element {
  const [settings, setSettings] = useState<SpacegroupSetting[] | null>(null);
  const [filter, setFilter] = useState('');
  const setSetting = useCrystalStore((s) => s.setSetting);
  const chosen = useCrystalStore((s) => s.setting);
  const symmetry = useCrystalStore((s) => s.symmetry);
  const doc = useStructureStore((s) => s.doc);
  const revision = useStructureStore((s) => s.revision);
  // neither a choice made for another document nor a group perceived before an edit is current
  const mine = chosen && chosen.docId === doc.id ? chosen.setting : null;
  const perceived = symmetry && symmetry.revision === revision ? symmetry.info.hall_number : null;
  const current = mine?.hall_number ?? perceived;

  useEffect(() => {
    api.crystal
      .spacegroups()
      .then(setSettings)
      .catch((e: Error) => onError(`Space groups: ${e.message}`));
  }, [onError]);

  const needle = filter.trim().toLowerCase();
  const shown = (settings ?? []).filter(
    (s) =>
      !needle ||
      String(s.number) === needle ||
      s.international.toLowerCase().includes(needle) ||
      s.international_full.toLowerCase().includes(needle) ||
      s.hall.toLowerCase().includes(needle),
  );

  const choose = (setting: SpacegroupSetting): void => {
    setSetting(setting, doc.id);
    onClose();
  };

  return (
    <Dialog title="Set space group" onClose={onClose}>
      <p className="muted">
        The setting Fill unit cell will use. A group with more than one setting has one row per
        setting; the current one is marked.
      </p>
      <div className="form-row">
        <label htmlFor="spacegroup-filter">Search</label>
        <input
          id="spacegroup-filter"
          placeholder="number, Hermann-Mauguin or Hall symbol"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {settings === null && <p className="muted">Loading…</p>}
      <div className="orbital-table-wrap spacegroup-table">
        <table className="orbital-table" aria-label="Space groups">
          <thead>
            <tr>
              <th scope="col">International</th>
              <th scope="col">Hall</th>
              <th scope="col">Hermann-Mauguin</th>
              <th scope="col">Setting</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.hall_number} className={s.hall_number === current ? 'selected' : ''}>
                <td>
                  <button
                    className="tree-item"
                    aria-label={`Set ${s.international_full} (Hall ${s.hall_number})`}
                    onClick={() => choose(s)}
                  >
                    {s.number} {s.international}
                  </button>
                </td>
                <td>{s.hall}</td>
                <td>{s.international_full}</td>
                <td>{s.choice || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="button-row">
        {mine && (
          <button
            onClick={() => {
              setSetting(null, doc.id);
              onClose();
            }}
          >
            Clear
          </button>
        )}
        <button onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}
