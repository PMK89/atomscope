/**
 * Display types (Avogadro 1's Display Types dock): every display layer in one place, each with
 * its own enable switch and settings.
 *
 * Avogadro lets a user add several instances of an engine; Atomscope has one instance of each
 * layer and a settings block per layer, which covers what the dock is actually used for --
 * turning a representation on and adjusting it -- without a layer registry the renderer does not
 * have. Isosurfaces keep their own panel because they are per-grid rather than per-structure.
 */
import { useState } from 'react';
import { dipoleFromCharges } from '../model/dipole';
import { useColorSchemes } from '../plugins/enabled';
import type { RibbonStyle } from '../model/ribbon';
import { ATOM_LABEL_OPTIONS, BOND_LABEL_OPTIONS } from '../renderer/labels';
import {
  assignAtomColor,
  assignedColorCount,
  NO_ATOM_COLORS,
  PALETTE_LABELS,
  type ResiduePalette,
} from '../renderer/atomColors';
import { partialCharges } from '../renderer/labels';
import { assignStyle, assignmentCounts, displayOnly, NO_STYLES } from '../renderer/atomStyles';
import { useSelectionStore } from '../state/selectionStore';
import { useBioStore } from '../state/bioStore';
import { useRendererStore } from '../state/rendererStore';
import type { RibbonColorScheme } from '../renderer/layers/RibbonLayer';
import type { StructureStyle } from '../renderer/layers/StructureLayer';
import { useStructureStore } from '../state/structureStore';
import { useViewStore } from '../state/viewStore';

/**
 * Avogadro's Residue Color settings: which of Jmol's three tables paints the residues. One store
 * setting, so the atoms and the ribbon agree; it appears next to whichever of them is set to
 * `Residue`, and the two selects show the same value when both are.
 */
