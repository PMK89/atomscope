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
  /**
   * Style for the selected atoms, when they should be drawn differently from the rest (Avogadro
   * restricts an engine to a set of primitives; this is the same effect with one engine). Null
   * draws everything in `style`, which is also the fast path: the selection then never rebuilds
   * the meshes.
   */
  selectionStyle: StructureStyle | null;
}

export const DEFAULT_STRUCTURE_SETTINGS: StructureLayerSettings = {
  style: 'ball-and-stick',
  atomScale: 0.35,
  vdwScale: 1.0,
  bondRadius: 0.12,
  showHydrogens: true,
  selectionStyle: null,
};

/** [sphere segments, sphere rings, cylinder sides] from coarse to fine. */
const DETAIL_LEVELS: [number, number, number][] = [
  [8, 6, 6],
  [16, 12, 12],
  [32, 24, 24],
];

const SELECTION_COLOR = new Color(0.2, 0.6, 1.0);
const HOVER_COLOR = new Color(1.0, 0.85, 0.2);

export class StructureLayer implements DisplayLayer {
  readonly id = 'structure';
  readonly object = new Group();
  visible = true;
  settings: StructureLayerSettings;

  private atomMesh: InstancedMesh | null = null;
  private bondMesh: InstancedMesh | null = null;
  /** Tessellation actually in use, chosen from the atom count by `detailFor`. */
  private readonly geometries = new Map<
    number,
    { sphere: SphereGeometry; cylinder: CylinderGeometry }
  >();
  private readonly material = new MeshStandardMaterial({ roughness: 0.55, metalness: 0.0 });
  private lastSettings: string = '';
  /** Atom and bond arrays of the last update: immutable, so identity answers "did it change?". */
  private lastAtoms: StructureDoc['atoms'] | null = null;
  private lastBonds: StructureDoc['bonds'] | null = null;
  /** instance index -> atom index (hidden hydrogens are skipped) */
  private atomOfInstance: number[] = [];
  private instanceOfAtom: Int32Array = new Int32Array(0);
  /** per instance sphere radius, cached so per-frame position updates skip element lookups */
  private instanceRadius: Float32Array = new Float32Array(0);
  /** per bond half-cylinder radius, which differs when the selection has its own style */
  private bondRadii: Float32Array = new Float32Array(0);
  private lastOverride: Float32Array | null = null;
  private lastSelected: ReadonlySet<number> | null = null;
  private lastHovered: number | null = null;

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

  /** Index into `structure.bonds` for an intersected instance of the bond mesh, or null. */
  bondIndexForInstance(mesh: Object3D, instanceId: number | undefined): number | null {
    if (mesh !== this.bondMesh || instanceId === undefined) return null;
    return this.bondMeshBondIndices[Math.floor(instanceId / 2)] ?? null;
  }

  /** True when `obj` is the atom mesh (as opposed to the bond mesh). */
  isAtomMesh(obj: Object3D): boolean {
    return obj === this.atomMesh;
  }

  get pickables(): Object3D[] {
    const out: Object3D[] = [];
    if (this.atomMesh) out.push(this.atomMesh);
    if (this.bondMesh) out.push(this.bondMesh);
    return out;
  }

  /**
   * Whether the instanced meshes have to be rebuilt: only a changed atom count, element sequence
   * or bond list does that. Moving atoms (drag previews, trajectory playback) does not, so those
   * updates only rewrite instance matrices.
   */
  private topologyChanged(s: StructureDoc): boolean {
    if (s.bonds !== this.lastBonds) return true;
    const prev = this.lastAtoms;
    if (!prev || prev.length !== s.atoms.length) return true;
    if (prev === s.atoms) return false;
    for (let i = 0; i < s.atoms.length; i++) {
      if (prev[i]!.element !== s.atoms[i]!.element) return true;
    }
    return false;
  }

