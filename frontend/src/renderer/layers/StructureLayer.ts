/**
 * Atoms as instanced spheres, bonds as instanced cylinders. One draw call per mesh regardless of
 * atom count. Supports ball-and-stick, stick, van der Waals and wireframe-like (thin) styles.
 */
import {
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from 'three';
import { elementBySymbol } from '../../model/elements';
import type { StructureDoc } from '../../model/structure';
import { cylinderMatrix } from '../math';
import type { DisplayLayer, LayerContext } from './Layer';

export type StructureStyle = 'ball-and-stick' | 'stick' | 'vdw' | 'wireframe';

export interface StructureLayerSettings {
  style: StructureStyle;
  /** Fraction of the covalent radius used for ball-and-stick spheres. */
  atomScale: number;
  /** Fraction of the vdW radius used for the vdw style. */
  vdwScale: number;
  bondRadius: number;
  showHydrogens: boolean;
}

export const DEFAULT_STRUCTURE_SETTINGS: StructureLayerSettings = {
  style: 'ball-and-stick',
  atomScale: 0.35,
  vdwScale: 1.0,
  bondRadius: 0.12,
  showHydrogens: true,
};

const SELECTION_COLOR = new Color(0.2, 0.6, 1.0);
const HOVER_COLOR = new Color(1.0, 0.85, 0.2);

export class StructureLayer implements DisplayLayer {
  readonly id = 'structure';
  readonly object = new Group();
  visible = true;
  settings: StructureLayerSettings;

  private atomMesh: InstancedMesh | null = null;
  private bondMesh: InstancedMesh | null = null;
  private readonly sphereGeometry = new SphereGeometry(1, 32, 24);
  private readonly cylinderGeometry = new CylinderGeometry(1, 1, 1, 24, 1, true);
  private readonly material = new MeshStandardMaterial({ roughness: 0.55, metalness: 0.0 });
  private lastRevision = -1;
  private lastSettings: string = '';
  /** instance index -> atom index (hidden hydrogens are skipped) */
  private atomOfInstance: number[] = [];
  private instanceOfAtom: Int32Array = new Int32Array(0);
  /** per instance sphere radius, cached so per-frame position updates skip element lookups */
  private instanceRadius: Float32Array = new Float32Array(0);
  private lastOverride: Float32Array | null = null;
  private lastSelected: ReadonlySet<number> | null = null;
  private lastHovered: number | null = null;
  private lastStructure: StructureDoc | null = null;

  constructor(settings: Partial<StructureLayerSettings> = {}) {
    this.settings = { ...DEFAULT_STRUCTURE_SETTINGS, ...settings };
  }

  setSettings(patch: Partial<StructureLayerSettings>): void {
    this.settings = { ...this.settings, ...patch };
  }

  /** Atom index for an intersected instance of the atom mesh, or null. */
  atomIndexForInstance(mesh: Object3D, instanceId: number | undefined): number | null {
    if (mesh !== this.atomMesh || instanceId === undefined) return null;
    return this.atomOfInstance[instanceId] ?? null;
  }

  get pickables(): Object3D[] {
    return this.atomMesh ? [this.atomMesh] : [];
  }

  update(ctx: LayerContext): void {
    const settingsKey = JSON.stringify(this.settings);
    const geometryChanged = ctx.revision !== this.lastRevision || settingsKey !== this.lastSettings;
    if (geometryChanged) {
      this.rebuild(ctx.structure);
      this.lastRevision = ctx.revision;
      this.lastSettings = settingsKey;
    }
    // display-only positions (trajectory frame): update instance matrices, keep topology
    const raw = ctx.positionsOverride ?? null;
    const override = raw && raw.length === ctx.structure.atoms.length * 3 ? raw : null;
    if (geometryChanged || override !== this.lastOverride) {
      this.applyPositions(ctx.structure, override);
      this.lastOverride = override;
    }
    if (
      geometryChanged ||
      ctx.structure !== this.lastStructure ||
      ctx.selectedAtoms !== this.lastSelected ||
      ctx.hoveredAtom !== this.lastHovered
    ) {
      this.applyColors(ctx);
      this.lastStructure = ctx.structure;
      this.lastSelected = ctx.selectedAtoms;
      this.lastHovered = ctx.hoveredAtom;
    }
  }

  /** Write atom and bond instance matrices from `override` (3 floats per atom) or the structure. */
  private applyPositions(s: StructureDoc, override: Float32Array | null): void {
    const m = new Matrix4();
    const a = new Vector3();
    const b = new Vector3();
    const mid = new Vector3();
    const read = (atomIndex: number, out: Vector3): Vector3 => {
      if (override) {
        return out.set(
          override[3 * atomIndex]!,
          override[3 * atomIndex + 1]!,
          override[3 * atomIndex + 2]!,
        );
      }
      const p = s.atoms[atomIndex]!.position;
      return out.set(p[0], p[1], p[2]);
    };
    if (this.atomMesh) {
      for (let k = 0; k < this.atomOfInstance.length; k++) {
        const r = this.instanceRadius[k]!;
        m.makeScale(r, r, r).setPosition(read(this.atomOfInstance[k]!, a));
        this.atomMesh.setMatrixAt(k, m);
      }
      this.atomMesh.instanceMatrix.needsUpdate = true;
    }
    if (this.bondMesh) {
      const radius =
        this.settings.style === 'wireframe'
          ? this.settings.bondRadius * 0.35
          : this.settings.bondRadius;
      this.bondMeshBonds.forEach((bond, k) => {
        read(bond.a, a);
        read(bond.b, b);
        mid.addVectors(a, b).multiplyScalar(0.5);
        this.bondMesh!.setMatrixAt(2 * k, cylinderMatrix(a, mid, radius, m));
        this.bondMesh!.setMatrixAt(2 * k + 1, cylinderMatrix(mid, b, radius, m));
      });
      this.bondMesh.instanceMatrix.needsUpdate = true;
    }
  }

  private rebuild(s: StructureDoc): void {
    this.disposeMeshes();
    const { style, showHydrogens } = this.settings;
    const visibleAtoms: number[] = [];
    this.instanceOfAtom = new Int32Array(s.atoms.length).fill(-1);
    s.atoms.forEach((a, i) => {
      if (!showHydrogens && a.element === 'H') return;
      this.instanceOfAtom[i] = visibleAtoms.length;
      visibleAtoms.push(i);
    });
    this.atomOfInstance = visibleAtoms;

    // atoms
    const atomMesh = new InstancedMesh(this.sphereGeometry, this.material, visibleAtoms.length);
    this.instanceRadius = new Float32Array(visibleAtoms.length);
    visibleAtoms.forEach((atomIndex, k) => {
      const el = elementBySymbol(s.atoms[atomIndex]!.element);
      this.instanceRadius[k] = this.atomRadius(el.covalentRadius, el.vdwRadius, style);
    });
    atomMesh.frustumCulled = false;
    this.atomMesh = atomMesh;
    this.object.add(atomMesh);

    // bonds: split each bond into two half-cylinders colored by their atom
    if (style !== 'vdw') {
      const bonds = s.bonds.filter(
        (b) => this.instanceOfAtom[b.a]! >= 0 && this.instanceOfAtom[b.b]! >= 0,
      );
      const bondMesh = new InstancedMesh(this.cylinderGeometry, this.material, bonds.length * 2);
      bondMesh.frustumCulled = false;
      this.bondMesh = bondMesh;
      this.bondMeshBonds = bonds;
      this.object.add(bondMesh);
    }
  }

  private bondMeshBonds: StructureDoc['bonds'] = [];

  private atomRadius(covalent: number, vdw: number, style: StructureStyle): number {
    switch (style) {
      case 'vdw':
        return (Number.isNaN(vdw) ? covalent * 2 : vdw) * this.settings.vdwScale;
      case 'stick':
        return this.settings.bondRadius;
      case 'wireframe':
        return this.settings.bondRadius * 0.35;
      default:
        return Math.max(covalent * this.settings.atomScale, this.settings.bondRadius * 1.05);
    }
  }

  private applyColors(ctx: LayerContext): void {
    const s = ctx.structure;
    const color = new Color();
    if (this.atomMesh) {
      this.atomOfInstance.forEach((atomIndex, k) => {
        const el = elementBySymbol(s.atoms[atomIndex]!.element);
        color.setRGB(el.color[0], el.color[1], el.color[2]);
        if (ctx.selectedAtoms.has(atomIndex)) color.lerp(SELECTION_COLOR, 0.6);
        if (ctx.hoveredAtom === atomIndex) color.lerp(HOVER_COLOR, 0.5);
        this.atomMesh!.setColorAt(k, color);
      });
      if (this.atomMesh.instanceColor) this.atomMesh.instanceColor.needsUpdate = true;
    }
    if (this.bondMesh) {
      this.bondMeshBonds.forEach((bond, k) => {
        for (const [half, atomIndex] of [
          [2 * k, bond.a],
          [2 * k + 1, bond.b],
        ] as const) {
          const el = elementBySymbol(s.atoms[atomIndex]!.element);
          color.setRGB(el.color[0], el.color[1], el.color[2]);
          if (this.settings.style === 'stick' || this.settings.style === 'wireframe') {
            if (ctx.selectedAtoms.has(atomIndex)) color.lerp(SELECTION_COLOR, 0.6);
          }
          this.bondMesh!.setColorAt(half, color);
        }
      });
      if (this.bondMesh.instanceColor) this.bondMesh.instanceColor.needsUpdate = true;
    }
  }

  private disposeMeshes(): void {
    for (const mesh of [this.atomMesh, this.bondMesh]) {
      if (!mesh) continue;
      this.object.remove(mesh);
      mesh.dispose();
    }
    this.atomMesh = null;
    this.bondMesh = null;
    this.bondMeshBonds = [];
  }

  dispose(): void {
    this.disposeMeshes();
    this.sphereGeometry.dispose();
    this.cylinderGeometry.dispose();
    this.material.dispose();
  }
}
