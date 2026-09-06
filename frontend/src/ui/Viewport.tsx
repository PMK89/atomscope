import { useEffect, useMemo, useRef, useState } from 'react';
import { ToolHost } from '../editor/ToolHost';
import { Renderer } from '../renderer/Renderer';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import { useTrajectoryStore } from '../state/trajectoryStore';
import { frameCell, framePositions, isTrajectoryCompatible } from '../model/trajectory';
import { installExtraLayers, syncExtraLayers } from './viewportLayers';
import { backgroundHex, useViewStore } from '../state/viewStore';
import { atomColorArray } from '../renderer/atomColors';
import { partialCharges } from '../renderer/labels';
import { hiddenAtoms, styleArray } from '../renderer/atomStyles';
import { useBioStore } from '../state/bioStore';
import { useRendererStore } from '../state/rendererStore';
import { useIsosurfaceLayers } from './useIsosurfaceLayers';
import { ViewportOverlay } from './ViewportOverlay';
import { usePlugins } from '../plugins/context';

/** Owns one Renderer for its lifetime, feeds it store snapshots and routes input to the tools. */
export function Viewport(): JSX.Element {
  const registry = usePlugins();
  const ref = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [mounted, setMounted] = useState<{ renderer: Renderer; host: ToolHost } | null>(null);
  const doc = useStructureStore((s) => s.doc);
  const revision = useStructureStore((s) => s.revision);
  const selected = useSelectionStore((s) => s.atoms);
  const selectedBonds = useSelectionStore((s) => s.bonds);
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
  const secondary = useBioStore((s) => s.data);
  // Colours follow the residues, not the coordinates: keyed on the whole document they would be
  // rebuilt on every frame of a drag, and a new array repaints every instance colour.
  // colours follow the residues, not the coordinates, so a drag does not recompute them
  const atomCount = doc.atoms.length;
  const residues = doc.residues;
  const scheme = view.colorScheme;
  // only the scheme that reads them takes the positions or the charges, so the schemes that do
  // not are still keyed on the residues alone and cost nothing during a drag
  const colorAtoms = scheme === 'distance' ? doc.atoms : null;
  const colorCharges = useMemo(() => {
    if (scheme !== 'charge') return null;
    const charges = partialCharges(doc);
    return charges.length ? charges : null;
  }, [scheme, doc]);
  const custom = view.customColor;
  const palette = view.residuePalette;
  const schemeColors = useMemo(
    () =>
      registry.colorScheme(scheme)?.colors({
        residues,
        atomCount,
        secondary,
        atoms: colorAtoms,
        charges: colorCharges,
        custom,
        palette,
      }) ?? null,
    [registry, residues, atomCount, scheme, secondary, colorAtoms, colorCharges, custom, palette],
  );
  // per-atom colours are painted over the scheme, and give the array back untouched when there
  // are none -- so an unassigned document keeps the identity the structure layer compares
  const perAtom = view.atomColorOverrides;
  const atomColorOverride = useMemo(
    () => atomColorArray(schemeColors, doc, perAtom),
    [schemeColors, doc, perAtom],
  );
  // engine primitive scoping: uid-keyed in the store, resolved to one entry per atom here, and
  // stable while neither the atoms nor the assignment change (a new array rebuilds the meshes)
  const assignment = view.atomStyles;
  const atomStyleOverride = useMemo(() => styleArray(doc, assignment), [doc, assignment]);
  const hidden = useMemo(() => hiddenAtoms(atomStyleOverride), [atomStyleOverride]);
  const lastFitted = useRef<string | null>(null);
  const lastFitRequest = useRef(0);
  const lastCenterRequest = useRef(0);
  // renderer readiness as state, so surfaces already in the store mount into a new renderer
  useIsosurfaceLayers(mounted?.renderer ?? null);

  useEffect(() => {
    if (!ref.current) return;
    const renderer = new Renderer(ref.current);
    installExtraLayers(renderer, registry);
    rendererRef.current = renderer;
    const tools = registry.tools().map((c) => c.tool);
    const host = new ToolHost(renderer, tools, renderer.gl.domElement);
    setMounted({ renderer, host });
    useRendererStore.getState().setRenderer(renderer);
    return () => {
      host.dispose();
      renderer.dispose();
      rendererRef.current = null;
      useRendererStore.getState().setRenderer(null);
      setMounted(null);
    };
  }, [registry]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.structureLayer.setSettings({
      style: view.style,
      showHydrogens: view.showHydrogens,
      atomScale: view.atomScale,
      bondRadius: view.bondRadius,
      selectionStyle: view.selectionStyle,
      multipleBonds: view.multipleBonds,
      cellRepeat: view.cellRepeat,
      atomColors: atomColorOverride,
      atomStyles: atomStyleOverride,
      quality: view.quality,
    });
    r.setBackground(backgroundHex(view));
    r.setFog(view.fog);
    if (r.projection !== view.projection) r.setProjection(view.projection);
    syncExtraLayers(r, view, view.showRibbon ? secondary : null, hidden);
    r.update({
      structure: doc,
      revision,
      selectedAtoms: selected,
      selectedBonds,
      hoveredAtom: hovered,
      positionsOverride,
      cellOverride,
    });
    if (lastCenterRequest.current !== view.centerRequest) {
      lastCenterRequest.current = view.centerRequest;
      r.centerOnStructure();
    }
    if (lastFitted.current !== doc.id || lastFitRequest.current !== view.fitRequest) {
      lastFitted.current = doc.id;
      lastFitRequest.current = view.fitRequest;
      r.fitToStructure();
    }
  }, [
    doc,
    revision,
    selected,
    selectedBonds,
    hovered,
    view,
    positionsOverride,
    cellOverride,
    secondary,
    atomColorOverride,
    atomStyleOverride,
    hidden,
  ]);

  // the assignment depends on the geometry, so it is refetched per revision -- but only while
  // something is drawing it
  useEffect(() => {
    // the ribbon draws it, and so does colouring by secondary structure
    if (view.showRibbon || view.colorScheme === 'secondary') {
      void useBioStore.getState().load(doc, revision);
    }
  }, [view.showRibbon, view.colorScheme, doc, revision]);

  return (
    <div ref={ref} className="viewport-canvas" data-testid="viewport">
      {mounted && <ViewportOverlay renderer={mounted.renderer} host={mounted.host} />}
    </div>
  );
}
