/**
 * Ribbon and cartoon geometry for proteins (Avogadro's Ribbon and Cartoon engines).
 *
 * The backbone is a Catmull-Rom spline through the alpha carbons. What makes a ribbon readable is
 * not the curve but its orientation: the strip is turned so that its plane contains the carbonyl
 * direction, which is what shows the twist of a strand and the pitch of a helix. Consecutive
 * carbonyls in a beta strand point in opposite directions, so every second side vector is flipped
 * to keep the strip from making a half turn per residue.
 */
import { add, cross, dot, normalize, scale, sub } from './geometry';
import type { Vec3 } from './structure';

export type SecondaryKind = 'helix' | 'sheet' | 'turn' | 'coil';
export type RibbonStyle = 'ribbon' | 'cartoon' | 'backbone';

/** One residue of a chain, as the geometry needs it. */
export interface GuideResidue {
  ca: Vec3;
  /** carbonyl oxygen, which orients the ribbon */
  o: Vec3;
  kind: SecondaryKind;
  /** the colour of this residue's part of the strip; the secondary-structure colour if absent */
  color?: Vec3;
}

/** A point of the smoothed backbone with the frame and width the strip uses there. */
export interface Frame {
  center: Vec3;
  tangent: Vec3;
  side: Vec3;
  up: Vec3;
  width: number;
  kind: SecondaryKind;
  color: Vec3;
}

/** Samples per residue along the spline. Four is smooth enough at protein scale. */
export const SAMPLES_PER_RESIDUE = 6;

/** Half-widths in Angstrom, by style and secondary structure. */
const WIDTH: Record<RibbonStyle, Record<SecondaryKind, number>> = {
  backbone: { helix: 0.25, sheet: 0.25, turn: 0.25, coil: 0.25 },
  ribbon: { helix: 0.9, sheet: 0.9, turn: 0.9, coil: 0.9 },
  cartoon: { helix: 1.1, sheet: 1.2, turn: 0.35, coil: 0.3 },
};

/** Avogadro's cartoon colours: helices red, sheets yellow, the rest pale. */
export const KIND_COLOR: Record<SecondaryKind, [number, number, number]> = {
  helix: [0.85, 0.25, 0.25],
  sheet: [0.92, 0.82, 0.25],
  turn: [0.45, 0.7, 0.9],
  coil: [0.85, 0.85, 0.85],
};

/**
 * Side vectors along a chain: the carbonyl direction made perpendicular to the backbone, with the
 * sign carried over from the previous residue so the strip does not flip between residues.
 */
export function sideVectors(residues: GuideResidue[]): Vec3[] {
  const out: Vec3[] = [];
  let previous: Vec3 | null = null;
  for (let i = 0; i < residues.length; i++) {
    const r = residues[i]!;
    const next = residues[i + 1] ?? residues[i - 1] ?? r;
    const tangent = normalize(sub(next.ca, r.ca), [1, 0, 0]);
    const carbonyl = sub(r.o, r.ca);
    // remove the component along the backbone, leaving the direction the C=O points sideways
    let side = normalize(sub(carbonyl, scale(tangent, dot(carbonyl, tangent))), [0, 1, 0]);
    if (previous && dot(side, previous) < 0) side = scale(side, -1);
    previous = side;
    out.push(side);
  }
  return out;
}

/** Catmull-Rom interpolation between p1 and p2 (p0 and p3 give the tangents). */
export function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const out: number[] = [];
  for (let k = 0; k < 3; k++) {
    out.push(
      0.5 *
        (2 * p1[k]! +
          (-p0[k]! + p2[k]!) * t +
          (2 * p0[k]! - 5 * p1[k]! + 4 * p2[k]! - p3[k]!) * t2 +
          (-p0[k]! + 3 * p1[k]! - 3 * p2[k]! + p3[k]!) * t3),
    );
  }
  return [out[0]!, out[1]!, out[2]!];
}

const at = <T>(xs: T[], i: number): T => xs[Math.min(xs.length - 1, Math.max(0, i))]!;

/**
 * Frames along one chain. A sheet tapers into an arrowhead over its last residue, which is what
 * makes a cartoon readable; every other run keeps its width.
 */
export function chainFrames(residues: GuideResidue[], style: RibbonStyle): Frame[] {
  if (residues.length < 2) return [];
  const sides = sideVectors(residues);
  const widths = WIDTH[style];
  const frames: Frame[] = [];
  for (let i = 0; i < residues.length - 1; i++) {
    for (let s = 0; s < SAMPLES_PER_RESIDUE; s++) {
      const t = s / SAMPLES_PER_RESIDUE;
      const center = catmullRom(
        at(residues, i - 1).ca,
        residues[i]!.ca,
        residues[i + 1]!.ca,
        at(residues, i + 2).ca,
        t,
      );
      const ahead = catmullRom(
        at(residues, i - 1).ca,
        residues[i]!.ca,
        residues[i + 1]!.ca,
        at(residues, i + 2).ca,
        t + 0.05,
      );
      const tangent = normalize(sub(ahead, center), [1, 0, 0]);
      const rawSide = add(scale(sides[i]!, 1 - t), scale(sides[i + 1] ?? sides[i]!, t));
      const side = normalize(sub(rawSide, scale(tangent, dot(rawSide, tangent))), [0, 1, 0]);
      const kind = residues[i]!.kind;
      frames.push({
        center,
        tangent,
        side,
        up: normalize(cross(tangent, side), [0, 0, 1]),
        width: widths[kind] * arrowScale(residues, i, t, style),
        kind,
        color: residues[i]!.color ?? KIND_COLOR[kind],
      });
    }
  }
  const last = residues[residues.length - 1]!;
  const tail = frames[frames.length - 1]!;
  frames.push({
    ...tail,
    center: last.ca,
    width: widths[last.kind] * (last.kind === 'sheet' ? 0 : 1),
    kind: last.kind,
  });
  return frames;
}

/** 1 everywhere except over the last residue of a strand, where the arrowhead tapers to a point. */
function arrowScale(residues: GuideResidue[], i: number, t: number, style: RibbonStyle): number {
  if (style !== 'cartoon' || residues[i]!.kind !== 'sheet') return 1;
  const ends = residues[i + 1]?.kind !== 'sheet';
  if (!ends) return 1;
  return 1.6 * (1 - t);
}

export interface StripGeometry {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

/** Two vertices per frame, two triangles per gap: the flat strip a ribbon is. */
export function stripGeometry(chains: Frame[][]): StripGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (const frames of chains) {
    const base = positions.length / 3;
    frames.forEach((f, k) => {
      const half = scale(f.side, f.width);
      const left = sub(f.center, half);
      const right = add(f.center, half);
      positions.push(left[0], left[1], left[2], right[0], right[1], right[2]);
      const c = f.color;
      colors.push(c[0], c[1], c[2], c[0], c[1], c[2]);
      if (k > 0) {
        const a = base + 2 * (k - 1);
        // a chain is one strip; separate chains never share a triangle
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
  }
  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
  };
}
