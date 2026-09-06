/**
 * Crystal tab (Avogadro 1 "Crystallography" extension): cell parameter / matrix / fractional
 * editors, symmetry perception and cell operations. Every mutation is one undoable commit.
 */
import { useState } from 'react';
import { api } from '../api/client';
import { applyCartesian } from '../editor/cartesian';
import {
  cellParameters,
  cellVolume,
  formatFractional,
  latticeTypeFromParameters,
  parseFractional,
  type Mat3,
} from '../model/crystal';
import { useCrystalStore } from '../state/crystalStore';
import { useStructureStore } from '../state/structureStore';
import { useViewStore } from '../state/viewStore';
import { commitCrystalOp, toggleCell } from './crystalActions';
import { MatrixEditor, ParametersEditor, RepeatEditor, TextEditor } from './CrystalEditors';

type Mode = 'cartesian' | 'fractional';
export function CrystalPanel({ onError }: { onError: (m: string) => void }): JSX.Element {
  const doc = useStructureStore((s) => s.doc);
  const revision = useStructureStore((s) => s.revision);
  const cell = doc.cell;
  const [mode, setMode] = useState<Mode>('cartesian');
  const [symprec, setSymprec] = useState('0.001');
  const [volume, setVolume] = useState('');
  const [spacegroup, setSpacegroup] = useState('');
  const symmetry = useCrystalStore((s) => s.symmetry);
  const setSymmetry = useCrystalStore((s) => s.setSymmetry);
  const openDialog = useCrystalStore((s) => s.openDialog);
  const setting = useCrystalStore((s) => s.setting);
  const setSetting = useCrystalStore((s) => s.setSetting);
  const cellRepeat = useViewStore((s) => s.cellRepeat);
  const setCellRepeat = useViewStore((s) => s.setCellRepeat);

  const run = (label: string, call: Parameters<typeof commitCrystalOp>[1]): void => {
    void commitCrystalOp(label, call, onError);
  };
  const tol = (): number => {
    const t = Number(symprec);
    return Number.isFinite(t) && t > 0 ? t : 0.001;
  };
  const symmetryBody = (s: typeof doc) => ({ structure: s, symprec: tol() });

  const perceive = async (): Promise<void> => {
    try {
      const info = await api.crystal.symmetry(symmetryBody(doc));
      setSymmetry(info, revision);
      setSpacegroup(String(info.number));
    } catch (e) {
      onError(`Perceive symmetry failed: ${(e as Error).message}`);
    }
  };

  const applyFractional = (text: string): void => {
    if (!cell) return;
    try {
      const st = useStructureStore.getState();
      st.commit('Edit fractional coordinates', applyCartesian(st.doc, parseFractional(text, cell)));
    } catch (e) {
      onError(`Fractional coordinates: ${(e as Error).message}`);
    }
  };

  const params = cell ? cellParameters(cell) : null;
  const symStale = symmetry !== null && symmetry.revision !== revision;

  return (
    <div className="panel crystal-panel">
      <h3>Unit cell</h3>
      {!cell && (
        <>
          <p className="muted">This structure has no unit cell.</p>
          <div className="button-row">
            <button className="primary" onClick={() => void toggleCell(onError)}>
              Add unit cell
            </button>
            <button onClick={() => openDialog('library')}>Crystal library…</button>
          </div>
        </>
      )}
      {cell && params && (
        <>
          <div className="form-row">
            <label>Lattice</label>
            <span>
              {latticeTypeFromParameters(params)} · V = {cellVolume(cell).toFixed(3)} Å³ · pbc{' '}
              {cell.pbc.map((p) => (p ? 'T' : 'F')).join('')}
            </span>
          </div>
          <div className="form-row">
            <label>On cell change</label>
            <select
              aria-label="Coordinate preservation"
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
            >
              <option value="cartesian">keep Cartesian coordinates</option>
              <option value="fractional">keep fractional coordinates</option>
            </select>
          </div>
          <ParametersEditor
            key={`p${revision}`}
            params={params}
            onApply={(parameters) =>
              run('Set cell parameters', (structure) =>
                api.crystal.setCell({ structure, parameters, mode }),
              )
            }
          />
          <MatrixEditor
            key={`m${revision}`}
            matrix={cell.vectors as Mat3}
            onApply={(vectors) =>
              run('Set cell matrix', (structure) =>
                api.crystal.setCell({ structure, vectors, mode }),
              )
            }
          />
          <TextEditor
            key={`f${revision}`}
            label="Fractional coordinates"
            initial={formatFractional(doc)}
            rows={8}
            onApply={applyFractional}
          />

          <h3>Symmetry</h3>
          <div className="form-row">
            <label htmlFor="symprec">Tolerance (Å)</label>
            <div className="form-control">
              <input id="symprec" value={symprec} onChange={(e) => setSymprec(e.target.value)} />
              <button onClick={() => void perceive()}>Perceive</button>
            </div>
          </div>
          {symmetry && (
            <div className={symStale ? 'muted' : undefined} data-testid="symmetry-info">
              <div className="form-row">
                <label>Space group</label>
                <span>
                  {symmetry.info.international} ({symmetry.info.number}) · Hall {symmetry.info.hall}
                </span>
              </div>
              <div className="form-row">
                <label>Point group</label>
                <span>
                  {symmetry.info.point_group} · {symmetry.info.lattice_type} ·{' '}
                  {symmetry.info.n_operations} ops · {symmetry.info.n_asymmetric} asymmetric
                  {symStale ? ' (outdated)' : ''}
                </span>
              </div>
            </div>
          )}
          <div className="button-row">
            <button
              onClick={() =>
                run('Symmetrize', (structure) => api.crystal.symmetrize(symmetryBody(structure)))
              }
            >
              Symmetrize
            </button>
            <button
              onClick={() =>
                run('Primitive cell', (structure) => api.crystal.primitive(symmetryBody(structure)))
              }
            >
              Primitive
            </button>
            <button
              onClick={() =>
                run('Primitive standardized', (structure) =>
                  api.crystal.primitiveStandardized(symmetryBody(structure)),
                )
              }
            >
              Primitive + standardize
            </button>
            <button
              onClick={() => run('Niggli reduce', (structure) => api.crystal.niggli({ structure }))}
            >
              Niggli
            </button>
            <button
              onClick={() =>
                run('Asymmetric unit', (structure) =>
                  api.crystal.asymmetricUnit(symmetryBody(structure)),
                )
              }
            >
              Asymmetric unit
            </button>
          </div>
          <div className="form-row">
            <label htmlFor="fill-sg">Fill cell (group)</label>
            <div className="form-control">
              <input
                id="fill-sg"
                placeholder="perceive"
                value={spacegroup}
                disabled={setting !== null}
                onChange={(e) => setSpacegroup(e.target.value)}
              />
              <button onClick={() => openDialog('spacegroup')}>Set space group…</button>
              <button
                onClick={() => {
                  // a chosen setting is exact; a typed number leaves the setting to ASE; neither
                  // perceives the group from the atoms, which needs a complete cell
                  const n = Number(spacegroup);
                  const body = setting
                    ? { hall_number: setting.hall_number }
                    : Number.isInteger(n) && n >= 1
                      ? { spacegroup: n }
                      : {};
                  run('Fill unit cell', (structure) =>
                    api.crystal.fill({ ...symmetryBody(structure), ...body }),
                  );
                }}
              >
                Fill
              </button>
            </div>
          </div>
          {setting && (
            <p className="muted">
              {setting.international_full} (no. {setting.number}, Hall {setting.hall}
              {setting.choice ? `, setting ${setting.choice}` : ''}){' '}
              <button className="tree-item" onClick={() => setSetting(null)}>
                Clear
              </button>
            </p>
          )}

          <h3>Operations</h3>
          <div className="button-row">
            <button
              onClick={() => run('Wrap atoms', (structure) => api.crystal.wrap({ structure }))}
            >
              Wrap atoms
            </button>
            <button
              onClick={() =>
                run('Standard orientation', (structure) =>
                  api.crystal.standardOrientation({ structure }),
                )
              }
            >
              Standard orientation
            </button>
            <button onClick={() => openDialog('supercell')}>Supercell…</button>
            <button onClick={() => openDialog('slab')}>Slab…</button>
            <button onClick={() => openDialog('library')}>Crystal library…</button>
            <button onClick={() => void toggleCell(onError)}>Remove unit cell</button>
          </div>
          <div className="form-row">
            <label htmlFor="scale-volume">Scale to volume</label>
            <div className="form-control">
              <input
                id="scale-volume"
                placeholder={cellVolume(cell).toFixed(3)}
                value={volume}
                onChange={(e) => setVolume(e.target.value)}
              />
              <span className="form-unit">Å³</span>
              <button
                disabled={!(Number(volume) > 0)}
                onClick={() =>
                  run('Scale cell to volume', (structure) =>
                    api.crystal.scaleVolume({ structure, volume: Number(volume) }),
                  )
                }
              >
                Scale
              </button>
            </div>
          </div>

          <h3>Display</h3>
          <RepeatEditor value={cellRepeat} onApply={setCellRepeat} />
        </>
      )}
    </div>
  );
}
