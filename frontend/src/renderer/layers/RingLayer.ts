/**
 * Filled ring planes (Avogadro's Ring engine): each perceived ring drawn as a coloured polygon
 * through its atoms, which is how an aromatic system reads at a glance in a large structure.
 *
 * The colour is Avogadro's, indexed by ring size (see `model/rings`). One mesh with a colour per
 * vertex, so any number of rings costs one draw call.
 *
 * Every ring is fanned from its own centroid. Avogadro triangulates three- to six-rings explicitly
 * and only fans from the centroid for seven and up; the fan is the same filled polygon for a flat
 * ring and a better one for a puckered one -- a cyclohexane chair fanned from atom 0, the way its
 * six-ring case does it, folds along one diagonal instead of lying on the ring.
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
import { findRings, ringColor, type Ring } from '../../model/rings';
import type { Vec3 } from '../../model/structure';
import { sameHidden } from '../atomStyles';
import type { DisplayLayer, LayerContext } from './Layer';

export interface RingLayerSettings {
  /** Avogadro's `m_alpha`, its only setting for this engine (default 1.0). */
  opacity: number;
}

export const DEFAULT_RING_SETTINGS: RingLayerSettings = { opacity: 1 };

export class RingLayer implements DisplayLayer {
  readonly id = 'rings';
  readonly object = new Group();
  visible = false;
  settings: RingLayerSettings = { ...DEFAULT_RING_SETTINGS };

  private mesh: Mesh<BufferGeometry, MeshStandardMaterial> | null = null;
  private hidden: ReadonlySet<number> | null = null;
  private count = 0;
  /** Perception depends on the bonds alone, so it is redone on an edit and not on a move. */
  private cache: { bonds: unknown; hidden: ReadonlySet<number> | null; rings: Ring[] } | null =
    null;
  private lastInput: { rings: Ring[]; override: unknown; settings: string } | null = null;

  setSettings(patch: Partial<RingLayerSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.applyMaterial();
  }

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

    // a ring with an atom display scoping has hidden is not drawn: half a ring is not a ring
    const hidden = this.hidden;
    if (
      !this.cache ||
      this.cache.bonds !== s.bonds ||
      !sameHidden(this.cache.hidden, hidden ?? null)
    ) {
      const found = findRings(s);
      this.cache = {
        bonds: s.bonds,
        hidden: hidden ?? null,
        rings: hidden ? found.filter((r) => !r.atoms.some((a) => hidden.has(a))) : found,
      };
    }
    const rings = this.cache.rings;

    const settings = JSON.stringify(this.settings);
    if (
      this.lastInput &&
      this.lastInput.rings === rings &&
      this.lastInput.override === override &&
      this.lastInput.settings === settings
    ) {
      return;
    }

    const triangles = rings.reduce((sum, r) => sum + r.atoms.length, 0);
    this.clear();
    this.lastInput = { rings, override, settings };
    this.count = rings.length;
    if (!triangles) return;

    const positions = new Float32Array(triangles * 9);
    const colors = new Float32Array(triangles * 9);
    const color = new Color();
    let v = 0;
    for (const ring of rings) {
      const corners = ring.atoms.map(at);
      const centroid: Vec3 = [0, 1, 2].map(
        (c) => corners.reduce((sum, p) => sum + p[c]!, 0) / corners.length,
      ) as Vec3;
      const [r, g, b] = ringColor(ring.atoms.length);
      color.setRGB(r, g, b);
      // one triangle per ring bond: centroid, this atom, the next
      for (let i = 0; i < corners.length; i++) {
        for (const p of [centroid, corners[i]!, corners[(i + 1) % corners.length]!]) {
          positions[v] = p[0];
          positions[v + 1] = p[1];
          positions[v + 2] = p[2];
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
      // a ring plane is seen from either side, which is Avogadro disabling face culling for it
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, side: DoubleSide }),
    );
    this.mesh.frustumCulled = false;
    this.object.add(this.mesh);
    this.applyMaterial();
  }

  /** How many rings are drawn (for tests and the panel). */
  rings(): number {
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
    this.cache = null;
  }
}
