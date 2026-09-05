import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { normalizeSymbol } from '../editor/cartesian';
import { rotateAtoms, setBondLength, translateAtoms } from '../editor/edits';
import { formatMeasurement, measure } from '../editor/measure';
import { TOOL_INFO } from '../editor/tools';
import { bondLength, movingSide } from '../editor/tools/BondCentricTool';
import { useToolStore } from '../editor/toolStore';
import { ELEMENT_BY_SYMBOL } from '../model/elements';
import type { Vec3 } from '../model/structure';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import { NumberField } from './NumberField';
import { PeriodicTable } from './PeriodicTable';

/** Floating panel over the viewport with the active tool's settings. */
export function ToolSettings(): JSX.Element {
  const active = useToolStore((s) => s.active);
  const info = TOOL_INFO.find((t) => t.id === active);
  return (
    <div className="tool-settings panel" data-testid="tool-settings">
      <h4>{info?.label}</h4>
      {active === 'draw' && <DrawSettings />}
      {active === 'select' && <SelectSettings />}
      {active === 'manipulate' && <ManipulateSettings />}
      {active === 'bond-centric' && <BondCentricSettings />}
      {active === 'measure' && <MeasureReadout />}
      {active === 'auto-optimize' && <AutoOptimizeSettings />}
      {active === 'auto-rotate' && <AutoRotateSettings />}
      {active === 'navigate' && <p className="muted">{info?.description}</p>}
    </div>
  );
}

function DrawSettings(): JSX.Element {
  const draw = useToolStore((s) => s.draw);
  const update = useToolStore((s) => s.update);
  const [text, setText] = useState(draw.element);
  const [table, setTable] = useState(false);
  const commitSymbol = (raw: string): void => {
    const sym = normalizeSymbol(raw);
    if (ELEMENT_BY_SYMBOL.has(sym) && sym !== 'X') {
      update('draw', { element: sym });
      setText(sym);
    } else setText(draw.element);
  };
  return (
    <>
      <div className="form-row">
        <label>Element</label>
        <div className="form-control">
          <input
            aria-label="Element symbol"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => commitSymbol(text)}
            onKeyDown={(e) => e.key === 'Enter' && commitSymbol(text)}
          />
          <button className="tab" onClick={() => setTable(!table)} aria-label="Periodic table">
            …
          </button>
        </div>
      </div>
      {table && (
        <PeriodicTable
          value={draw.element}
          onPick={(s) => {
            commitSymbol(s);
            setTable(false);
          }}
        />
      )}
      <div className="form-row">
        <label>Bond order</label>
        <select
          aria-label="Bond order"
          value={draw.bondOrder}
          onChange={(e) => update('draw', { bondOrder: Number(e.target.value) as 1 | 2 | 3 })}
        >
          <option value={1}>Single</option>
          <option value={2}>Double</option>
          <option value={3}>Triple</option>
        </select>
      </div>
      <label className="form-advanced-toggle">
        <input
          type="checkbox"
          checked={draw.adjustHydrogens}
          onChange={(e) => update('draw', { adjustHydrogens: e.target.checked })}
        />
        Adjust hydrogens
      </label>
    </>
  );
}

function SelectSettings(): JSX.Element {
  const mode = useToolStore((s) => s.select.mode);
  const update = useToolStore((s) => s.update);
  const hasResidues = useStructureStore((s) => s.doc.residues.length > 0);
  return (
    <div className="form-row">
      <label>Mode</label>
      <select
        aria-label="Selection mode"
        value={mode}
        onChange={(e) => update('select', { mode: e.target.value as typeof mode })}
      >
        <option value="atoms">Atoms and bonds</option>
        {/* also when it is the current mode: a remembered one must not vanish from its own box */}
        {(hasResidues || mode === 'residues') && <option value="residues">Residues</option>}
        <option value="molecules">Molecules</option>
      </select>
    </div>
  );
}

/** Same rule as the Edit commands: everything only when nothing at all is selected. */
function targetAtoms(): number[] {
  const sel = useSelectionStore.getState();
  const n = useStructureStore.getState().doc.atoms.length;
  if (sel.atoms.size) return [...sel.atoms];
  return sel.bonds.size ? [] : Array.from({ length: n }, (_, i) => i);
}

function ManipulateSettings(): JSX.Element {
  const [t, setT] = useState<Vec3>([0, 0, 0]);
  const [angle, setAngle] = useState(90);
  const selected = useSelectionStore((s) => s.atoms.size);
  const apply = (
    label: string,
    f: (atoms: number[]) => ReturnType<typeof translateAtoms>,
  ): void => {
    const st = useStructureStore.getState();
    const atoms = targetAtoms();
    st.commit(`${label} ${atoms.length} atom${atoms.length === 1 ? '' : 's'}`, f(atoms));
  };
  const axis = (i: number): Vec3 => [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0];
  return (
    <>
      <p className="muted">Applies to {selected ? `${selected} selected atom(s)` : 'all atoms'}.</p>
      <div className="form-row">
        <label>Translate (Å)</label>
        <div className="form-vector">
          {t.map((v, i) => (
            <NumberField
              key={i}
              value={v}
              digits={2}
              label={`Translate ${'xyz'[i]}`}
              onCommit={(x) => setT(t.map((o, j) => (j === i ? x : o)) as Vec3)}
            />
          ))}
        </div>
      </div>
      <div className="button-row">
        <button
          onClick={() =>
            apply('Move', (a) => translateAtoms(useStructureStore.getState().doc, a, t))
          }
        >
          Translate
        </button>
      </div>
      <div className="form-row">
        <label>Rotate (°)</label>
        <NumberField value={angle} digits={1} step={1} label="Rotation angle" onCommit={setAngle} />
      </div>
      <div className="button-row">
        {['x', 'y', 'z'].map((name, i) => (
          <button
            key={name}
            onClick={() =>
              apply('Rotate', (a) =>
                rotateAtoms(useStructureStore.getState().doc, a, axis(i), (angle * Math.PI) / 180),
              )
            }
          >
            About {name}
          </button>
        ))}
      </div>
    </>
  );
}