  update(ctx: LayerContext): void {
    const s = ctx.structure;
    const settingsKey = JSON.stringify(this.settings);
    // the selection only changes what is drawn when it has a style of its own
    const selectionChanged =
      this.settings.selectionStyle !== null && ctx.selectedAtoms !== this.lastSelected;
    const rebuilt =
      settingsKey !== this.lastSettings || this.topologyChanged(s) || selectionChanged;
    const moved = s.atoms !== this.lastAtoms;
    this.lastAtoms = s.atoms;
    this.lastBonds = s.bonds;
    if (rebuilt) {
      this.rebuild(s, ctx.selectedAtoms);
      this.lastSettings = settingsKey;
    }
    // display-only positions (trajectory frame): update instance matrices, keep topology
    const raw = ctx.positionsOverride ?? null;
    const override = raw && raw.length === s.atoms.length * 3 ? raw : null;
    if (rebuilt || moved || override !== this.lastOverride) {
      this.applyPositions(s, override);
      this.lastOverride = override;
    }
    // colours depend on the element sequence (a rebuild), the selection and the hover only
    if (
      rebuilt ||
      ctx.selectedAtoms !== this.lastSelected ||
      ctx.hoveredAtom !== this.lastHovered
    ) {
      this.applyColors(ctx);
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
      this.bondMeshBonds.forEach((bond, k) => {
        const radius = this.bondRadii[k]!;
        read(bond.a, a);
        read(bond.b, b);
        mid.addVectors(a, b).multiplyScalar(0.5);
        this.bondMesh!.setMatrixAt(2 * k, cylinderMatrix(a, mid, radius, m));
        this.bondMesh!.setMatrixAt(2 * k + 1, cylinderMatrix(mid, b, radius, m));
      });
      this.bondMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** The style an atom is drawn with: its own when the selection has one, the layer's otherwise. */
  private styleOf(atomIndex: number, selected: ReadonlySet<number>): StructureStyle {
    const { style, selectionStyle } = this.settings;
    return selectionStyle !== null && selected.has(atomIndex) ? selectionStyle : style;
  }

  private rebuild(s: StructureDoc, selected: ReadonlySet<number>): void {
    this.disposeMeshes();
    const { showHydrogens } = this.settings;
    const visibleAtoms: number[] = [];
    this.instanceOfAtom = new Int32Array(s.atoms.length).fill(-1);
    s.atoms.forEach((a, i) => {
      if (!showHydrogens && a.element === 'H') return;
      this.instanceOfAtom[i] = visibleAtoms.length;
      visibleAtoms.push(i);
    });
    this.atomOfInstance = visibleAtoms;

    // atoms
    const { sphere, cylinder } = this.geometryFor(visibleAtoms.length);
    const atomMesh = new InstancedMesh(sphere, this.material, visibleAtoms.length);
    this.instanceRadius = new Float32Array(visibleAtoms.length);
    visibleAtoms.forEach((atomIndex, k) => {
      const el = elementBySymbol(s.atoms[atomIndex]!.element);
      const atomStyle = this.styleOf(atomIndex, selected);
      this.instanceRadius[k] = this.atomRadius(el.covalentRadius, el.vdwRadius, atomStyle);
    });
    atomMesh.frustumCulled = false;
    this.atomMesh = atomMesh;
    this.object.add(atomMesh);

    // bonds: split each bond into two half-cylinders colored by their atom. A van der Waals atom
    // draws no bonds, so a bond is drawn only where neither of its atoms is one.
    const bondIndices: number[] = [];
    const radii: number[] = [];
    const bonds = s.bonds.filter((b, i) => {
      if (this.instanceOfAtom[b.a]! < 0 || this.instanceOfAtom[b.b]! < 0) return false;
      const styleA = this.styleOf(b.a, selected);
      const styleB = this.styleOf(b.b, selected);
      if (styleA === 'vdw' || styleB === 'vdw') return false;
      bondIndices.push(i);
      radii.push(
        styleA === 'wireframe' || styleB === 'wireframe'
          ? this.settings.bondRadius * 0.35
          : this.settings.bondRadius,
      );
      return true;
    });
    this.bondMeshBondIndices = bondIndices;
    this.bondRadii = new Float32Array(radii);
    if (bonds.length) {
      const bondMesh = new InstancedMesh(cylinder, this.material, bonds.length * 2);
      bondMesh.frustumCulled = false;
      this.bondMesh = bondMesh;
      this.bondMeshBonds = bonds;
      this.object.add(bondMesh);
    }
  }

  /**
   * Sphere segments for `count` atoms. A 32x24 sphere is 1472 triangles: at 100k atoms that is
   * 157 M triangles per frame and the viewport drops below a frame per second, while the same
   * scene at 8x6 renders 5-7 times faster and is indistinguishable at the size one atom occupies
   * when a hundred thousand of them are on screen (measured, see docs/performance.md).
   */
  private geometryFor(count: number): { sphere: SphereGeometry; cylinder: CylinderGeometry } {
    const detail = count > 20_000 ? 0 : count > 2_000 ? 1 : 2;
    let entry = this.geometries.get(detail);
    if (!entry) {
      const [segments, rings, sides] = DETAIL_LEVELS[detail]!;
      entry = {
        sphere: new SphereGeometry(1, segments, rings),
        cylinder: new CylinderGeometry(1, 1, 1, sides, 1, true),
      };
      this.geometries.set(detail, entry);
    }
    return entry;
  }

  private bondMeshBonds: StructureDoc['bonds'] = [];
  /** original bond index for each entry of bondMeshBonds */
  private bondMeshBondIndices: number[] = [];

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
          // a stick or wireframe atom is only visible through its bonds, so tint them instead
          const atomStyle = this.styleOf(atomIndex, ctx.selectedAtoms);
          if (atomStyle === 'stick' || atomStyle === 'wireframe') {
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
    for (const { sphere, cylinder } of this.geometries.values()) {
      sphere.dispose();
      cylinder.dispose();
    }
    this.geometries.clear();
    this.material.dispose();
  }
}
