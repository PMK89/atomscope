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
import { adjacency } from '../../model/connectivity';
import type { Cell, StructureDoc } from '../../model/structure';
import { bondPlaneAxis, cylinderMatrix } from '../math';
import type { DisplayLayer, LayerContext } from './Layer';

export type StructureStyle = 'ball-and-stick' | 'stick' | 'vdw' | 'wireframe';

/** Tessellation override for spheres and cylinders; `auto` picks it from the atom count. */
export type Quality = 'low' | 'auto' | 'high';

export interface StructureLayerSettings {
  style: StructureStyle;
  /** Fraction of the covalent radius used for ball-and-stick spheres. */
  atomScale: number;
  /** Fraction of the vdW radius used for the vdw style. */
  vdwScale: number;
  bondRadius: number;
  showHydrogens: boolean;
  /** Draw double and triple bonds as two or three parallel sticks. */
  multipleBonds: boolean;
  /**
   * Draw this many images of the structure along a, b and c. A repeated unit cell with only one
   * cell of atoms in it says something false about the crystal, so the atoms repeat with the box.
   */
  cellRepeat: [number, number, number];
  /**
   * One RGB triple per atom, replacing the element colours (a residue or chain colour scheme).
   * Null keeps the element colours, which is the default and the only thing a plain molecule
   * has to say.
   */
  atomColors: Float32Array | null;
  /**
   * Tessellation of the spheres and cylinders. `auto` coarsens with the number of atoms, which is
   * what keeps a hundred thousand of them interactive; the other two override that choice.
   */
  quality: Quality;
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
  multipleBonds: true,
  cellRepeat: [1, 1, 1],
  selectionStyle: null,
  atomColors: null,
  quality: 'auto',
};

/** [sphere segments, sphere rings, cylinder sides] from coarse to fine. */
const DETAIL_LEVELS: [number, number, number][] = [
  [8, 6, 6],
  [16, 12, 12],
  [32, 24, 24],
];

/**
 * Largest number of sphere instances a repeat may produce. Above this the tab stops responding
 * long before the picture becomes more informative.
 */
const MAX_INSTANCES = 2_000_000;

/** Centre-to-centre distance between the sticks of a multiple bond, in bond radii. */
const MULTIPLE_BOND_GAP = 2.6;

/** One half-cylinder: which drawn bond it belongs to, which end, and its offset from the axis. */
interface BondHalf {
  bond: number;
  end: 'a' | 'b';
  shift: number;
  /** atom whose direction fixes the plane of a multiple bond, or -1 */
  reference: number;
  /** index into `imageCells`: which periodic image this stick belongs to */
  image: number;
}

