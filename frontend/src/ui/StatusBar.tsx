import { formula } from '../model/structure';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import { useToolStore } from '../editor/toolStore';
import { formatMeasurement, measure } from '../editor/measure';
import { usePlugins } from '../plugins/context';

export function StatusBar({ message }: { message: string | null }): JSX.Element {
  const doc = useStructureStore((s) => s.doc);
  const selected = useSelectionStore((s) => s.atoms);
  const selectedBonds = useSelectionStore((s) => s.bonds);
  const hovered = useSelectionStore((s) => s.hoveredAtom);
  const hoveredAtom = hovered !== null ? doc.atoms[hovered] : undefined;
  const tool = useToolStore((s) => s.active);
  const autoOptimize = useToolStore((s) => s.autoOptimize.message);
  const picks = useToolStore((s) => s.measure.atoms);
  const measurement = tool === 'measure' ? formatMeasurement(measure(doc, picks)) : '';
  const toolLabel = usePlugins().tool(tool)?.tool.label;
  const modified = useStructureStore((s) => s.doc !== s.savedDoc);
  return (
    <footer className="app-statusbar">
      <span>
        {doc.name}
        {modified && (
          <span className="status-modified" title="unsaved changes">
            {' •'}
          </span>
        )}
      </span>
      <span>{formula(doc) || '—'}</span>
      <span>
        {doc.atoms.length} atoms, {doc.bonds.length} bonds
      </span>
      <span>
        {selected.size} selected
        {selectedBonds.size > 0 &&
          `, ${selectedBonds.size} bond${selectedBonds.size > 1 ? 's' : ''}`}
      </span>
      <span className="muted">{toolLabel}</span>
      {measurement && <span data-testid="measurement">{measurement}</span>}
      {hoveredAtom && (
        <span>
          {hoveredAtom.element}
          {hovered !== null ? hovered + 1 : ''} (
          {hoveredAtom.position.map((x) => x.toFixed(3)).join(', ')}) Å
        </span>
      )}
      {(message ?? autoOptimize) && <span className="status-error">{message ?? autoOptimize}</span>}
    </footer>
  );
}
