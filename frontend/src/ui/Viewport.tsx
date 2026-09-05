import { useEffect, useMemo, useRef } from 'react';
import { Renderer } from '../renderer/Renderer';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import { useTrajectoryStore } from '../state/trajectoryStore';
import { frameCell, framePositions } from '../model/trajectory';
import { installExtraLayers, syncExtraLayers } from './viewportLayers';
import { BACKGROUND_HEX, useViewStore } from '../state/viewStore';
import { useIsosurfaceLayers } from './useIsosurfaceLayers';

/** Owns one Renderer for its lifetime, feeds it store snapshots and routes pointer picks. */
export function Viewport(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const doc = useStructureStore((s) => s.doc);
  const revision = useStructureStore((s) => s.revision);
  const selected = useSelectionStore((s) => s.atoms);
  const hovered = useSelectionStore((s) => s.hoveredAtom);
  const view = useViewStore();
  const trajectory = useTrajectoryStore((s) => s.trajectory);
  const frame = useTrajectoryStore((s) => s.frame);
  // stable per frame so layers skip matrix updates on hover/selection-only changes
  const positionsOverride = useMemo(
    () => (trajectory ? framePositions(trajectory, frame) : null),
    [trajectory, frame],
  );
  const cellOverride = useMemo(
    () => (trajectory ? frameCell(trajectory, frame) : null),
    [trajectory, frame],
  );
  const lastFitted = useRef<string | null>(null);
  const lastFitRequest = useRef(0);
  useIsosurfaceLayers(rendererRef);

  useEffect(() => {
    if (!ref.current) return;
    const renderer = new Renderer(ref.current);
    installExtraLayers(renderer);
    rendererRef.current = renderer;
    const el = renderer.gl.domElement;
    let downAt: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent): void => {
      downAt = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent): void => {
      if (!downAt || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 3;
      downAt = null;
      if (moved) return;
      const idx = renderer.pickAtom(e.clientX, e.clientY);
      const sel = useSelectionStore.getState();
      if (idx === null) {
        if (!e.shiftKey && !e.ctrlKey) sel.clear();
      } else if (e.shiftKey || e.ctrlKey) sel.toggleAtom(idx);
      else sel.set([idx]);
    };
    const onMove = (e: PointerEvent): void => {
      if (e.buttons !== 0) return;
      const idx = renderer.pickAtom(e.clientX, e.clientY);
      if (idx !== useSelectionStore.getState().hoveredAtom)
        useSelectionStore.getState().setHovered(idx);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointermove', onMove);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointermove', onMove);
      renderer.dispose();
      rendererRef.current = null;
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

  return <div ref={ref} className="viewport-canvas" data-testid="viewport" />;
}
