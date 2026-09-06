/**
 * The molecular dipole moment as one arrow through the molecule (Avogadro's Dipole engine,
 * engines/dipoleengine.cpp).
 *
 * The vector is recomputed from the partial charges and the current positions on every rebuild
 * (`model/dipole.ts`), so it cannot disagree with the charges shown beside it in the Properties
 * tab. No charges, no arrow.
 *
 * Two differences from the reference. It is anchored at the centroid of the molecule, where
 * Avogadro anchored at the world origin with three spin boxes to move it -- an arrow drawn from
 * (0,0,0) misses a molecule that was read from a file with an offset. And Avogadro's second
 * dipole "type", a custom vector typed into the settings widget, is not offered: it drew an
 * arbitrary arrow, which is not a property of the molecule.
 */
import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { dipoleFromCharges } from '../../model/dipole';
import type { StructureDoc } from '../../model/structure';
import { arrowMatrices } from '../arrow';
import type { DisplayLayer, LayerContext } from './Layer';

export interface DipoleLayerSettings {
  /**
   * Å per Debye. Avogadro drew the arrow three times the dipole (`3*m_dipole` in renderOpaque),
   * which for a small molecule reaches well outside the view the camera fits to the atoms; one
   * Ångström per Debye is about the size of the molecule it belongs to, and the slider reaches
   * the reference's 3.
   */
  scale: number;
  color: number;
  radius: number;
}

export const DEFAULT_DIPOLE_SETTINGS: DipoleLayerSettings = {
  scale: 1,
  color: 0xd0342c,
  radius: 0.06,
};

export class DipoleLayer implements DisplayLayer {
  readonly id = 'dipole';
  readonly object = new Group();
  visible = false;
  settings: DipoleLayerSettings;

  private readonly shaft: Mesh;
  private readonly head: Mesh;
  private readonly material = new MeshStandardMaterial({ roughness: 0.6, metalness: 0.0 });
  private lastKey = '';
  private lastStructure: StructureDoc | null = null;
  private lastOverride: Float32Array | null | undefined;

  constructor(settings: Partial<DipoleLayerSettings> = {}) {
    this.settings = { ...DEFAULT_DIPOLE_SETTINGS, ...settings };
    this.shaft = new Mesh(new CylinderGeometry(1, 1, 1, 12, 1, true), this.material);
    this.head = new Mesh(new ConeGeometry(1, 1, 16, 1), this.material);
    for (const mesh of [this.shaft, this.head]) {
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      this.object.add(mesh);
    }
  }

  setSettings(patch: Partial<DipoleLayerSettings>): void {
    this.settings = { ...this.settings, ...patch };
  }

  /** Whether an arrow is currently drawn; false when the structure carries no charges. */
  get drawn(): boolean {
    return this.shaft.visible;
  }

  update(ctx: LayerContext): void {
    const key = JSON.stringify(this.settings) + ctx.revision;
    const override = ctx.positionsOverride ?? null;
    if (
      key === this.lastKey &&
      ctx.structure === this.lastStructure &&
      override === this.lastOverride
    )
      return;
    this.lastKey = key;
    this.lastStructure = ctx.structure;
    this.lastOverride = override;
    this.material.color = new Color(this.settings.color);

    // the frame's geometry when one is playing, so this arrow and the per-atom ones agree about
    // where the atoms are. Hidden atoms are summed over all the same: scoping the picture does
    // not change the molecule's dipole, where a per-atom arrow on a hidden atom has nothing to
    // point from.
    const dipole = dipoleFromCharges(ctx.structure, override);
    if (!dipole || dipole.magnitude === 0) {
      this.shaft.visible = false;
      this.head.visible = false;
      return;
    }
    const { scale, radius } = this.settings;
    const vector = new Vector3(...dipole.vector).multiplyScalar(scale);
    // Avogadro's proportions: a thin shaft to 80% of the length, then a cone eight times as wide
    // as the shaft (drawCylinder(.., 0.05); drawCone(.., 0.4) in renderOpaque)
    const dims = {
      shaftRadius: radius,
      headRadius: radius * 8,
      headLength: vector.length() * 0.2,
    };
    const shaft = new Matrix4();
    const head = new Matrix4();
    arrowMatrices(new Vector3(...dipole.origin), vector, dims, 0, shaft, head);
    this.shaft.matrix.copy(shaft);
    this.head.matrix.copy(head);
    this.shaft.visible = true;
    this.head.visible = true;
  }

  dispose(): void {
    for (const mesh of [this.shaft, this.head]) {
      mesh.geometry.dispose();
      this.object.remove(mesh);
    }
    this.material.dispose();
  }
}