const ORIGIN = new Vector3();
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
  /** instance index -> atom index (hidden hydrogens are skipped; images repeat the same atoms) */
  private atomOfInstance: number[] = [];
  /** instance index -> which periodic image it belongs to, as an index into `imageCells` */
  private imageOfInstance: Int32Array = new Int32Array(0);
  /** (i, j, k) of each drawn image; [0,0,0] alone when the structure is not repeated */
  private imageCells: [number, number, number][] = [[0, 0, 0]];
  private instanceOfAtom: Int32Array = new Int32Array(0);
  /** per instance sphere radius, cached so per-frame position updates skip element lookups */
  private instanceRadius: Float32Array = new Float32Array(0);
  /** per bond half-cylinder radius, which differs when the selection has its own style */
  private bondRadii: Float32Array = new Float32Array(0);
  /** One half-cylinder per entry, in instance order (a multiple bond contributes several). */
  private bondHalves: BondHalf[] = [];
  private lastOverride: Float32Array | null = null;
  private lastCell: Cell['vectors'] | null = null;
  /** Whether the last rebuild saw a cell: gaining or losing one changes how many images there are. */
  private lastHadCell = false;
  /** True when the repeat asked for more instances than the budget allows, so the UI can say why. */
  truncated = false;
  private lastSelected: ReadonlySet<number> | null = null;
  private lastHovered: number | null = null;

  constructor(settings: Partial<StructureLayerSettings> = {}) {
    this.settings = { ...DEFAULT_STRUCTURE_SETTINGS, ...settings };
  }

  setSettings(patch: Partial<StructureLayerSettings>): void {
    this.settings = { ...this.settings, ...patch };
  }

  /**
   * Half-extent added by the periodic images, in Angstrom: what the drawn structure spans beyond
   * the atoms themselves. Fitting the camera to the atoms alone would frame one cell of a repeat.
   */
  imageExtent(cell: Cell['vectors'] | null): { center: [number, number, number]; radius: number } {
    const last = this.imageCells[this.imageCells.length - 1];
    if (!cell || !last || this.imageCells.length <= 1) {
      return { center: [0, 0, 0], radius: 0 };
    }
    const span: [number, number, number] = [0, 0, 0];
    for (let axis = 0; axis < 3; axis++) {
      for (let k = 0; k < 3; k++)
        span[k] = (span[k] ?? 0) + (last[axis] ?? 0) * (cell[axis]?.[k] ?? 0);
    }
    return {
      center: [span[0] / 2, span[1] / 2, span[2] / 2],
      radius: Math.hypot(span[0], span[1], span[2]) / 2,
    };
  }

  /** Atom index for an intersected instance of the atom mesh, or null. */
  atomIndexForInstance(mesh: Object3D, instanceId: number | undefined): number | null {
    if (mesh !== this.atomMesh || instanceId === undefined) return null;
    return this.atomOfInstance[instanceId] ?? null;
  }

  /** Index into `structure.bonds` for an intersected instance of the bond mesh, or null. */
  bondIndexForInstance(mesh: Object3D, instanceId: number | undefined): number | null {
    if (mesh !== this.bondMesh || instanceId === undefined) return null;
    const half = this.bondHalves[instanceId];
    return half ? (this.bondMeshBondIndices[half.bond] ?? null) : null;
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
    // the colour array is per atom and identified by identity: stringifying it every frame would
    // cost more than drawing does
    const { atomColors, ...keyed } = this.settings;
    const settingsKey = JSON.stringify(keyed);
    const colorsChanged = atomColors !== this.lastAtomColors;
    // the selection only changes what is drawn when it has a style of its own
    const selectionChanged =
      this.settings.selectionStyle !== null && ctx.selectedAtoms !== this.lastSelected;
    // removing the cell of a repeated structure leaves the topology untouched but the images
    // meaningless, so the presence of a cell is part of what decides a rebuild
    const cellAppeared = !!s.cell !== this.lastHadCell;
    const rebuilt =
      settingsKey !== this.lastSettings ||
      this.topologyChanged(s) ||
      selectionChanged ||
      cellAppeared;
    const moved = s.atoms !== this.lastAtoms;
    this.lastAtoms = s.atoms;
    this.lastBonds = s.bonds;
    if (rebuilt) {
      this.rebuild(s, ctx.selectedAtoms);
      this.lastSettings = settingsKey;
      this.lastHadCell = !!s.cell;
    }
    // display-only positions (trajectory frame): update instance matrices, keep topology
    const raw = ctx.positionsOverride ?? null;
    const override = raw && raw.length === s.atoms.length * 3 ? raw : null;
    const cell = ctx.cellOverride ?? s.cell?.vectors ?? null;
    if (rebuilt || moved || override !== this.lastOverride || cell !== this.lastCell) {
      this.applyPositions(s, override, cell);
      this.lastOverride = override;
      this.lastCell = cell;
    }
    // colours depend on the element sequence (a rebuild), the selection and the hover only
    if (
      rebuilt ||
      colorsChanged ||
      ctx.selectedAtoms !== this.lastSelected ||
      ctx.hoveredAtom !== this.lastHovered
    ) {
      this.applyColors(ctx);
      this.lastAtomColors = atomColors;
      this.lastSelected = ctx.selectedAtoms;
      this.lastHovered = ctx.hoveredAtom;
    }
  }

  /** Write atom and bond instance matrices from `override` (3 floats per atom) or the structure. */
  private applyPositions(
    s: StructureDoc,
    override: Float32Array | null,
    cell: Cell['vectors'] | null,
  ): void {
    // the image offsets come from the cell of the frame being displayed, so a cell that changes
    // during a variable-cell relaxation moves the images with it
    const offsets = this.imageCells.map(([i, j, k]) =>
      cell
        ? new Vector3(
            i * cell[0][0] + j * cell[1][0] + k * cell[2][0],
            i * cell[0][1] + j * cell[1][1] + k * cell[2][1],
            i * cell[0][2] + j * cell[1][2] + k * cell[2][2],
          )
        : new Vector3(),
    );
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
        read(this.atomOfInstance[k]!, a).add(offsets[this.imageOfInstance[k]!] ?? ORIGIN);
        m.makeScale(r, r, r).setPosition(a);
        this.atomMesh.setMatrixAt(k, m);
      }
      this.atomMesh.instanceMatrix.needsUpdate = true;
    }
    if (this.bondMesh) {
      const ref = new Vector3();
      const offset = new Vector3();
      this.bondHalves.forEach((half, k) => {
        const bond = this.bondMeshBonds[half.bond]!;
        const radius = this.bondRadii[half.bond]!;
        const shift = offsets[half.image] ?? ORIGIN;
        read(bond.a, a).add(shift);
        read(bond.b, b).add(shift);
        mid.addVectors(a, b).multiplyScalar(0.5);
        offset.set(0, 0, 0);
        if (half.shift !== 0) {
          // the sticks of a multiple bond lie in the plane of the bond and a neighbouring atom,
          // which is where a chemist expects to see them; the perpendicular is computed per frame
          // so that a trajectory keeps them in that plane
          bondPlaneAxis(a, b, half.reference >= 0 ? read(half.reference, ref) : null, offset);
          offset.multiplyScalar(half.shift * radius * MULTIPLE_BOND_GAP);
        }
        a.add(offset);
        b.add(offset);
        mid.add(offset);
        const first = half.end === 'a';
        this.bondMesh!.setMatrixAt(
          k,
          first ? cylinderMatrix(a, mid, radius, m) : cylinderMatrix(mid, b, radius, m),
        );
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
    // one instance per visible atom per image; picking maps an image back to its atom
    this.imageCells = this.images(s, visibleAtoms.length);
    const images = this.imageCells.length;
    this.atomOfInstance = [];
    this.imageOfInstance = new Int32Array(visibleAtoms.length * images);
    for (let image = 0; image < images; image++) {
      for (const atomIndex of visibleAtoms) {
        this.imageOfInstance[this.atomOfInstance.length] = image;
        this.atomOfInstance.push(atomIndex);
      }
    }

    // atoms
    const { sphere, cylinder } = this.geometryFor(this.atomOfInstance.length);
    const atomMesh = new InstancedMesh(sphere, this.material, this.atomOfInstance.length);
    this.instanceRadius = new Float32Array(this.atomOfInstance.length);
    this.atomOfInstance.forEach((atomIndex, k) => {
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
    this.bondHalves = this.halvesFor(s, bonds);
    if (this.bondHalves.length) {
      const bondMesh = new InstancedMesh(cylinder, this.material, this.bondHalves.length);
      bondMesh.frustumCulled = false;
      this.bondMesh = bondMesh;
      this.bondMeshBonds = bonds;
      this.object.add(bondMesh);
    }
  }

  /**
   * The half-cylinders to draw: two per single bond, two per stick of a double or triple one.
   * The shifts are symmetric about the bond axis (-1,+1 for a double, -1,0,+1 for a triple).
   */
  /**
   * The (i, j, k) images to draw: one per cell of the repeat, and just the origin without a cell.
   * A repeat large enough to exceed the instance budget is cut short rather than drawn: a
   * hundred images of a thousand atoms is a dead tab, not a picture.
   */
  private images(s: StructureDoc, atoms: number): [number, number, number][] {
    const [na, nb, nc] = this.settings.cellRepeat;
    this.truncated = false;
    if (!s.cell || (na <= 1 && nb <= 1 && nc <= 1)) return [[0, 0, 0]];
    const budget = Math.max(1, Math.floor(MAX_INSTANCES / Math.max(1, atoms)));
    const out: [number, number, number][] = [];
    for (let i = 0; i < Math.max(1, na); i++) {
      for (let j = 0; j < Math.max(1, nb); j++) {
        for (let k = 0; k < Math.max(1, nc); k++) {
          if (out.length >= budget) {
            this.truncated = true;
            return out;
          }
          out.push([i, j, k]);
        }
      }
    }
    return out;
  }

  private halvesFor(s: StructureDoc, bonds: StructureDoc['bonds']): BondHalf[] {
    const out: BondHalf[] = [];
    // one pass over the bonds, rather than a scan per multiple bond: at 1e4 double bonds the
    // scan was the whole rebuild
    const multiple = this.settings.multipleBonds && bonds.some((b) => b.order > 1);
    const adj = multiple ? adjacency(s) : [];
    bonds.forEach((bond, k) => {
      const sticks = this.settings.multipleBonds ? Math.min(3, Math.max(1, bond.order)) : 1;
      const reference =
        sticks > 1
          ? (adj[bond.a]?.find((x) => x !== bond.b) ?? adj[bond.b]?.find((x) => x !== bond.a) ?? -1)
          : -1;
      for (let image = 0; image < this.imageCells.length; image++) {
        for (let i = 0; i < sticks; i++) {
          const shift = sticks === 1 ? 0 : i - (sticks - 1) / 2;
          out.push({ bond: k, end: 'a', shift, reference, image });
          out.push({ bond: k, end: 'b', shift, reference, image });
        }
      }
    });
    return out;
  }

  /**
   * Sphere segments for `count` atoms. A 32x24 sphere is 1472 triangles: at 100k atoms that is
   * 157 M triangles per frame and the viewport drops below a frame per second, while the same
   * scene at 8x6 renders 5-7 times faster and is indistinguishable at the size one atom occupies
   * when a hundred thousand of them are on screen (measured, see docs/performance.md).
   */
  private geometryFor(count: number): { sphere: SphereGeometry; cylinder: CylinderGeometry } {
    const quality = this.settings.quality;
    const detail =
      quality === 'low' ? 0 : quality === 'high' ? 2 : count > 20_000 ? 0 : count > 2_000 ? 1 : 2;
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
  /** identity of the colour override the instance colours were written from */
  private lastAtomColors: Float32Array | null = null;

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

  /** The atom's colour before selection and hover tints: the scheme's, or the element's. */
  private baseColor(s: StructureDoc, atomIndex: number, out: Color): void {
    const override = this.settings.atomColors;
    // a stale override (an edit added atoms) must not read past its end
    if (override && 3 * atomIndex + 2 < override.length) {
      out.setRGB(
        override[3 * atomIndex]!,
        override[3 * atomIndex + 1]!,
        override[3 * atomIndex + 2]!,
      );
      return;
    }
    const el = elementBySymbol(s.atoms[atomIndex]!.element);
    out.setRGB(el.color[0], el.color[1], el.color[2]);
  }

  private applyColors(ctx: LayerContext): void {
    const s = ctx.structure;
    const color = new Color();
    if (this.atomMesh) {
      this.atomOfInstance.forEach((atomIndex, k) => {
        this.baseColor(s, atomIndex, color);
        if (ctx.selectedAtoms.has(atomIndex)) color.lerp(SELECTION_COLOR, 0.6);
        if (ctx.hoveredAtom === atomIndex) color.lerp(HOVER_COLOR, 0.5);
        this.atomMesh!.setColorAt(k, color);
      });
      if (this.atomMesh.instanceColor) this.atomMesh.instanceColor.needsUpdate = true;
    }
    if (this.bondMesh) {
      this.bondHalves.forEach((half, k) => {
        const bond = this.bondMeshBonds[half.bond]!;
        const atomIndex = half.end === 'a' ? bond.a : bond.b;
        this.baseColor(s, atomIndex, color);
        // a stick or wireframe atom is only visible through its bonds, so tint them instead
        const atomStyle = this.styleOf(atomIndex, ctx.selectedAtoms);
        if (atomStyle === 'stick' || atomStyle === 'wireframe') {
          if (ctx.selectedAtoms.has(atomIndex)) color.lerp(SELECTION_COLOR, 0.6);
        }
        this.bondMesh!.setColorAt(k, color);
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
