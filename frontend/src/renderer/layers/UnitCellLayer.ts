/**
 * The periodic cell as 12 line edges (optionally repeated nx x ny x nz for display) with a/b/c
 * labels. Uses the frame's cell override when a trajectory is shown.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Sprite,
} from 'three';
import { cellEdgePositions, type Mat3 } from '../cell';
import { disposeSprite, makeTextSprite } from '../textSprite';
import type { DisplayLayer, LayerContext } from './Layer';

export interface UnitCellLayerSettings {
  repeat: [number, number, number];
  color: number;
  showLabels: boolean;
}

export const DEFAULT_UNIT_CELL_SETTINGS: UnitCellLayerSettings = {
  repeat: [1, 1, 1],
  color: 0x555555,
  showLabels: true,
};

export class UnitCellLayer implements DisplayLayer {
  readonly id = 'unit-cell';
  readonly object = new Group();
  visible = true;
  settings: UnitCellLayerSettings;

  private lines: LineSegments | null = null;
  private labels: Sprite[] = [];
  private readonly material = new LineBasicMaterial({ color: 0x555555 });
  private lastKey = '';

  constructor(settings: Partial<UnitCellLayerSettings> = {}) {
    this.settings = { ...DEFAULT_UNIT_CELL_SETTINGS, ...settings };
  }

  setSettings(patch: Partial<UnitCellLayerSettings>): void {
    this.settings = { ...this.settings, ...patch };
  }

  /** Edges currently drawn (0 when the structure has no cell). */
  get edgeCount(): number {
    const attr = this.lines?.geometry.getAttribute('position');
    return attr ? attr.count / 2 : 0;
  }

  update(ctx: LayerContext): void {
    const cell = ctx.cellOverride ?? ctx.structure.cell?.vectors ?? null;
    const key = JSON.stringify([cell, this.settings]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.clear();
    if (!cell) return;
    this.build(cell);
  }

  private build(cell: Mat3): void {
    const positions = cellEdgePositions(cell, this.settings.repeat);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    this.material.color.set(this.settings.color);
    this.lines = new LineSegments(geometry, this.material);
    this.lines.frustumCulled = false;
    this.object.add(this.lines);
    if (!this.settings.showLabels) return;
    const color = `#${this.settings.color.toString(16).padStart(6, '0')}`;
    (['a', 'b', 'c'] as const).forEach((name, i) => {
      const v = cell[i]!;
      const sprite = makeTextSprite(name, color);
      if (!sprite) return;
      sprite.position.set(v[0] * 1.05, v[1] * 1.05, v[2] * 1.05);
      this.labels.push(sprite);
      this.object.add(sprite);
    });
  }

  private clear(): void {
    if (this.lines) {
      this.object.remove(this.lines);
      this.lines.geometry.dispose();
      this.lines = null;
    }
    for (const s of this.labels) {
      this.object.remove(s);
      disposeSprite(s);
    }
    this.labels = [];
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
  }
}
