/**
 * Coordination polyhedra (Avogadro's Polygon engine): the solid whose corners are an atom's
 * neighbours, drawn around every atom that qualifies. See `model/polyhedra` for which atoms
 * qualify and how the faces are found.
 *
 * One mesh for the whole structure with a colour per vertex, so any number of polyhedra costs one
 * draw call. Avogadro's engine has no settings widget at all; an opacity is offered here because
 * the polyhedra sit on top of the atoms they are built from and hide them when solid, which is
 * the same reason its surface engine defaults to 0.75.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { elementBySymbol } from '../../model/elements';
import { coordinationPolyhedra } from '../../model/polyhedra';
import type { Vec3 } from '../../model/structure';
import { sameHidden } from '../atomStyles';
import type { DisplayLayer, LayerContext } from './Layer';

export interface PolygonLayerSettings {
  /** Opacity of the solids. Below 1 they stop hiding the atoms they are built from. */
  opacity: number;
}

export const DEFAULT_POLYGON_SETTINGS: PolygonLayerSettings = { opacity: 0.75 };

export class PolygonLayer implements DisplayLayer {
  readonly id = 'polygons';
  readonly object = new Group();
  visible = false;
  settings: PolygonLayerSettings = { ...DEFAULT_POLYGON_SETTINGS };

  private mesh: Mesh<BufferGeometry, MeshStandardMaterial> | null = null;
  private hidden: ReadonlySet<number> | null = null;
  private count = 0;
  private lastInput: {
    atoms: unknown;
    bonds: unknown;
    override: unknown;
    settings: string;
    hidden: ReadonlySet<number> | null;
  } | null = null;

  setSettings(patch: Partial<PolygonLayerSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.applyMaterial();
  }

  /** The atoms display scoping hides; kept out of `settings` because a Set has no JSON identity. */
  setHidden(hidden: ReadonlySet<number> | null): void {
    this.hidden = hidden;
  }

  private applyMaterial(): void {
    if (!this.mesh) return;
    const opacity = Math.min(1, Math.max(0, this.settings.opacity));
    const transparent = opacity < 1;
    const m = this.mesh.material;
    m.opacity = opacity;
    m.transparent = transparent;
    // a polyhedron is a closed solid seen from outside, but with the far faces showing through it
    // needs both sides lit, and depth writing off so the near face does not hide the far one
    m.depthWrite = !transparent;
    m.needsUpdate = true;
    this.mesh.renderOrder = transparent ? 6 : 0;
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

    const input = {
      atoms: s.atoms,
      bonds: s.bonds,
      override,
      settings: JSON.stringify(this.settings),
      hidden: this.hidden,
    };
    // the hull is O(n^4) per site: a pointer move must not pay for it
    if (
      this.lastInput &&
      this.lastInput.atoms === input.atoms &&
      this.lastInput.bonds === input.bonds &&
      this.lastInput.override === input.override &&
      this.lastInput.settings === input.settings &&
      sameHidden(this.lastInput.hidden, input.hidden)
    ) {
      return;
    }

    const found = coordinationPolyhedra(s, at, this.hidden, (e) => elementBySymbol(e).number);
    const triangles = found.reduce((sum, p) => sum + p.faces.length, 0);
    this.clear();
    this.lastInput = input;
    this.count = found.length;
    if (!triangles) return;

    const positions = new Float32Array(triangles * 9);
    const colors = new Float32Array(triangles * 9);
    const color = new Color();
    let v = 0;
    for (const solid of found) {
      const element = elementBySymbol(s.atoms[solid.center]!.element);
      color.setRGB(element.color[0], element.color[1], element.color[2]);
      for (const face of solid.faces) {
        for (const corner of face) {
          positions[v] = corner[0];
          positions[v + 1] = corner[1];
          positions[v + 2] = corner[2];
          colors[v] = color.r;
          colors[v + 1] = color.g;
          colors[v + 2] = color.b;
          v += 3;
        }
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    this.mesh = new Mesh(
      geometry,
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.45, side: DoubleSide }),
    );
    this.mesh.frustumCulled = false;
    this.object.add(this.mesh);
    this.applyMaterial();
  }

  /** How many polyhedra are drawn (for tests and the panel). */
  polyhedra(): number {
    return this.count;
  }

  private clear(): void {
    if (this.mesh) {
      this.object.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
    this.count = 0;
    this.lastInput = null;
  }

  dispose(): void {
    this.clear();
  }
}
