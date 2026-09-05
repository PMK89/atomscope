import { useEffect, useRef } from 'react';
import { Renderer } from '../renderer/Renderer';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';

/** Owns one Renderer for its lifetime and feeds it store snapshots. */
export function Viewport({ onRenderer }: { onRenderer?: (r: Renderer | null) => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const doc = useStructureStore((s) => s.doc);
  const revision = useStructureStore((s) => s.revision);
  const selected = useSelectionStore((s) => s.atoms);
  const hovered = useSelectionStore((s) => s.hoveredAtom);
  const lastFitted = useRef<string | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const renderer = new Renderer(ref.current);
    rendererRef.current = renderer;
    onRenderer?.(renderer);
    return () => {
      onRenderer?.(null);
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [onRenderer]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.update({ structure: doc, revision, selectedAtoms: selected, hoveredAtom: hovered });
    if (lastFitted.current !== doc.id) {
      lastFitted.current = doc.id;
      r.fitToStructure();
    }
  }, [doc, revision, selected, hovered]);

  return <div ref={ref} className="viewport-canvas" data-testid="viewport" />;
}
