/**
 * Bridge between the volumetric store and the renderer: one IsosurfaceLayer per grid that has
 * at least one surface definition. Meshing runs inside the layer (worker), not in React.
 */
import { useEffect, useRef } from 'react';
import { IsosurfaceLayer } from '../renderer/layers/IsosurfaceLayer';
import type { Renderer } from '../renderer/Renderer';
import { gridGeometry, surfaceSpecs, useVolumetricStore } from '../state/volumetricStore';

export function useIsosurfaceLayers(renderer: Renderer | null): void {
  const grids = useVolumetricStore((s) => s.grids);
  const surfaces = useVolumetricStore((s) => s.surfaces);
  const layers = useRef(new Map<string, IsosurfaceLayer>());

  useEffect(() => {
    if (!renderer) return;
    const wanted = new Set<string>();
    for (const def of surfaces) {
      const grid = grids[def.gridId];
      if (!grid) continue;
      wanted.add(def.gridId);
      let layer = layers.current.get(def.gridId);
      if (!layer) {
        layer = new IsosurfaceLayer(def.gridId, grid.values, gridGeometry(grid.meta));
        layer.onChange = () => renderer.invalidate();
        layer.onWarning = (specId, message) =>
          useVolumetricStore.getState().setSurfaceWarning(specId, message);
        layers.current.set(def.gridId, layer);
        renderer.addLayer(layer);
      }
    }
    for (const [gridId, layer] of layers.current) {
      if (wanted.has(gridId)) {
        layer.setSurfaces(surfaces.filter((d) => d.gridId === gridId).flatMap(surfaceSpecs));
      } else {
        layers.current.delete(gridId);
        renderer.removeLayer(layer);
      }
    }
    renderer.invalidate();
  }, [grids, surfaces, renderer]);

  // a renderer disposes its own layers when it goes away; forget our references with it
  useEffect(() => () => layers.current.clear(), [renderer]);
}
