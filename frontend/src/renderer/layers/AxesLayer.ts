/**
 * Cartesian axes: either a gizmo in the lower-left corner (own tiny scene rendered after the main
 * pass, following the main camera's orientation) or axes of fixed length at the world origin.
 * Avogadro 1 "Axes engine" / "Display Axes" equivalents.
 */
import {
  Camera,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Scene,
  Sprite,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { arrowMatrices } from '../arrow';
import { disposeSprite, makeTextSprite } from '../textSprite';
import { DEFAULT_AXES_VECTORS, resolveAxes, type AxesType } from '../../model/axes';
import type { Vec3 } from '../../model/structure';
import type { DisplayLayer } from './Layer';

export type AxesMode = 'corner' | 'origin';

export interface AxesLayerSettings {
  mode: AxesMode;
  /** corner gizmo size in CSS pixels */
  size: number;
  /** axis length in Å for the origin mode, and for the Cartesian axes type */
  length: number;
  /**
   * Avogadro's `axesType`: Cartesian (the unit axes at `length`), Orthogonal (the first vector
   * with the other two derived from it) or Custom (all three as entered). Only the origin mode
   * uses it -- the corner gizmo is an orientation indicator, so it is always Cartesian.
   */
  axesType: AxesType;
  /** where the axes are drawn from, Avogadro's `m_origin` */
  origin: Vec3;
  /** the three vectors, used by the Orthogonal and Custom types */
  vectors: [Vec3, Vec3, Vec3];
}

export const DEFAULT_AXES_SETTINGS: AxesLayerSettings = {
  mode: 'corner',
  size: 84,
  length: 2,
  axesType: DEFAULT_AXES_VECTORS.type,
  origin: [0, 0, 0],
  vectors: DEFAULT_AXES_VECTORS.vectors,
};

const AXES: readonly { name: string; color: number; dir: [number, number, number] }[] = [
  { name: 'x', color: 0xe53935, dir: [1, 0, 0] },
  { name: 'y', color: 0x43a047, dir: [0, 1, 0] },
  { name: 'z', color: 0x1e88e5, dir: [0, 0, 1] },
];

const MARGIN = 8;

export class AxesLayer implements DisplayLayer {
  readonly id = 'axes';
  /** Axes at the world origin (visible only in 'origin' mode). */
  readonly object = new Group();
  visible = true;
  settings: AxesLayerSettings;

  private readonly gizmoScene = new Scene();
  private readonly gizmoCamera = new OrthographicCamera(-1.4, 1.4, 1.4, -1.4, 0.1, 20);
  private readonly gizmo: Group;
  /** The axes at the world origin; rebuilt when the vectors change, so not readonly. */
  private origin: Group;
  private readonly geometries = [new CylinderGeometry(1, 1, 1, 10, 1), new ConeGeometry(1, 1, 12)];
  private readonly materials: MeshBasicMaterial[] = [];
  private readonly size = new Vector2();

  constructor(settings: Partial<AxesLayerSettings> = {}) {
    this.settings = { ...DEFAULT_AXES_SETTINGS, ...settings };
    this.gizmo = this.buildAxes(1, 0.04);
    this.gizmoScene.add(this.gizmo);
    this.origin = this.buildAxes(this.axisVectors(), 0.03);
    this.object.add(this.origin);
    this.applyMode();
  }

  /** The three vectors the origin axes are drawn along, from the type and the entered ones. */
  private axisVectors(): [Vec3, Vec3, Vec3] {
    return resolveAxes({
      type: this.settings.axesType,
      length: this.settings.length,
      vectors: this.settings.vectors,
    });
  }

  setSettings(patch: Partial<AxesLayerSettings>): void {
    const before = JSON.stringify([
      this.settings.length,
      this.settings.axesType,
      this.settings.vectors,
    ]);
    this.settings = { ...this.settings, ...patch };
    const after = JSON.stringify([
      this.settings.length,
      this.settings.axesType,
      this.settings.vectors,
    ]);
    if (before !== after) {
      // arbitrary vectors cannot be a uniform scale of the unit axes, so rebuild rather than scale
      this.object.remove(this.origin);
      this.disposeGroup(this.origin);
      this.origin = this.buildAxes(this.axisVectors(), 0.03);
      this.object.add(this.origin);
    }
    this.origin.position.set(...this.settings.origin);
    this.applyMode();
  }

  update(): void {
    /* nothing depends on the structure */
  }

  private applyMode(): void {
    this.origin.visible = this.settings.mode === 'origin';
  }

  private buildAxes(vectors: [Vec3, Vec3, Vec3] | number, radius: number): Group {
    // a number is the Cartesian case, which is what the corner gizmo always wants
    const along: [Vec3, Vec3, Vec3] =
      typeof vectors === 'number'
        ? [
            [vectors, 0, 0],
            [0, vectors, 0],
            [0, 0, vectors],
          ]
        : vectors;
    const group = new Group();
    const origin = new Vector3();
    const v = new Vector3();
    const ms = new Matrix4();
    const mh = new Matrix4();
    const [cylinder, cone] = this.geometries as [CylinderGeometry, ConeGeometry];
    AXES.forEach((axis, index) => {
      const material = new MeshBasicMaterial({ color: axis.color });
      this.materials.push(material);
      v.set(...along[index]!);
      const length = v.length() || 1;
      arrowMatrices(
        origin,
        v,
        { shaftRadius: radius, headRadius: radius * 3, headLength: length * 0.25 },
        0,
        ms,
        mh,
      );
      const shaft = new Mesh(cylinder, material);
      shaft.applyMatrix4(ms);
      const head = new Mesh(cone, material);
      head.applyMatrix4(mh);
      group.add(shaft, head);
      const label = makeTextSprite(axis.name, `#${axis.color.toString(16).padStart(6, '0')}`, 0.5);
      if (label) {
        label.position.copy(v).multiplyScalar(1.25);
        group.add(label);
      }
    });
    return group;
  }

  /** Free the meshes and sprites of a rebuilt group; the geometries are shared and stay. */
  private disposeGroup(group: Group): void {
    for (const child of group.children) {
      const sprite = child as { material?: { map?: { dispose(): void }; dispose?: () => void } };
      if (sprite.material?.map) sprite.material.map.dispose();
      if (sprite.material?.dispose) sprite.material.dispose();
    }
    group.clear();
  }

  renderOverlay(gl: WebGLRenderer, camera: Camera): void {
    if (this.settings.mode !== 'corner') return;
    gl.getSize(this.size);
    const px = this.settings.size;
    this.gizmoCamera.quaternion.copy(camera.quaternion);
    this.gizmoCamera.position.set(0, 0, 1).applyQuaternion(camera.quaternion).multiplyScalar(5);
    gl.autoClear = false;
    gl.setScissorTest(true);
    gl.setViewport(MARGIN, MARGIN, px, px);
    gl.setScissor(MARGIN, MARGIN, px, px);
    gl.clearDepth();
    gl.render(this.gizmoScene, this.gizmoCamera);
    gl.setScissorTest(false);
    gl.setViewport(0, 0, this.size.x, this.size.y);
    gl.autoClear = true;
  }

  dispose(): void {
    for (const group of [this.gizmo, this.origin])
      group.traverse((o) => {
        if (o instanceof Sprite) disposeSprite(o);
      });
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
