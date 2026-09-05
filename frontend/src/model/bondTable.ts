/**
 * Rows for the bond properties table: what a bond is between, its order, whether it can rotate
 * and how long it is. Avogadro's Bond Properties dialog, as a section of the Properties tab.
 */
import { fragmentOf } from './connectivity';
import { distance } from './geometry';
import type { StructureDoc } from './structure';

export interface BondRow {
  index: number;
  a: number;
  b: number;
  /** "C1—O3", in the numbering the labels use */
  label: string;
  order: StructureDoc['bonds'][number]['order'];
  aromatic: boolean;
  /** cutting the bond leaves the molecule in one piece: it closes a ring */
  ring: boolean;
  /** a single, non-aromatic, non-ring bond between two atoms that both carry something else */
  rotatable: boolean;
  length: number;
}

/** How many rows the table builds at once; each ring test walks the molecule. */
export const MAX_BOND_ROWS = 200;

function row(doc: StructureDoc, index: number, degree: readonly number[]): BondRow | null {
  const b = doc.bonds[index];
  const pa = b && doc.atoms[b.a]?.position;
  const pb = b && doc.atoms[b.b]?.position;
  if (!b || !pa || !pb) return null;
  const ring = fragmentOf(doc, b.a, index).has(b.b);
  const terminal = (degree[b.a] ?? 0) < 2 || (degree[b.b] ?? 0) < 2;
  return {
    index,
    a: b.a,
    b: b.b,
    label: `${doc.atoms[b.a]!.element}${b.a + 1}—${doc.atoms[b.b]!.element}${b.b + 1}`,
    order: b.order,
    aromatic: !!b.aromatic,
    ring,
    rotatable: b.order === 1 && !b.aromatic && !ring && !terminal,
    length: distance(pa, pb),
  };
}

/**
 * The table's rows. With `only` given, just the bonds touching those atoms; the result is capped
 * at `MAX_BOND_ROWS` because the ring test is a walk of the molecule per bond.
 */
export function bondRows(doc: StructureDoc, only?: ReadonlySet<number>): BondRow[] {
  const degree = new Array<number>(doc.atoms.length).fill(0);
  for (const b of doc.bonds) {
    degree[b.a] = (degree[b.a] ?? 0) + 1;
    degree[b.b] = (degree[b.b] ?? 0) + 1;
  }
  const out: BondRow[] = [];
  for (let i = 0; i < doc.bonds.length && out.length < MAX_BOND_ROWS; i++) {
    const b = doc.bonds[i]!;
    if (only && only.size > 0 && !only.has(b.a) && !only.has(b.b)) continue;
    const r = row(doc, i, degree);
    if (r) out.push(r);
  }
  return out;
}

/** How many bonds the table would show if it had no cap. */
export function bondRowCount(doc: StructureDoc, only?: ReadonlySet<number>): number {
  if (!only || only.size === 0) return doc.bonds.length;
  return doc.bonds.filter((b) => only.has(b.a) || only.has(b.b)).length;
}
