/**
 * Atom and bond labels (Avogadro 1's Label engine).
 *
 * Each label is a billboarded canvas sprite, which keeps text readable from every angle without a
 * font loader. Sprites are not free, so the layer refuses to draw more than `MAX_LABELS` of them:
 * a hundred thousand labels would be unreadable anyway, and the cost would land on every frame.
 */
import { Group, type Sprite } from 'three';
import type { StructureDoc } from '../../model/structure';
import {
  atomLabel,
  atomLabelOffset,
  bondLabel,
  partialCharges,
  residueOfAtom,
  type AtomLabelContent,
  type BondLabelContent,
} from '../labels';
import { disposeSprite, makeTextSprite } from '../textSprite';
import type { DisplayLayer, LayerContext } from './Layer';

export interface LabelLayerSettings {
  atoms: AtomLabelContent;
  bonds: BondLabelContent;
  color: string;
  size: number;
  /** Offset in Angstrom, applied in world space after the per-atom radius offset. */
  shift: [number, number, number];
}

export const DEFAULT_LABEL_SETTINGS: LabelLayerSettings = {
  atoms: 'symbol_index',
  bonds: 'none',
  color: '#222222',
  size: 0.55,
  shift: [0, 0, 0],
};

export const MAX_LABELS = 2000;

export class LabelLayer implements DisplayLayer {
  readonly id = 'labels';
  readonly object = new Group();
  visible = false;
  settings: LabelLayerSettings = { ...DEFAULT_LABEL_SETTINGS };

  /** Text of each sprite, so a move can skip rebuilding when nothing changed. */
  private texts: string[] = [];
  private sprites: Sprite[] = [];
  private lastKey = '';
  /** True when the structure has more labels than MAX_LABELS, so the UI can say why. */
  truncated = false;

  setSettings(patch: Partial<LabelLayerSettings>): void {
    this.settings = { ...this.settings, ...patch };
  }

  update(ctx: LayerContext): void {
    if (!this.visible) {
      this.clear();
      return;
    }
    const s = ctx.structure;
    const positions = ctx.positionsOverride ?? null;
    const wanted = this.collect(s);
    const key = `${JSON.stringify(this.settings)}|${wanted.map((w) => w.text).join('')}`;
    if (key !== this.lastKey) {
      this.rebuild(wanted);
      this.lastKey = key;
    }
    this.place(s, wanted, positions);
  }

  /** The label text and anchor of everything that should be drawn, in draw order. */
  private collect(s: StructureDoc): { text: string; atom: number; bond: number }[] {
    const out: { text: string; atom: number; bond: number }[] = [];
    const { atoms, bonds } = this.settings;
    this.truncated = false;
    if (atoms !== 'none') {
      const charges = partialCharges(s);
      const residues = residueOfAtom(s);
      for (let i = 0; i < s.atoms.length; i++) {
        const text = atomLabel(s, i, atoms, charges, residues);
        if (!text) continue;
        if (out.length >= MAX_LABELS) {
          this.truncated = true;
          return out;
        }
        out.push({ text, atom: i, bond: -1 });
      }
    }
    if (bonds !== 'none') {
      for (let i = 0; i < s.bonds.length; i++) {
        const text = bondLabel(s, i, bonds);
        if (!text) continue;
        if (out.length >= MAX_LABELS) {
          this.truncated = true;
          return out;
        }
        out.push({ text, atom: -1, bond: i });
      }
    }
    return out;
  }

  private rebuild(wanted: { text: string }[]): void {
    this.clear();
    // `texts` is what the layer would draw and is set even where no 2D canvas exists (headless),
    // so the decision of what to label stays separate from whether it can be rasterized.
    this.texts = wanted.map((w) => w.text);
    for (const { text } of wanted) {
      const sprite = makeTextSprite(text, this.settings.color, this.settings.size);
      if (!sprite) return;
      this.sprites.push(sprite);
      this.object.add(sprite);
    }
  }

  private place(
    s: StructureDoc,
    wanted: { atom: number; bond: number }[],
    override: Float32Array | null,
  ): void {
    const [dx, dy, dz] = this.settings.shift;
    const at = (i: number): [number, number, number] =>
      override && override.length === s.atoms.length * 3
        ? [override[3 * i]!, override[3 * i + 1]!, override[3 * i + 2]!]
        : (s.atoms[i]!.position as [number, number, number]);

    this.sprites.forEach((sprite, k) => {
      const w = wanted[k];
      if (!w) return;
      if (w.atom >= 0) {
        const p = at(w.atom);
        const lift = atomLabelOffset(s.atoms[w.atom]!.element, 'small');
        sprite.position.set(p[0] + dx, p[1] + lift + dy, p[2] + dz);
      } else {
        const bond = s.bonds[w.bond]!;
        const a = at(bond.a);
        const b = at(bond.b);
        sprite.position.set((a[0] + b[0]) / 2 + dx, (a[1] + b[1]) / 2 + dy, (a[2] + b[2]) / 2 + dz);
      }
    });
  }

  private clear(): void {
    for (const sprite of this.sprites) {
      this.object.remove(sprite);
      disposeSprite(sprite);
    }
    this.sprites = [];
    this.texts = [];
    this.lastKey = '';
  }

  /** Label texts currently drawn, in draw order (for tests and for the settings panel). */
  labels(): readonly string[] {
    return this.texts;
  }

  dispose(): void {
    this.clear();
  }
}
