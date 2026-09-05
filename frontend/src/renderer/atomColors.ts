/**
 * Colour schemes for atoms. The default is the element colour the periodic table carries; the
 * others answer questions about a biomolecule that element colours cannot ("where is chain B",
 * "which residues are charged", "where are the helices").
 *
 * The result is one RGB triple per atom, which `StructureLayer` uses instead of the element
 * colour. Selection and hover tints are applied on top of it by the layer, as before.
 */
import type { SecondaryStructureData } from './layers/RibbonLayer';
import { KIND_COLOR } from '../model/ribbon';
import type { StructureDoc } from '../model/structure';

export type ColorScheme =
  'element' | 'residue' | 'chain' | 'secondary' | 'index' | 'distance' | 'charge' | 'custom';

export const COLOR_SCHEMES: { id: ColorScheme; label: string }[] = [
  { id: 'element', label: 'Element' },
  { id: 'residue', label: 'Residue' },
  { id: 'chain', label: 'Chain' },
  { id: 'secondary', label: 'Secondary structure' },
  { id: 'index', label: 'Atom index' },
  { id: 'distance', label: 'Distance from the first atom' },
  { id: 'charge', label: 'Partial charge' },
  { id: 'custom', label: 'One colour' },
];

/** Schemes that need residues; the others work on any molecule. */
const NEEDS_RESIDUES: ReadonlySet<ColorScheme> = new Set<ColorScheme>([
  'residue',
  'chain',
  'secondary',
]);

type RGB = [number, number, number];

/** Anything the scheme does not recognise, so an unknown residue is visible as unknown. */
export const UNKNOWN_COLOR: RGB = [0.6, 0.6, 0.6];

/** RasMol's amino-acid colours, which is what Avogadro 1's residue colour scheme uses. */
export const RESIDUE_COLOR: Record<string, RGB> = {
  ASP: [0.9, 0.04, 0.04],
  GLU: [0.9, 0.04, 0.04],
  LYS: [0.08, 0.35, 1.0],
  ARG: [0.08, 0.35, 1.0],
  HIS: [0.51, 0.51, 0.82],
  PHE: [0.2, 0.2, 0.67],
  TYR: [0.2, 0.2, 0.67],
  GLY: [0.92, 0.92, 0.92],
  ALA: [0.78, 0.78, 0.78],
  VAL: [0.06, 0.51, 0.06],
  LEU: [0.06, 0.51, 0.06],
  ILE: [0.06, 0.51, 0.06],
  SER: [0.98, 0.59, 0.0],
  THR: [0.98, 0.59, 0.0],
  ASN: [0.0, 0.86, 0.86],
  GLN: [0.0, 0.86, 0.86],
  MET: [0.9, 0.9, 0.0],
  CYS: [0.9, 0.9, 0.0],
  TRP: [0.71, 0.35, 0.71],
  PRO: [0.86, 0.59, 0.51],
  // nucleic acids, so a DNA or RNA model is not entirely grey
  A: [0.65, 0.14, 0.14],
  T: [0.14, 0.65, 0.14],
  G: [0.14, 0.14, 0.65],
  C: [0.65, 0.65, 0.14],
  U: [0.65, 0.14, 0.65],
};

/** A fixed cycle, so the same chain keeps its colour between documents and sessions. */
export const CHAIN_COLORS: RGB[] = [
  [0.35, 0.6, 0.95],
  [0.95, 0.55, 0.25],
  [0.35, 0.8, 0.45],
  [0.85, 0.4, 0.75],
  [0.95, 0.85, 0.3],
  [0.45, 0.85, 0.85],
  [0.75, 0.45, 0.95],
  [0.9, 0.4, 0.4],
];

/**
 * The ramp Avogadro's index and distance colour plugins draw (see
 * `libavogadro/src/colors/atomindexcolor.cpp`): red at 0 through orange, yellow and green to blue,
 * ending in a half-bright purple at 1. Piecewise linear, with the breakpoints Avogadro uses.
 */
export function rainbow(t: number): RGB {
  const f = Math.min(1, Math.max(0, t));
  if (f < 0.4) return [1, f * 2.5, 0]; // red -> orange -> yellow
  if (f < 0.6) return [1 - 5 * (f - 0.4), 1, 0]; // yellow -> green
  if (f < 0.8) return [0, 1 - 5 * (f - 0.6), 5 * (f - 0.6)]; // green -> blue
  return [2.5 * (f - 0.8), 0, 1 - 2.5 * (f - 0.8)]; // blue -> purple
}

