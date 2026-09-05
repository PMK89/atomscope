/**
 * Per-atom vectors (forces, velocities, mode displacements) as arrows: one instanced cylinder mesh
 * for shafts and one instanced cone mesh for heads. Avogadro 1 "Force engine" equivalent.
 */
import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import type { StructureDoc } from '../../model/structure';
import { arrowMatrices } from '../arrow';
import { sameHidden } from '../atomStyles';
import type { DisplayLayer, LayerContext } from './Layer';

export interface VectorLayerSettings {
  /** key into structure.atomic_vectors, e.g. 'forces' */
  field: string;
  /** Å per vector unit */
  scale: number;
  color: number;
  /** arrows shorter than this (Å, after scaling) are hidden */
  minLength: number;
  radius: number;
}

export const DEFAULT_VECTOR_SETTINGS: VectorLayerSettings = {
  field: 'forces',
  scale: 1,
  color: 0xd0342c,
  minLength: 0.05,
  radius: 0.06,
};

export class VectorLayer implements DisplayLayer {
  readonly id = 'vectors';
  readonly object = new Group();
  visible = true;
  settings: VectorLayerSettings;

  private shafts: InstancedMesh | null = null;
  private heads: InstancedMesh | null = null;
  private capacity = 0;
  private readonly shaftGeometry = new CylinderGeometry(1, 1, 1, 12, 1, true);
  private readonly headGeometry = new ConeGeometry(1, 1, 16, 1);
  private readonly material = new MeshStandardMaterial({ roughness: 0.6, metalness: 0.0 });
  private lastKey = '';
  private lastStructure: StructureDoc | null = null;
  private lastOverride: Float32Array | null | undefined;
  /** Atoms no engine draws; an arrow on one of them is not drawn either. */
  private hidden: ReadonlySet<number> | null = null;
  private lastHidden: ReadonlySet<number> | null = null;

  constructor(settings: Partial<VectorLayerSettings> = {}) {
    this.settings = { ...DEFAULT_VECTOR_SETTINGS, ...settings };
  }

  setSettings(patch: Partial<VectorLayerSettings>): void {
    this.settings = { ...this.settings, ...patch };
  }

  /**
   * The atoms display scoping hides. Kept out of `settings` because a Set does not survive the
   * `JSON.stringify` the cache key uses -- every set would compare equal to every other.
   */
  setHidden(hidden: ReadonlySet<number> | null): void {
    this.hidden = hidden;
  }

  /** Number of arrows currently drawn. */
  get count(): number {
    return this.shafts?.count ?? 0;
  }

  update(ctx: LayerContext): void {
    const key = JSON.stringify(this.settings) + ctx.revision;
    const override = ctx.positionsOverride ?? null;
    if (
      key === this.lastKey &&
      ctx.structure === this.lastStructure &&
      override === this.lastOverride &&
      sameHidden(this.hidden, this.lastHidden)
    )
      return;
    this.lastKey = key;
    this.lastStructure = ctx.structure;
    this.lastOverride = override;
    this.lastHidden = this.hidden;
    this.rebuild(ctx.structure, override);
  }

  private ensureCapacity(n: number): void {
    if (this.shafts && this.heads && n <= this.capacity) return;
    this.disposeMeshes();
    this.capacity = Math.max(n, 1);
    this.shafts = new InstancedMesh(this.shaftGeometry, this.material, this.capacity);
    this.heads = new InstancedMesh(this.headGeometry, this.material, this.capacity);
    for (const mesh of [this.shafts, this.heads]) {
      mesh.frustumCulled = false;
      this.object.add(mesh);
    }
  }

  private rebuild(s: StructureDoc, override: Float32Array | null): void {
    const vectors = s.atomic_vectors[this.settings.field]?.values;
    const n = vectors && vectors.length === s.atoms.length ? vectors.length : 0;
    this.ensureCapacity(n);
    const shafts = this.shafts!;
    const heads = this.heads!;
    const { scale, radius, minLength } = this.settings;
    const dims = { shaftRadius: radius, headRadius: radius * 2.2, headLength: radius * 5 };
    const origin = new Vector3();
    const v = new Vector3();
    const ms = new Matrix4();
    const mh = new Matrix4();
    const color = new Color(this.settings.color);
    const usable = override && override.length === s.atoms.length * 3 ? override : null;
    let k = 0;
    for (let i = 0; i < n; i++) {
      if (this.hidden?.has(i)) continue;
      const vec = vectors![i]!;
      v.set(vec[0] * scale, vec[1] * scale, vec[2] * scale);
      if (v.length() < minLength) continue;
      if (usable) origin.set(usable[3 * i]!, usable[3 * i + 1]!, usable[3 * i + 2]!);
      else {
        const p = s.atoms[i]!.position;
        origin.set(p[0], p[1], p[2]);
      }
      arrowMatrices(origin, v, dims, minLength, ms, mh);
      shafts.setMatrixAt(k, ms);
      heads.setMatrixAt(k, mh);
      shafts.setColorAt(k, color);
      heads.setColorAt(k, color);
      k++;
    }
    shafts.count = k;
    heads.count = k;
    for (const mesh of [shafts, heads]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private disposeMeshes(): void {
    for (const mesh of [this.shafts, this.heads]) {
      if (!mesh) continue;
      this.object.remove(mesh);
      mesh.dispose();
    }
    this.shafts = null;
    this.heads = null;
    this.capacity = 0;
  }

  dispose(): void {
    this.disposeMeshes();
    this.shaftGeometry.dispose();
    this.headGeometry.dispose();
    this.material.dispose();
  }
}
