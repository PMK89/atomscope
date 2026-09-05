import { useEffect, useMemo, useRef, useState } from 'react';
import { ToolHost } from '../editor/ToolHost';
import { createTools } from '../editor/tools';
import { Renderer } from '../renderer/Renderer';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import { useTrajectoryStore } from '../state/trajectoryStore';
import { frameCell, framePositions, isTrajectoryCompatible } from '../model/trajectory';
import { installExtraLayers, syncExtraLayers } from './viewportLayers';
import { BACKGROUND_HEX, useViewStore } from '../state/viewStore';
import { useIsosurfaceLayers } from './useIsosurfaceLayers';
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
  const trajectory = useTrajectoryStore((s) => s.trajectory);
  const frame = useTrajectoryStore((s) => s.frame);
  // only a trajectory describing this very structure may override its geometry
  const active = trajectory && isTrajectoryCompatible(doc, trajectory) ? trajectory : null;
  // stable per frame so layers skip matrix updates on hover/selection-only changes
  const positionsOverride = useMemo(
    () => (active ? framePositions(active, frame) : null),
    [active, frame],
  );
  const cellOverride = useMemo(() => (active ? frameCell(active, frame) : null), [active, frame]);
  const lastFitted = useRef<string | null>(null);
  const lastFitRequest = useRef(0);
  useIsosurfaceLayers(rendererRef);

  useEffect(() => {
    if (!ref.current) return;
    const renderer = new Renderer(ref.current);
    installExtraLayers(renderer);
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
    syncExtraLayers(r, view);
    r.update({
      structure: doc,
      revision,
      selectedAtoms: selected,
      hoveredAtom: hovered,
      positionsOverride,
      cellOverride,
    });
    if (lastFitted.current !== doc.id || lastFitRequest.current !== view.fitRequest) {
      lastFitted.current = doc.id;
      lastFitRequest.current = view.fitRequest;
      r.fitToStructure();
    }
  }, [doc, revision, selected, hovered, view, positionsOverride, cellOverride]);

  return (
    <div ref={ref} className="viewport-canvas" data-testid="viewport">
      {mounted && <ViewportOverlay renderer={mounted.renderer} host={mounted.host} />}
    </div>
  );
}
