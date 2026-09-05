/**
 * Display types (Avogadro 1's Display Types dock): every display layer in one place, each with
 * its own enable switch and settings.
 *
 * Avogadro lets a user add several instances of an engine; Atomscope has one instance of each
 * layer and a settings block per layer, which covers what the dock is actually used for --
 * turning a representation on and adjusting it -- without a layer registry the renderer does not
 * have. Isosurfaces keep their own panel because they are per-grid rather than per-structure.
 */
import { ATOM_LABEL_OPTIONS, BOND_LABEL_OPTIONS } from '../renderer/labels';
import type { StructureStyle } from '../renderer/layers/StructureLayer';
import { useStructureStore } from '../state/structureStore';
import { useViewStore } from '../state/viewStore';

const STYLES: { id: StructureStyle; label: string }[] = [
  { id: 'ball-and-stick', label: 'Ball and stick' },
  { id: 'stick', label: 'Stick' },
  { id: 'vdw', label: 'Van der Waals spheres' },
  { id: 'wireframe', label: 'Wireframe' },
];

function Toggle({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: () => void;
}): JSX.Element {
  return (
    <div className="form-row">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="checkbox" checked={checked} onChange={onChange} />
    </div>
  );
}

export function DisplayPanel(): JSX.Element {
  const view = useViewStore();
  const doc = useStructureStore((s) => s.doc);
  const vectorFields = Object.keys(doc.atomic_vectors ?? {});

  return (
    <div className="panel display-panel">
      <h3>Structure</h3>
      <div className="form-row">
        <label htmlFor="display-style">Display type</label>
        <select
          id="display-style"
          value={view.style}
          onChange={(e) => view.setStyle(e.target.value as StructureStyle)}
        >
          {STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="display-atom-scale">Atom radius</label>
        <input
          id="display-atom-scale"
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          value={view.atomScale}
          onChange={(e) => view.setAtomScale(Number(e.target.value))}
        />
      </div>
      <div className="form-row">
        <label htmlFor="display-bond-radius">Bond radius</label>
        <input
          id="display-bond-radius"
          type="range"
          min="0.02"
          max="0.4"
          step="0.01"
          value={view.bondRadius}
          onChange={(e) => view.setBondRadius(Number(e.target.value))}
        />
      </div>
      <Toggle
        id="display-hydrogens"
        label="Show hydrogens"
        checked={view.showHydrogens}
        onChange={view.toggleHydrogens}
      />

      <h3>Labels</h3>
      <Toggle
        id="display-labels"
        label="Enabled"
        checked={view.showLabels}
        onChange={view.toggleLabels}
      />
      <div className="form-row">
        <label htmlFor="display-atom-labels">Atoms</label>
        <select
          id="display-atom-labels"
          value={view.atomLabels}
          onChange={(e) => view.setAtomLabels(e.target.value as never)}
        >
          {ATOM_LABEL_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="display-bond-labels">Bonds</label>
        <select
          id="display-bond-labels"
          value={view.bondLabels}
          onChange={(e) => view.setBondLabels(e.target.value as never)}
        >
          {BOND_LABEL_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="display-label-color">Colour</label>
        <input
          id="display-label-color"
          type="color"
          value={view.labelColor}
          onChange={(e) => view.setLabelStyle({ color: e.target.value })}
        />
      </div>
      <div className="form-row">
        <label htmlFor="display-label-size">Size</label>
        <input
          id="display-label-size"
          type="range"
          min="0.2"
          max="1.5"
          step="0.05"
          value={view.labelSize}
          onChange={(e) => view.setLabelStyle({ size: Number(e.target.value) })}
        />
      </div>
      <div className="form-row">
        <label htmlFor="display-label-shift-x">Shift x/y/z (Å)</label>
        <div className="form-vector">
          {(['x', 'y', 'z'] as const).map((axis, i) => (
            <input
              key={axis}
              id={i === 0 ? 'display-label-shift-x' : undefined}
              aria-label={`Label shift ${axis}`}
              type="number"
              step="0.1"
              value={view.labelShift[i]}
              onChange={(e) => {
                const shift = [...view.labelShift] as [number, number, number];
                shift[i] = Number(e.target.value);
                view.setLabelStyle({ shift });
              }}
            />
          ))}
        </div>
      </div>

      <h3>Vectors</h3>
      <Toggle
        id="display-vectors"
        label="Enabled"
        checked={view.showVectors}
        onChange={view.toggleVectors}
      />
      <div className="form-row">
        <label htmlFor="display-vector-field">Field</label>
        <select
          id="display-vector-field"
          value={view.vectorField}
          onChange={(e) => view.setVectorField(e.target.value)}
        >
          {(vectorFields.length ? vectorFields : [view.vectorField]).map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="display-vector-scale">Scale</label>
        <input
          id="display-vector-scale"
          type="range"
          min="0.1"
          max="5"
          step="0.1"
          value={view.vectorScale}
          onChange={(e) => view.setVectorScale(Number(e.target.value))}
        />
      </div>
      {vectorFields.length === 0 && (
        <p className="muted">This structure carries no vector field (forces, moments).</p>
      )}

      <h3>Unit cell and axes</h3>
      <Toggle
        id="display-cell"
        label="Show unit cell"
        checked={view.showUnitCell}
        onChange={view.toggleUnitCell}
      />
      <div className="form-row">
        <label htmlFor="display-cell-repeat">Repeat a/b/c</label>
        <div className="form-vector">
          {(['a', 'b', 'c'] as const).map((axis, i) => (
            <input
              key={axis}
              id={i === 0 ? 'display-cell-repeat' : undefined}
              aria-label={`Cell repeat ${axis}`}
              type="number"
              min="1"
              max="10"
              value={view.cellRepeat[i]}
              onChange={(e) => {
                const repeat = [...view.cellRepeat] as [number, number, number];
                repeat[i] = Math.max(1, Math.round(Number(e.target.value)));
                view.setCellRepeat(repeat);
              }}
            />
          ))}
        </div>
      </div>
      {!doc.cell && <p className="muted">This structure has no unit cell.</p>}
      <Toggle
        id="display-axes"
        label="Show axes"
        checked={view.showAxes}
        onChange={view.toggleAxes}
      />
    </div>
  );
}
