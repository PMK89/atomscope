/** Glue between the view store and the extra display layers (vectors, unit cell, axes). */
import type { Renderer } from '../renderer/Renderer';
import { AxesLayer } from '../renderer/layers/AxesLayer';
import { UnitCellLayer } from '../renderer/layers/UnitCellLayer';
import { VectorLayer } from '../renderer/layers/VectorLayer';
import type { ViewState } from '../state/viewStore';

export function installExtraLayers(renderer: Renderer): void {
  renderer.addLayer(new VectorLayer());
  renderer.addLayer(new UnitCellLayer());
  renderer.addLayer(new AxesLayer());
}

export function syncExtraLayers(renderer: Renderer, view: ViewState): void {
  const vectors = renderer.getLayer('vectors');
  if (vectors instanceof VectorLayer) {
    vectors.visible = view.showVectors;
    vectors.setSettings({ field: view.vectorField, scale: view.vectorScale });
  }
  const cell = renderer.getLayer('unit-cell');
  if (cell instanceof UnitCellLayer) {
    cell.visible = view.showUnitCell;
    cell.setSettings({ repeat: view.cellRepeat });
  }
  const axes = renderer.getLayer('axes');
  if (axes) axes.visible = view.showAxes;
}