function BondCentricSettings(): JSX.Element {
  const bond = useToolStore((s) => s.bondCentric.bond);
  const doc = useStructureStore((s) => s.doc);
  const len = bond !== null ? bondLength(doc, bond) : null;
  if (bond === null || len === null) return <p className="muted">Click a bond to select it.</p>;
  const b = doc.bonds[bond]!;
  return (
    <div className="form-row">
      <label>
        {doc.atoms[b.a]?.element}
        {b.a + 1}–{doc.atoms[b.b]?.element}
        {b.b + 1} length (Å)
      </label>
      <NumberField
        value={len}
        digits={3}
        label="Bond length"
        onCommit={(v) => {
          const st = useStructureStore.getState();
          st.commit(
            'Change bond length',
            setBondLength(st.doc, bond, v, movingSide(st.doc, bond).atoms),
          );
        }}
      />
      <p className="muted">Drag an atom next to the bond to change the angle it makes with it.</p>
    </div>
  );
}

function MeasureReadout(): JSX.Element {
  const picks = useToolStore((s) => s.measure.atoms);
  const doc = useStructureStore((s) => s.doc);
  const text = formatMeasurement(measure(doc, picks));
  return (
    <p className="muted">
      {picks.length === 0 && 'Click up to four atoms.'}
      {picks.length === 1 && 'Click a second atom for a distance.'}
      {text}
    </p>
  );
}

function AutoRotateSettings(): JSX.Element {
  const ar = useToolStore((s) => s.autoRotate);
  const update = useToolStore((s) => s.update);
  return (
    <>
      {(['x', 'y', 'z'] as const).map((k) => (
        <div className="form-row" key={k}>
          <label>{k} (°/s)</label>
          <div className="form-control">
            <input
              type="range"
              min={-180}
              max={180}
              value={ar[k]}
              aria-label={`Speed ${k}`}
              onChange={(e) => update('autoRotate', { [k]: Number(e.target.value) })}
            />
            <span className="form-unit">{ar[k]}</span>
          </div>
        </div>
      ))}
      <div className="button-row">
        <button
          className={ar.running ? '' : 'primary'}
          onClick={() => update('autoRotate', { running: !ar.running })}
        >
          {ar.running ? 'Stop' : 'Start'}
        </button>
        <button onClick={() => update('autoRotate', { x: 0, y: 0, z: 0 })}>Reset</button>
      </div>
    </>
  );
}

function AutoOptimizeSettings(): JSX.Element {
  const opt = useToolStore((s) => s.autoOptimize);
  const update = useToolStore((s) => s.update);
  const [fields, setFields] = useState<string[]>([]);
  useEffect(() => {
    api.chem
      .forceFields()
      .then((f) => {
        setFields(f.force_fields);
        // a force field remembered from another machine's Open Babel may not be built here, and
        // posting a name the backend does not have is a 400 on the first run rather than a choice
        const first = f.force_fields[0];
        if (first && !f.force_fields.includes(useToolStore.getState().autoOptimize.forceField)) {
          update('autoOptimize', { forceField: first });
        }
      })
      .catch(() => setFields([]));
  }, [update]);
  return (
    <>
      <div className="form-row">
        <label htmlFor="autoopt-ff">Force field</label>
        <select
          id="autoopt-ff"
          value={opt.forceField}
          onChange={(e) => update('autoOptimize', { forceField: e.target.value })}
        >
          {(fields.length ? fields : [opt.forceField]).map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="autoopt-algorithm">Algorithm</label>
        <select
          id="autoopt-algorithm"
          value={opt.algorithm}
          onChange={(e) =>
            update('autoOptimize', {
              algorithm: e.target.value as typeof opt.algorithm,
            })
          }
        >
          <option value="steepest_descent">Steepest descent</option>
          <option value="conjugate_gradients">Conjugate gradients</option>
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="autoopt-steps">Steps per round</label>
        <input
          id="autoopt-steps"
          type="number"
          min={1}
          max={100}
          value={opt.steps}
          onChange={(e) =>
            update('autoOptimize', {
              steps: Math.min(100, Math.max(1, Number(e.target.value) || 1)),
            })
          }
        />
      </div>
      <div className="button-row">
        <button
          className={opt.running ? '' : 'primary'}
          onClick={() => update('autoOptimize', { running: !opt.running, message: null })}
        >
          {opt.running ? 'Stop' : 'Start'}
        </button>
      </div>
      {opt.energy !== null && (
        <p className="muted">
          Energy {opt.energy.toFixed(4)} {opt.energyUnit}
        </p>
      )}
      <p className="muted">
        Drag an atom while it runs and the rest relaxes around it. The whole run is one undo step.
      </p>
    </>
  );
}