function PaletteRow({ id }: { id: string }): JSX.Element {
  const palette = useViewStore((s) => s.residuePalette);
  const setPalette = useViewStore((s) => s.setResiduePalette);
  return (
    <div className="form-row">
      <label htmlFor={id}>Residue colours</label>
      <select
        id={id}
        value={palette}
        onChange={(e) => setPalette(e.target.value as ResiduePalette)}
      >
        {PALETTE_LABELS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The schemes that have nothing to say about a molecule without residues. */
const RESIDUE_SCHEMES: ReadonlySet<string> = new Set(['residue', 'chain', 'secondary']);

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

/**
 * Avogadro's Objects tab (Add All / Add Selected / Remove Selected / Display Only Selected /
 * Assign to Selection): which atoms a display type applies to. Avogadro scopes each engine to a
 * list of primitives; with one structure layer the same thing is a display type per atom, plus
 * atoms nothing draws.
 *
 * The assignment follows the atoms (it is keyed by uid), so deleting or optimizing does not hand
 * one atom's display type to another.
 */
function DisplayScope(): JSX.Element {
  const doc = useStructureStore((s) => s.doc);
  const selected = useSelectionStore((s) => s.atoms);
  const assignment = useViewStore((s) => s.atomStyles);
  const setAtomStyles = useViewStore((s) => s.setAtomStyles);
  const colors = useViewStore((s) => s.atomColorOverrides);
  const setColors = useViewStore((s) => s.setAtomColorOverrides);
  const globalStyle = useViewStore((s) => s.style);
  const [style, setStyle] = useState<StructureStyle>(globalStyle);
  const [color, setColor] = useState('#ffb000');
  const counts = assignmentCounts(doc, assignment);
  const colored = assignedColorCount(doc, colors);
  const nothingSelected = selected.size === 0;

  return (
    <>
      <h3>Display scope</h3>
      <div className="form-row">
        <label htmlFor="display-scope-style">Display type to assign</label>
        <select
          id="display-scope-style"
          value={style}
          onChange={(e) => setStyle(e.target.value as StructureStyle)}
        >
          {STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="button-row">
        <button
          type="button"
          disabled={nothingSelected}
          onClick={() => setAtomStyles(assignStyle(assignment, doc, selected, style))}
        >
          Assign to selection
        </button>
        <button
          type="button"
          disabled={nothingSelected}
          onClick={() => setAtomStyles(displayOnly(assignment, doc, selected, style))}
        >
          Display only selection
        </button>
      </div>
      <div className="button-row">
        <button
          type="button"
          disabled={nothingSelected}
          onClick={() => setAtomStyles(assignStyle(assignment, doc, selected, 'hidden'))}
        >
          Hide selection
        </button>
        <button
          type="button"
          disabled={counts.assigned === 0}
          onClick={() => setAtomStyles(NO_STYLES)}
        >
          Show all
        </button>
      </div>
      <p className="muted">
        {counts.assigned === 0
          ? 'Every atom is drawn with the display type above the scope section.'
          : `${counts.assigned} of ${doc.atoms.length} atoms have a display type of their own` +
            (counts.hidden > 0 ? `, ${counts.hidden} of them hidden.` : '.')}
      </p>
      <div className="form-row">
        <label htmlFor="display-scope-color">Colour to assign</label>
        <input
          id="display-scope-color"
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
      </div>
      <div className="button-row">
        <button
          type="button"
          disabled={nothingSelected}
          onClick={() => setColors(assignAtomColor(colors, doc, selected, color))}
        >
          Colour selection
        </button>
        <button type="button" disabled={colored === 0} onClick={() => setColors(NO_ATOM_COLORS)}>
          Clear colours
        </button>
      </div>
      <p className="muted">
        {colored === 0
          ? 'Every atom takes its colour from the scheme above.'
          : `${colored} of ${doc.atoms.length} atoms have a colour of their own, painted over the ` +
            'scheme.'}
      </p>
    </>
  );
}

export function DisplayPanel(): JSX.Element {
  const view = useViewStore();
  const schemes = useColorSchemes();
  // the scheme the view holds is a registered id; a scheme that is no longer registered leaves
  // the atoms their element colours, and the list below would show nothing selected, so the
  // panel says which one it is rather than looking blank
  const unknownScheme = !schemes.some((s) => s.id === view.colorScheme);
  const doc = useStructureStore((s) => s.doc);
  const vectorFields = Object.keys(doc.atomic_vectors ?? {});
  const dipole = dipoleFromCharges(doc);
  const ribbonError = useBioStore((s) => (view.showRibbon ? s.error : null));
  const layer = useRendererStore((s) => s.renderer)?.structureLayer;
  const repeatTruncated = layer?.truncated === true && doc.atoms.length > 0;

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
        <label htmlFor="display-color-scheme">Colour by</label>
        <select
          id="display-color-scheme"
          value={view.colorScheme}
          onChange={(e) => view.setColorScheme(e.target.value)}
        >
          {unknownScheme && (
            <option value={view.colorScheme}>{view.colorScheme} (not available)</option>
          )}
          {schemes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      {view.colorScheme === 'residue' && <PaletteRow id="display-residue-palette" />}
      {RESIDUE_SCHEMES.has(view.colorScheme) && doc.residues.length === 0 && (
        <p className="muted">
          This structure has no residues, so its atoms keep their element colours.
        </p>
      )}
      {view.colorScheme === 'charge' && partialCharges(doc).length === 0 && (
        <p className="muted">
          This structure carries no partial charges, so its atoms keep their element colours. Run
          Extensions ▸ Assign partial charges first.
        </p>
      )}
      {view.colorScheme === 'custom' && (
        <div className="form-row">
          <label htmlFor="display-custom-color">Colour</label>
          <input
            id="display-custom-color"
            type="color"
            value={view.customColor}
            onChange={(e) => view.setCustomColor(e.target.value)}
          />
        </div>
      )}
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
      <div className="form-row">
        <label htmlFor="display-selection-style">Selected atoms</label>
        <select
          id="display-selection-style"
          value={view.selectionStyle ?? ''}
          onChange={(e) =>
            view.setSelectionStyle((e.target.value || null) as StructureStyle | null)
          }
        >
          <option value="">Same as the rest</option>
          {STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <Toggle
        id="display-multiple-bonds"
        label="Show multiple bonds"
        checked={view.multipleBonds}
        onChange={view.toggleMultipleBonds}
      />
      <Toggle
        id="display-hydrogens"
        label="Show hydrogens"
        checked={view.showHydrogens}
        onChange={view.toggleHydrogens}
      />

      <DisplayScope />
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

      <h3>Hydrogen bonds</h3>
      <Toggle
        id="display-hbonds"
        label="Enabled"
        checked={view.showHBonds}
        onChange={view.toggleHBonds}
      />
      <div className="form-row">
        <label htmlFor="display-hbond-distance">Cut-off distance (Å)</label>
        <input
          id="display-hbond-distance"
          type="number"
          min="1.5"
          max="5"
          step="0.1"
          value={view.hbondDistance}
          onChange={(e) => view.setHBondCutoffs({ distance: Number(e.target.value) })}
        />
      </div>
      <div className="form-row">
        <label htmlFor="display-hbond-angle">Cut-off angle (°)</label>
        <input
          id="display-hbond-angle"
          type="number"
          min="90"
          max="180"
          step="5"
          value={view.hbondAngle}
          onChange={(e) => view.setHBondCutoffs({ angle: Number(e.target.value) })}
        />
      </div>

      <h3>Ribbons</h3>
      <Toggle
        id="display-ribbon"
        label="Enabled"
        checked={view.showRibbon}
        onChange={view.toggleRibbon}
      />
      <div className="form-row">
        <label htmlFor="display-ribbon-style">Rendering</label>
        <select
          id="display-ribbon-style"
          value={view.ribbonStyle}
          onChange={(e) => view.setRibbonStyle(e.target.value as RibbonStyle)}
        >
          <option value="cartoon">Cartoon (helix, sheet, coil)</option>
          <option value="ribbon">Ribbon</option>
          <option value="backbone">Backbone</option>
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="display-ribbon-colorby">Colour by</label>
        <select
          id="display-ribbon-colorby"
          value={view.ribbonColorScheme}
          onChange={(e) => view.setRibbonColorScheme(e.target.value as RibbonColorScheme)}
        >
          <option value="secondary">Secondary structure</option>
          <option value="chain">Chain</option>
          <option value="residue">Residue</option>
        </select>
      </div>
      {view.ribbonColorScheme === 'residue' && <PaletteRow id="display-ribbon-palette" />}
      <div className="form-row">
        <label htmlFor="display-ribbon-scale">Width</label>
        <input
          id="display-ribbon-scale"
          type="range"
          min="0.2"
          max="3"
          step="0.1"
          value={view.ribbonScale}
          onChange={(e) => view.setRibbonScale(Number(e.target.value))}
        />
      </div>
      {doc.residues.length === 0 && (
        <p className="muted">This structure has no residues, so it has no backbone to draw.</p>
      )}
      {ribbonError && <p className="error-text">{ribbonError}</p>}

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

      <h3>Dipole moment</h3>
      <Toggle
        id="display-dipole"
        label="Enabled"
        checked={view.showDipole}
        onChange={view.toggleDipole}
      />
      <div className="form-row">
        <label htmlFor="display-dipole-scale">Scale (Å per Debye)</label>
        <input
          id="display-dipole-scale"
          type="range"
          min="0.5"
          max="10"
          step="0.5"
          value={view.dipoleScale}
          onChange={(e) => view.setDipoleScale(Number(e.target.value))}
        />
      </div>
      {dipole === null ? (
        <p className="muted">
          The dipole is summed from the partial charges, and this structure carries none. Run
          Extensions ▸ Assign partial charges first.
        </p>
      ) : (
        <p className="muted">
          {dipole.magnitude.toFixed(3)} D, from the partial charges and the current positions. The
          arrow points from negative toward positive charge.
        </p>
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
      {repeatTruncated && (
        <p className="error-text">
          Too many atoms to repeat that far: only the images that fit are drawn.
        </p>
      )}
      <Toggle
        id="display-axes"
        label="Show axes"
        checked={view.showAxes}
        onChange={view.toggleAxes}
      />
    </div>
  );
}