/**
 * Avogadro's charge colours: white at zero towards red for negative and blue for positive.
 * Avogadro scales by `sqrt(|q|)` clamped at 1, which is an absolute scale; this scales by the
 * largest magnitude in the structure instead, so a set of small charges is still readable.
 */
export function chargeColor(q: number, scale: number): RGB {
  const t = scale > 0 ? Math.min(1, Math.abs(q) / scale) : 0;
  return q < 0 ? [1, 1 - t, 1 - t] : [1 - t, 1 - t, 1];
}

/** `#rrggbb` (or `#rgb`) as an RGB triple in 0..1; unparseable text is grey rather than black. */
export function parseHexColor(hex: string): RGB {
  const text = hex.trim().replace(/^#/, '');
  const full =
    text.length === 3
      ? text
          .split('')
          .map((c) => c + c)
          .join('')
      : text;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return UNKNOWN_COLOR;
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const write = (out: Float32Array, atom: number, c: RGB): void => {
  out[3 * atom] = c[0];
  out[3 * atom + 1] = c[1];
  out[3 * atom + 2] = c[2];
};

/**
 * One RGB triple per atom for `scheme`, or null for `element` (the layer's own default) and for a
 * scheme whose data is missing — a document without residues has nothing to colour by. It takes
 * the residues and the atom count rather than the document, because those are the only things it
 * depends on: the caller memoizes on them and a drag then costs nothing.
 */
export function atomColors(
  residues: StructureDoc['residues'],
  atomCount: number,
  scheme: ColorScheme,
  secondary: SecondaryStructureData | null = null,
  extra: {
    /** the atoms, for `distance`; the caller passes them only when the scheme asks for them */
    atoms?: StructureDoc['atoms'] | null;
    /** partial charges, for `charge`; null when the structure carries none */
    charges?: readonly number[] | null;
    /** the colour of the `custom` scheme, as `#rrggbb` */
    custom?: string;
  } = {},
): Float32Array | null {
  if (scheme === 'element') return null;
  if (NEEDS_RESIDUES.has(scheme) && residues.length === 0) return null;
  if (scheme === 'charge' && !extra.charges?.length) return null;
  if (scheme === 'distance' && !extra.atoms?.length) return null;
  const out = new Float32Array(atomCount * 3);
  for (let i = 0; i < atomCount; i++) write(out, i, UNKNOWN_COLOR);
  if (scheme === 'custom') {
    const c = parseHexColor(extra.custom ?? '');
    for (let i = 0; i < atomCount; i++) write(out, i, c);
    return out;
  }
  if (scheme === 'index') {
    for (let i = 0; i < atomCount; i++)
      write(out, i, rainbow(atomCount < 2 ? 0 : i / (atomCount - 1)));
    return out;
  }
  if (scheme === 'distance') {
    const atoms = extra.atoms!;
    const first = atoms[0]!.position;
    const d = (i: number): number => {
      const p = atoms[i]?.position;
      if (!p) return 0;
      return Math.hypot(p[0]! - first[0]!, p[1]! - first[1]!, p[2]! - first[2]!);
    };
    let max = 0;
    for (let i = 0; i < atomCount; i++) max = Math.max(max, d(i));
    for (let i = 0; i < atomCount; i++) write(out, i, rainbow(max > 0 ? d(i) / max : 0));
    return out;
  }
  if (scheme === 'charge') {
    const charges = extra.charges!;
    let scale = 0;
    for (let i = 0; i < atomCount; i++) scale = Math.max(scale, Math.abs(charges[i] ?? 0));
    for (let i = 0; i < atomCount; i++) write(out, i, chargeColor(charges[i] ?? 0, scale));
    return out;
  }
  if (scheme === 'residue') {
    for (const r of residues) {
      const c = RESIDUE_COLOR[r.name.trim().toUpperCase()] ?? UNKNOWN_COLOR;
      for (const i of r.atom_indices) write(out, i, c);
    }
    return out;
  }
  if (scheme === 'chain') {
    const order = [...new Set(residues.map((r) => r.chain))];
    for (const r of residues) {
      const c = CHAIN_COLORS[order.indexOf(r.chain) % CHAIN_COLORS.length]!;
      for (const i of r.atom_indices) write(out, i, c);
    }
    return out;
  }
  if (!secondary) return out;
  for (const a of secondary.residues) {
    const residue = residues[a.residue];
    if (!residue) continue;
    for (const i of residue.atom_indices) write(out, i, KIND_COLOR[a.kind]);
  }
  return out;
}
