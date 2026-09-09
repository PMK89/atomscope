/**
 * Putting an adsorbate on a slab (`crystal/surfaces.py`).
 *
 * Only shown when the structure on screen has named adsorption sites, which means it was built by
 * one of ASE's named surface builders (Build ▸ Surface slab…, with a surface chosen rather than
 * Miller indices). A slab cut from a bulk crystal has no site names, and there is nothing to
 * offer for it.
 *
 * The adsorbate is an element symbol, one of ASE's molecule names, or another structure of the
 * project. ASE does not orient a molecule, so which of its atoms faces the surface is `mol_index`
 * and nothing else -- `molecule('CO')` is ['O', 'C'], so index 0 puts the oxygen down.
 */
import { useEffect, useState } from 'react';

import { api, type AdsorptionSite, type Structure } from '../api/client';
import { toApiStructure } from '../api/structureBody';
import type { StructureDoc } from '../model/structure';
import { useProjectStore } from '../state/projectStore';
import { commitCrystalOp } from './crystalActions';

export function AdsorbateSection({
  doc,
  onError,
}: {
  doc: StructureDoc;
  onError: (m: string) => void;
}): JSX.Element | null {
  const structures = useProjectStore((s) => s.structures);
  const [names, setNames] = useState<string[]>([]);
  const [sites, setSites] = useState<AdsorptionSite[]>([]);
  const [site, setSite] = useState('');
  const [adsorbate, setAdsorbate] = useState('O');
  const [fromProject, setFromProject] = useState('');
  const [height, setHeight] = useState('1.7');
  const [offset, setOffset] = useState<[string, string]>(['0', '0']);
  const [molIndex, setMolIndex] = useState('0');
  const [error, setError] = useState<string | null>(null);

  const surface = doc.surface;

  // nothing is asked of the backend for a structure that has no sites: the section is not shown
  // for one, and the hooks still have to run, so the guard is inside the effect
  useEffect(() => {
    if (!surface) return;
    api.crystal
      .adsorbateNames()
      .then(setNames)
      .catch((e: Error) => onError(e.message));
  }, [surface, onError]);

  useEffect(() => {
    if (!surface) {
      setSites([]);
      return;
    }
    api.crystal
      .adsorptionSites({ structure: toApiStructure(doc) })
      .then((found) => {
        setSites(found);
        setSite((current) =>
          found.some((s) => s.name === current) ? current : (found[0]?.name ?? ''),
        );
      })
      .catch((e: Error) => onError(e.message));
    // the sites depend on the surface information, not on where the atoms have been dragged
  }, [surface, onError]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!surface) return null;

  const add = async (): Promise<void> => {
    setError(null);
    const h = Number(height);
    const dx = Number(offset[0]);
    const dy = Number(offset[1]);
    const index = Number(molIndex);
    if (!(h > 0)) {
      setError('the height must be positive');
      return;
    }
    if (!Number.isInteger(dx) || !Number.isInteger(dy) || !Number.isInteger(index) || index < 0) {
      setError('the offsets are whole surface cells and the molecule index a whole number');
      return;
    }
    // the route takes either a name or a whole structure
    let body: string | Structure;
    if (fromProject === '') {
      body = adsorbate.trim();
      if (!body) {
        setError('name an element, a molecule, or a structure of the project');
        return;
      }
    } else {
      try {
        body = await api.structures.get(fromProject);
      } catch (e) {
        setError((e as Error).message);
        return;
      }
    }
    await commitCrystalOp(
      `Adsorb on ${site}`,
      (structure) =>
        api.crystal.adsorbate({
          structure,
          adsorbate: body as never,
          height: h,
          site,
          position: null,
          offset: dx === 0 && dy === 0 ? null : [dx, dy],
          mol_index: index,
        }),
      onError,
    );
  };

  return (
    <div className="adsorbate-section">
      <h3>Adsorbate</h3>
      <p className="muted">
        {sites.length} named {sites.length === 1 ? 'site' : 'sites'} on this surface. The height is
        measured from the top layer, and stays measured from it however many adsorbates are added.
      </p>
      <div className="form-row">
        <label htmlFor="ads-site">Site</label>
        <select id="ads-site" value={site} onChange={(e) => setSite(e.target.value)}>
          {sites.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name} ({s.cartesian[0].toFixed(2)}, {s.cartesian[1].toFixed(2)} Å)
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="ads-what">Adsorbate</label>
        <input
          id="ads-what"
          value={adsorbate}
          onChange={(e) => setAdsorbate(e.target.value)}
          disabled={fromProject !== ''}
          list="ads-names"
          size={6}
        />
        <datalist id="ads-names">
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </div>
      {structures.length > 0 && (
        <div className="form-row">
          <label htmlFor="ads-project">or from the project</label>
          <select
            id="ads-project"
            value={fromProject}
            onChange={(e) => setFromProject(e.target.value)}
          >
            <option value="">use the name above</option>
            {structures.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || s.id}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="form-row">
        <label htmlFor="ads-height">Height (Å)</label>
        <input id="ads-height" value={height} onChange={(e) => setHeight(e.target.value)} />
      </div>
      <div className="form-row">
        <label htmlFor="ads-offset-a">Cell offset</label>
        <input
          id="ads-offset-a"
          aria-label="Offset along the first surface vector"
          value={offset[0]}
          onChange={(e) => setOffset([e.target.value, offset[1]])}
          size={3}
        />
        <input
          aria-label="Offset along the second surface vector"
          value={offset[1]}
          onChange={(e) => setOffset([offset[0], e.target.value])}
          size={3}
        />
      </div>
      <div className="form-row">
        <label htmlFor="ads-mol-index">Atom facing down</label>
        <input
          id="ads-mol-index"
          value={molIndex}
          onChange={(e) => setMolIndex(e.target.value)}
          size={3}
        />
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="button-row">
        <button className="primary" onClick={() => void add()} disabled={!site}>
          Add adsorbate
        </button>
      </div>
    </div>
  );
}
