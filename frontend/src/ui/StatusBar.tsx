import { formula } from '../model/structure';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';

export function StatusBar({ message }: { message: string | null }): JSX.Element {
  const doc = useStructureStore((s) => s.doc);
  const selected = useSelectionStore((s) => s.atoms);
  const hovered = useSelectionStore((s) => s.hoveredAtom);
  const hoveredAtom = hovered !== null ? doc.atoms[hovered] : undefined;
  return (
    <footer className="app-statusbar">
      <span>{doc.name}</span>
      <span>{formula(doc) || '—'}</span>
      <span>
        {doc.atoms.length} atoms, {doc.bonds.length} bonds
      </span>
      <span>{selected.size} selected</span>
      {hoveredAtom && (
        <span>
          {hoveredAtom.element}
          {hovered !== null ? hovered + 1 : ''} (
          {hoveredAtom.position.map((x) => x.toFixed(3)).join(', ')}) Å
        </span>
      )}
      {message && <span className="status-error">{message}</span>}
    </footer>
  );
}
