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
  distanceLabel,
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
  /** Match the structure layer: a hidden atom must not keep its label. */
  hideHydrogens: boolean;
  /** Atoms scoped out of every display type, which the structure layer does not draw either. */
  hiddenAtoms: ReadonlySet<number> | null;
  /** Lift labels clear of van der Waals spheres when that is the display style. */
  lift: 'small' | 'vdw';
}

export const DEFAULT_LABEL_SETTINGS: LabelLayerSettings = {
  atoms: 'symbol_index',
  bonds: 'none',
  color: '#222222',
  size: 0.55,
  shift: [0, 0, 0],
  hideHydrogens: false,
  hiddenAtoms: null,
  lift: 'small',
};

export const MAX_LABELS = 2000;

/** Unit separator, so joined label texts cannot alias one another in the rebuild key. */
const SEP = '\u001f';

/** One label: its text and what it is anchored to (`atom` or `bond`, the other being -1). */
interface Wanted {
  text: string;
  atom: number;
  bond: number;
}

type PositionOf = (index: number) => [number, number, number];

export class LabelLayer implements DisplayLayer {
  readonly id = 'labels';
  readonly object = new Group();
  visible = false;
  settings: LabelLayerSettings = { ...DEFAULT_LABEL_SETTINGS };

  /** Text of each label, so a move can skip rebuilding when nothing changed. */
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
    const raw = ctx.positionsOverride ?? null;
    const override = raw && raw.length === s.atoms.length * 3 ? raw : null;
    const at: PositionOf = (i) =>
      override
        ? [override[3 * i]!, override[3 * i + 1]!, override[3 * i + 2]!]
        : (s.atoms[i]!.position as [number, number, number]);

    const wanted = this.collect(s, at);
    // the unit separator matters: joining the texts bare makes ["ab","c"] and ["a","bc"] equal
    const key = `${JSON.stringify(this.settings)}|${wanted.map((w) => w.text).join(SEP)}`;
    if (key !== this.lastKey) {
      this.rebuild(wanted);
      this.lastKey = key;
    }
    this.place(s, wanted, at);
  }

  /** Hidden atoms keep no label: the structure layer does not draw them either. */
  private hidden(s: StructureDoc, atom: number): boolean {
    if (this.settings.hiddenAtoms?.has(atom)) return true;
    return this.settings.hideHydrogens && s.atoms[atom]?.element === 'H';
  }

  /** The label text and anchor of everything that should be drawn, in draw order. */
  private collect(s: StructureDoc, at: PositionOf): Wanted[] {
    const out: Wanted[] = [];
    const { atoms, bonds } = this.settings;
    this.truncated = false;
    const full = (): boolean => {
      if (out.length < MAX_LABELS) return false;
      this.truncated = true;
      return true;
    };

    if (atoms !== 'none') {
      const charges = partialCharges(s);
      const residues = residueOfAtom(s);
      for (let i = 0; i < s.atoms.length; i++) {
        if (this.hidden(s, i)) continue;
        const text = atomLabel(s, i, atoms, charges, residues);
        if (!text) continue;
        if (full()) return out;
        out.push({ text, atom: i, bond: -1 });
      }
    }
    if (bonds !== 'none') {
      for (let i = 0; i < s.bonds.length; i++) {
        const bond = s.bonds[i]!;
        if (this.hidden(s, bond.a) || this.hidden(s, bond.b)) continue;
        // lengths are measured on the positions being displayed, so an animated normal mode shows
        // the bond stretching instead of the equilibrium value
        const text =
          bonds === 'length' ? distanceLabel(at(bond.a), at(bond.b)) : bondLabel(s, i, bonds);
        if (!text) continue;
        if (full()) return out;
        out.push({ text, atom: -1, bond: i });
      }
    }
    return out;
  }

  private rebuild(wanted: Wanted[]): void {
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

  private place(s: StructureDoc, wanted: Wanted[], at: PositionOf): void {
    const [dx, dy, dz] = this.settings.shift;
    this.sprites.forEach((sprite, k) => {
      const w = wanted[k];
      if (!w) return;
      if (w.atom >= 0) {
        const p = at(w.atom);
        const lift = atomLabelOffset(s.atoms[w.atom]!.element, this.settings.lift);
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
