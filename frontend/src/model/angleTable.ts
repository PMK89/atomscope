/**
 * Rows for the angle and torsion property tables (Avogadro's Angle and Torsion Properties
 * dialogs, as sections of the Properties tab).
 *
 * An angle is every pair of bonds that share an atom; a torsion is every bond with a neighbour at
 * each end. Both are editable: the far side of the second bond is the one that turns (the `c` side
 * of an angle, the `c`-`d` side of a torsion), and a value in a ring cannot be driven at all,
 * because rotating one side about the axis would tear the ring open.
 */
import { bondAdjacency, bondAdjacencyOf, fragmentIn, type BondAdjacency } from './connectivity';
import { angleDeg, dihedralDeg } from './geometry';
import type { StructureDoc } from './structure';

export interface AngleRow {
  /** the three atoms, `b` being the vertex */
  a: number;
  b: number;
  c: number;
  /** "C1—O2—H3", in the numbering the labels use */
  label: string;
  /** degrees, from the positions as they are */
  value: number;
  /** the atoms that move when the value is typed, or null when nothing can move */
  moving: number[] | null;
  /** the three atoms are in a line: there is no plane to turn in, whatever the connectivity */
  straight: boolean;
}

export interface TorsionRow {
  a: number;
  b: number;
  c: number;
  d: number;
  label: string;
  /** degrees, IUPAC sign */
  value: number;
  moving: number[] | null;
  /** the torsion turns about a bond that closes a ring, so it cannot be driven */
  ring: boolean;
}

/** How many rows either table builds at once; each one walks the molecule to find its side. */
export const MAX_ANGLE_ROWS = 200;

/** Above this many atoms the tables wait for a selection rather than enumerating everything. */
export const AUTO_TABLE_ATOMS = 500;

const label = (doc: StructureDoc, atoms: number[]): string =>
  atoms.map((i) => `${doc.atoms[i]!.element}${i + 1}`).join('—');

/**
 * The atoms that move when a value about the bond `bond` is changed: the side of it that holds
 * `keep`, or null when both ends are in one piece (a ring), where nothing can move.
 */
function sideOf(adj: BondAdjacency, bond: number, keep: number, other: number): number[] | null {
  const side = fragmentIn(adj, keep, bond);
  if (side.has(other)) return null;
  return [...side];
}

/** Every angle whose vertex or ends are in `only` (or every angle), capped at `MAX_ANGLE_ROWS`. */
export function angleRows(doc: StructureDoc, only?: ReadonlySet<number>): AngleRow[] {
  const adj = bondAdjacency(doc);
  const out: AngleRow[] = [];
  const wanted = (atoms: number[]): boolean =>
    !only || only.size === 0 || atoms.some((i) => only.has(i));
  for (let b = 0; b < doc.atoms.length && out.length < MAX_ANGLE_ROWS; b++) {
    const neighbours = adj[b] ?? [];
    for (let i = 0; i < neighbours.length && out.length < MAX_ANGLE_ROWS; i++) {
      for (let j = i + 1; j < neighbours.length && out.length < MAX_ANGLE_ROWS; j++) {
        const [a] = neighbours[i]!;
        const [c, bondC] = neighbours[j]!;
        if (!wanted([a, b, c])) continue;
        const pa = doc.atoms[a]?.position;
        const pb = doc.atoms[b]?.position;
        const pc = doc.atoms[c]?.position;
        if (!pa || !pb || !pc) continue;
        const value = angleDeg(pa, pb, pc);
        // three atoms in a line have no plane to turn in, so the value cannot be driven either
        const straight = value < 1e-6 || value > 180 - 1e-6;
        out.push({
          a,
          b,
          c,
          label: label(doc, [a, b, c]),
          value,
          // the c side turns about the vertex; the a side stays where it is
          moving: straight ? null : sideOf(adj, bondC, c, b),
          straight,
        });
      }
    }
  }
  return out;
}

/** Every torsion about a bond, in the same shape; `a—b—c—d` turns about `b—c`. */
export function torsionRows(doc: StructureDoc, only?: ReadonlySet<number>): TorsionRow[] {
  const adj = bondAdjacency(doc);
  const out: TorsionRow[] = [];
  const wanted = (atoms: number[]): boolean =>
    !only || only.size === 0 || atoms.some((i) => only.has(i));
  for (let bond = 0; bond < doc.bonds.length && out.length < MAX_ANGLE_ROWS; bond++) {
    const { a: b, b: c } = doc.bonds[bond]!;
    const side = sideOf(adj, bond, c, b);
    for (const [a] of adj[b] ?? []) {
      if (a === c) continue;
      for (const [d] of adj[c] ?? []) {
        if (d === b || d === a) continue;
        if (out.length >= MAX_ANGLE_ROWS) return out;
        if (!wanted([a, b, c, d])) continue;
        const p = [a, b, c, d].map((i) => doc.atoms[i]?.position);
        if (p.some((x) => !x)) continue;
        out.push({
          a,
          b,
          c,
          d,
          label: label(doc, [a, b, c, d]),
          value: dihedralDeg(p[0]!, p[1]!, p[2]!, p[3]!),
          moving: side,
          ring: side === null,
        });
      }
    }
  }
  return out;
}

/**
 * How many rows each table would show without the cap. Over the connectivity alone, not the
 * document: the panel is always mounted, so this must not enumerate a protein on every frame of
 * a drag.
 */
export function angleRowCount(
  atomCount: number,
  bonds: StructureDoc['bonds'],
  only?: ReadonlySet<number>,
): number {
  const adj = bondAdjacencyOf(atomCount, bonds);
  let n = 0;
  for (let b = 0; b < atomCount; b++) {
    const neighbours = adj[b] ?? [];
    for (let i = 0; i < neighbours.length; i++) {
      for (let j = i + 1; j < neighbours.length; j++) {
        const atoms = [neighbours[i]![0], b, neighbours[j]![0]];
        if (!only || only.size === 0 || atoms.some((x) => only.has(x))) n++;
      }
    }
  }
  return n;
}

export function torsionRowCount(
  atomCount: number,
  bonds: StructureDoc['bonds'],
  only?: ReadonlySet<number>,
): number {
  const adj = bondAdjacencyOf(atomCount, bonds);
  let n = 0;
  for (const bond of bonds) {
    for (const [a] of adj[bond.a] ?? []) {
      if (a === bond.b) continue;
      for (const [d] of adj[bond.b] ?? []) {
        if (d === bond.a || d === a) continue;
        const atoms = [a, bond.a, bond.b, d];
        if (!only || only.size === 0 || atoms.some((x) => only.has(x))) n++;
      }
    }
  }
  return n;
}
