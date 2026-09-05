/** Glue between the view store and the extra display layers (vectors, unit cell, axes). */
import type { Renderer } from '../renderer/Renderer';
import { AxesLayer } from '../renderer/layers/AxesLayer';
import { LabelLayer } from '../renderer/layers/LabelLayer';
import { RibbonLayer, type SecondaryStructureData } from '../renderer/layers/RibbonLayer';
import { UnitCellLayer } from '../renderer/layers/UnitCellLayer';
import { VectorLayer } from '../renderer/layers/VectorLayer';
import type { ViewState } from '../state/viewStore';

export function installExtraLayers(renderer: Renderer): void {
  renderer.addLayer(new VectorLayer());
  renderer.addLayer(new UnitCellLayer());
  renderer.addLayer(new AxesLayer());
  renderer.addLayer(new LabelLayer());
  renderer.addLayer(new RibbonLayer());
}

export function syncExtraLayers(
  renderer: Renderer,
  view: ViewState,
  secondary: SecondaryStructureData | null = null,
): void {
  const ribbon = renderer.getLayer('ribbon');
  if (ribbon instanceof RibbonLayer) {
    ribbon.visible = view.showRibbon;
    ribbon.setData(secondary);
    ribbon.setSettings({ style: view.ribbonStyle, scale: view.ribbonScale });
  }
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
  const labels = renderer.getLayer('labels');
  if (labels instanceof LabelLayer) {
    labels.visible = view.showLabels;
    labels.setSettings({
      atoms: view.atomLabels,
      bonds: view.bondLabels,
      hideHydrogens: !view.showHydrogens,
      lift: view.style === 'vdw' ? 'vdw' : 'small',
      color: view.labelColor,
      size: view.labelSize,
      shift: view.labelShift,
    });
  }
}
