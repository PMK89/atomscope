/**
 * Protein ribbons and cartoons (Avogadro's Ribbon and Cartoon engines).
 *
 * The assignment comes from the backend (DSSP) and names its backbone atoms by uid, so the layer
 * survives any edit that renumbers atoms: it maps uid to index once per rebuild and reads the
 * positions of the frame being displayed, which makes a ribbon follow a trajectory.
 */
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import type { Vec3 } from '../../model/structure';
import {
  chainFrames,
  stripGeometry,
  type GuideResidue,
  type RibbonStyle,
} from '../../model/ribbon';
import {
  CHAIN_COLORS,
  PALETTE_UNKNOWN,
  RESIDUE_PALETTES,
  UNKNOWN_COLOR,
  type ResiduePalette,
} from '../atomColors';
import type { DisplayLayer, LayerContext } from './Layer';

/** One residue as the backend reports it: backbone atoms by uid. */
export interface ResidueAssignment {
  residue: number;
  kind: GuideResidue['kind'];
  ca: string;
  o: string;
}

/** What the backend returned for the current document. */
export interface SecondaryStructureData {
  residues: ResidueAssignment[];
  /** residue indices in backbone order, one list per chain */
  chains: number[][];
}

/** What paints the strip: this engine's own colour map (Avogadro gives every engine one). */
export type RibbonColorScheme = 'secondary' | 'chain' | 'residue';

export interface RibbonLayerSettings {
  style: RibbonStyle;
  /** Multiplies the widths the style defines. */
  scale: number;
  colorScheme: RibbonColorScheme;
  /** Which residue table the `residue` scheme paints with; shared with the atom colours. */
  residuePalette: ResiduePalette;
}

export const DEFAULT_RIBBON_SETTINGS: RibbonLayerSettings = {
  style: 'cartoon',
  scale: 1,
  colorScheme: 'secondary',
  residuePalette: 'amino',
};

export class RibbonLayer implements DisplayLayer {
  readonly id = 'ribbon';
  readonly object = new Group();
  visible = false;
  settings: RibbonLayerSettings = { ...DEFAULT_RIBBON_SETTINGS };

  private data: SecondaryStructureData | null = null;
  private mesh: Mesh | null = null;
  private readonly material = new MeshStandardMaterial({
    vertexColors: true,
    // a ribbon is a surface with no thickness: without this its back faces vanish
    side: DoubleSide,
    roughness: 0.6,
  });
  private lastKey = '';
  /** What the last geometry was built from: a hover does not change any of it. */
  private lastInput: { atoms: unknown; override: unknown; data: unknown; settings: string } | null =
    null;

  setSettings(patch: Partial<RibbonLayerSettings>): void {
    this.settings = { ...this.settings, ...patch };
  }

  /** The assignment to draw, or null when the document is not a protein. */
  setData(data: SecondaryStructureData | null): void {
    this.data = data;
  }

  update(ctx: LayerContext): void {
    if (!this.visible || !this.data || this.data.residues.length === 0) {
      this.clear();
      return;
    }
    const s = ctx.structure;
    const raw = ctx.positionsOverride ?? null;
    const override = raw && raw.length === s.atoms.length * 3 ? raw : null;
    const input = {
      atoms: s.atoms,
      override,
      data: this.data,
      settings: JSON.stringify(this.settings),
    };
    // the spline, the strip and the normals are none of them cheap, and a pointer move changes
    // neither the atoms nor the assignment
    if (
      this.mesh &&
      this.lastInput &&
      this.lastInput.atoms === input.atoms &&
      this.lastInput.override === input.override &&
      this.lastInput.data === input.data &&
      this.lastInput.settings === input.settings
    ) {
      return;
    }
    const index = new Map(s.atoms.map((a, i) => [a.uid, i]));
    const at = (uid: string): Vec3 | null => {
      const i = index.get(uid);
      if (i === undefined) return null;
      if (override) return [override[3 * i]!, override[3 * i + 1]!, override[3 * i + 2]!];
      return s.atoms[i]!.position as Vec3;
    };

    const byResidue = new Map(this.data.residues.map((r) => [r.residue, r]));
    // the chain order the atom colours use, so a cartoon and its atoms agree on which chain is blue
    const chainOrder = [...new Set(s.residues.map((r) => r.chain))];
    const colorOf = (residue: number): Vec3 | undefined => {
      const { colorScheme } = this.settings;
      if (colorScheme === 'secondary') return undefined;
      const r = s.residues[residue];
      if (!r) return UNKNOWN_COLOR;
      if (colorScheme === 'chain')
        return CHAIN_COLORS[chainOrder.indexOf(r.chain) % CHAIN_COLORS.length]!;
      const palette = this.settings.residuePalette;
      return RESIDUE_PALETTES[palette][r.name.trim().toUpperCase()] ?? PALETTE_UNKNOWN[palette];
    };
    const chains: GuideResidue[][] = [];
    for (const chain of this.data.chains) {
      const guide: GuideResidue[] = [];
      for (const residue of chain) {
        const r = byResidue.get(residue);
        if (!r) continue;
        const ca = at(r.ca);
        const o = at(r.o);
        // an edit that deleted a backbone atom breaks the chain there rather than joining across
        if (!ca || !o) {
          if (guide.length > 1) chains.push([...guide]);
          guide.length = 0;
          continue;
        }
        const color = colorOf(r.residue);
        guide.push({ ca, o, kind: r.kind, ...(color ? { color } : {}) });
      }
      if (guide.length > 1) chains.push(guide);
    }

    const frames = chains.map((c) => this.scaled(chainFrames(c, this.settings.style)));
    const geometry = stripGeometry(frames);
    // the mesh is rebuilt whenever the positions change, so a key over the sizes is not enough
    const key = `${JSON.stringify(this.settings)}|${geometry.positions.length}`;
    if (!this.mesh || key !== this.lastKey) {
      this.clear();
      this.mesh = new Mesh(new BufferGeometry(), this.material);
      this.mesh.frustumCulled = false;
      this.object.add(this.mesh);
      this.lastKey = key;
    }
    const g = this.mesh.geometry;
    g.setAttribute('position', new BufferAttribute(geometry.positions, 3));
    g.setAttribute('color', new BufferAttribute(geometry.colors, 3));
    g.setIndex(new BufferAttribute(geometry.indices, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    // set last, because a rebuild clears it on the way through
    this.lastInput = input;
  }

  private scaled(frames: ReturnType<typeof chainFrames>): ReturnType<typeof chainFrames> {
    if (this.settings.scale === 1) return frames;
    return frames.map((f) => ({ ...f, width: f.width * this.settings.scale }));
  }

  /** Triangle count of what is drawn (for tests and for the settings panel). */
  triangles(): number {
    const index = this.mesh?.geometry.getIndex();
    return index ? index.count / 3 : 0;
  }

  private clear(): void {
    this.lastInput = null;
    if (!this.mesh) return;
    this.object.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh = null;
    this.lastKey = '';
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
  }
}
