/**
 * Hydrogen bonds as dashed sticks (Avogadro's Hydrogen Bond engine: cut-off radius, cut-off angle,
 * width).
 *
 * WebGL ignores line width, so a dash is a short cylinder rather than a line segment: the width
 * setting then does what it says. The bonds are recomputed from the displayed positions, which is
 * what makes them appear and disappear along a trajectory.
 */
import {
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { DEFAULT_HBOND_SETTINGS, hydrogenBonds, type HBondSettings } from '../../model/hbonds';
import type { Vec3 } from '../../model/structure';
import { cylinderMatrix } from '../math';
import type { DisplayLayer, LayerContext } from './Layer';

export interface HBondLayerSettings extends HBondSettings {
  /** Radius of a dash in Angstrom. */
  width: number;
}

export const DEFAULT_HBOND_LAYER_SETTINGS: HBondLayerSettings = {
  ...DEFAULT_HBOND_SETTINGS,
  width: 0.06,
};

/** Dashes per bond: enough to read as dashed at any length a hydrogen bond has. */
const DASHES = 5;
const COLOR = new Color(0.45, 0.75, 0.95);

export class HBondLayer implements DisplayLayer {
  readonly id = 'hbonds';
  readonly object = new Group();
  visible = false;
  settings: HBondLayerSettings = { ...DEFAULT_HBOND_LAYER_SETTINGS };

  private mesh: InstancedMesh | null = null;
  private geometry: CylinderGeometry | null = null;
  private readonly material = new MeshStandardMaterial({ color: COLOR, roughness: 0.5 });
  private count = 0;
  /** What the last search ran on: a hover changes none of it. */
  private lastInput: { atoms: unknown; override: unknown; settings: string } | null = null;

  setSettings(patch: Partial<HBondLayerSettings>): void {
    this.settings = { ...this.settings, ...patch };
  }

  update(ctx: LayerContext): void {
    if (!this.visible) {
      this.clear();
      return;
    }
    const s = ctx.structure;
    const raw = ctx.positionsOverride ?? null;
    const override = raw && raw.length === s.atoms.length * 3 ? raw : null;
    const at = (i: number): Vec3 =>
      override
        ? [override[3 * i]!, override[3 * i + 1]!, override[3 * i + 2]!]
        : (s.atoms[i]!.position as Vec3);

    const input = { atoms: s.atoms, override, settings: JSON.stringify(this.settings) };
    // the search builds a grid over every polar atom; a pointer move must not pay for it
    if (
      this.lastInput &&
      this.lastInput.atoms === input.atoms &&
      this.lastInput.override === input.override &&
      this.lastInput.settings === input.settings
    ) {
      return;
    }

    const bonds = hydrogenBonds(s, at, this.settings);
    if (bonds.length !== this.count) {
      this.clear();
      this.count = bonds.length;
      if (!bonds.length) return;
      this.geometry = new CylinderGeometry(1, 1, 1, 6, 1, true);
      this.mesh = new InstancedMesh(this.geometry, this.material, bonds.length * DASHES);
      this.mesh.frustumCulled = false;
      this.object.add(this.mesh);
    }
    // set after the rebuild, which clears it on the way through
    this.lastInput = input;
    if (!this.mesh) return;

    const m = new Matrix4();
    const from = new Vector3();
    const to = new Vector3();
    bonds.forEach((bond, k) => {
      const h = at(bond.hydrogen);
      const a = at(bond.acceptor);
      for (let d = 0; d < DASHES; d++) {
        // each dash covers the first half of its share of the gap, which is what makes it dashed
        const t0 = d / DASHES;
        const t1 = t0 + 0.5 / DASHES;
        from.set(h[0] + (a[0] - h[0]) * t0, h[1] + (a[1] - h[1]) * t0, h[2] + (a[2] - h[2]) * t0);
        to.set(h[0] + (a[0] - h[0]) * t1, h[1] + (a[1] - h[1]) * t1, h[2] + (a[2] - h[2]) * t1);
        this.mesh!.setMatrixAt(k * DASHES + d, cylinderMatrix(from, to, this.settings.width, m));
      }
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** How many hydrogen bonds are drawn (for tests and for the panel). */
  bonds(): number {
    return this.count;
  }

  private clear(): void {
    this.lastInput = null;
    if (this.mesh) {
      this.object.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = null;
    }
    this.geometry?.dispose();
    this.geometry = null;
    this.count = 0;
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
  }
}
