/** Glue between the view store and the extra display layers (vectors, unit cell, axes). */
import type { Renderer } from '../renderer/Renderer';
import { LabelLayer } from '../renderer/layers/LabelLayer';
import { HBondLayer } from '../renderer/layers/HBondLayer';
import { PolygonLayer } from '../renderer/layers/PolygonLayer';
import { RingLayer } from '../renderer/layers/RingLayer';
import { AxesLayer } from '../renderer/layers/AxesLayer';
import { RibbonLayer, type SecondaryStructureData } from '../renderer/layers/RibbonLayer';
import { UnitCellLayer } from '../renderer/layers/UnitCellLayer';
import { VectorLayer } from '../renderer/layers/VectorLayer';
import { DipoleLayer } from '../renderer/layers/DipoleLayer';
import { enabledLayers } from '../plugins/enabled';
import type { LayerContribution, PluginRegistry } from '../plugins/registry';
import type { ViewState } from '../state/viewStore';

/**
 * Add every contributed layer to a renderer, in registration order. The registry knows a layer
 * by its contribution's id and the renderer by the instance's, so a contribution whose factory
 * builds a layer of another name would register and then never be found again: it is refused
 * here rather than going quiet.
 */
export function installLayer(renderer: Renderer, contribution: LayerContribution): void {
  const layer = contribution.create();
  if (layer.id !== contribution.id) {
    throw new Error(`layer ${contribution.id} builds a layer that calls itself ${layer.id}`);
  }
  renderer.addLayer(layer);
}

/** Every contributed layer that is switched on, in registration order. */
export function installExtraLayers(
  renderer: Renderer,
  registry: PluginRegistry,
  disabled: ReadonlySet<string> = new Set(),
): void {
  for (const contribution of enabledLayers(registry, disabled))
    installLayer(renderer, contribution);
}

export function syncExtraLayers(
  renderer: Renderer,
  view: ViewState,
  secondary: SecondaryStructureData | null = null,
  hiddenAtoms: ReadonlySet<number> | null = null,
): void {
  const rings = renderer.getLayer('rings');
  if (rings instanceof RingLayer) {
    rings.visible = view.showRings;
    rings.setSettings({ opacity: view.ringOpacity });
    rings.setHidden(hiddenAtoms);
  }
  const polygons = renderer.getLayer('polygons');
  if (polygons instanceof PolygonLayer) {
    polygons.visible = view.showPolygons;
    polygons.setSettings({ opacity: view.polygonOpacity });
    polygons.setHidden(hiddenAtoms);
  }
  const hbonds = renderer.getLayer('hbonds');
  if (hbonds instanceof HBondLayer) {
    hbonds.visible = view.showHBonds;
    hbonds.setSettings({
      maxDistance: view.hbondDistance,
      minAngle: view.hbondAngle,
      // Avogadro's width is a GL line width in pixels (1-3); a dash here is a cylinder, so the
      // three steps map to radii that read as the same three thicknesses
      width: 0.03 * view.hbondWidth,
    });
    hbonds.setHidden(hiddenAtoms);
  }
  const ribbon = renderer.getLayer('ribbon');
  if (ribbon instanceof RibbonLayer) {
    ribbon.visible = view.showRibbon;
    ribbon.setData(secondary);
    ribbon.setHidden(hiddenAtoms);
    ribbon.setSettings({
      style: view.ribbonStyle,
      scale: view.ribbonScale,
      colorScheme: view.ribbonColorScheme,
      residuePalette: view.residuePalette,
      cartoonColors: view.cartoonColors,
      useNitrogens: view.ribbonNitrogens,
    });
  }
  const vectors = renderer.getLayer('vectors');
  if (vectors instanceof VectorLayer) {
    vectors.visible = view.showVectors;
    vectors.setSettings({ field: view.vectorField, scale: view.vectorScale });
    vectors.setHidden(hiddenAtoms);
  }
  const dipole = renderer.getLayer('dipole');
  if (dipole instanceof DipoleLayer) {
    dipole.visible = view.showDipole;
    dipole.setSettings({ scale: view.dipoleScale });
  }
  const cell = renderer.getLayer('unit-cell');
  if (cell instanceof UnitCellLayer) {
    cell.visible = view.showUnitCell;
    cell.setSettings({ repeat: view.cellRepeat });
  }
  const axes = renderer.getLayer('axes');
  if (axes instanceof AxesLayer) {
    axes.visible = view.showAxes;
    axes.setSettings({
      mode: view.axesMode,
      axesType: view.axesType,
      origin: view.axesOrigin,
      vectors: view.axesVectors,
      length: view.axesLength,
    });
  } else if (axes) {
    axes.visible = view.showAxes;
  }
  const labels = renderer.getLayer('labels');
  if (labels instanceof LabelLayer) {
    labels.visible = view.showLabels;
    labels.setSettings({
      atoms: view.atomLabels,
      bonds: view.bondLabels,
      hideHydrogens: !view.showHydrogens,
      hiddenAtoms,
      lift: view.style === 'vdw' ? 'vdw' : 'small',
      color: view.labelColor,
      size: view.labelSize,
      shift: view.labelShift,
      bondShift: view.bondLabelShift,
      lengthPrecision: view.labelPrecision,
    });
  }
}
