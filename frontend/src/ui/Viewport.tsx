import { useEffect, useRef, useState } from 'react';
import { ToolHost } from '../editor/ToolHost';
import { createTools } from '../editor/tools';
import { Renderer } from '../renderer/Renderer';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import { BACKGROUND_HEX, useViewStore } from '../state/viewStore';
import { ViewportOverlay } from './ViewportOverlay';

/** Owns one Renderer for its lifetime, feeds it store snapshots and routes input to the tools. */
export function Viewport(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [mounted, setMounted] = useState<{ renderer: Renderer; host: ToolHost } | null>(null);
  const doc = useStructureStore((s) => s.doc);
  const revision = useStructureStore((s) => s.revision);
  const selected = useSelectionStore((s) => s.atoms);
  const hovered = useSelectionStore((s) => s.hoveredAtom);
  const view = useViewStore();
  const lastFitted = useRef<string | null>(null);
  const lastFitRequest = useRef(0);

  useEffect(() => {
    if (!ref.current) return;
    const renderer = new Renderer(ref.current);
    rendererRef.current = renderer;
    const host = new ToolHost(renderer, createTools(), renderer.gl.domElement);
    setMounted({ renderer, host });
    return () => {
      host.dispose();
      renderer.dispose();
      rendererRef.current = null;
      setMounted(null);
    };
  }, []);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.structureLayer.setSettings({ style: view.style, showHydrogens: view.showHydrogens });
    r.setBackground(BACKGROUND_HEX[view.background]);
    if (r.projection !== view.projection) r.setProjection(view.projection);
    r.update({ structure: doc, revision, selectedAtoms: selected, hoveredAtom: hovered });
    if (lastFitted.current !== doc.id || lastFitRequest.current !== view.fitRequest) {
      lastFitted.current = doc.id;
      lastFitRequest.current = view.fitRequest;
      r.fitToStructure();
    }
  }, [doc, revision, selected, hovered, view]);

  return (
    <div ref={ref} className="viewport-canvas" data-testid="viewport">
      {mounted && <ViewportOverlay renderer={mounted.renderer} host={mounted.host} />}
    </div>
  );
}
