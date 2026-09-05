/**
 * Graph helpers over a StructureDoc plus distance-based bond perception. The bonding rule is the
 * same as the backend (`atomscope.chem.bonds`): bonded when d < tolerance * (r_i + r_j).
 */
import { elementBySymbol } from './elements';
import { distance } from './geometry';
import type { Bond, StructureDoc } from './structure';

export const BOND_TOLERANCE = 1.15;

/** Neighbor atom indices for every atom. */
export function adjacency(doc: StructureDoc): number[][] {
  const adj: number[][] = doc.atoms.map(() => []);
  for (const b of doc.bonds) {
    adj[b.a]?.push(b.b);
    adj[b.b]?.push(b.a);
  }
  return adj;
}

/** Indices of bonds touching `atom`. */
export function bondsOfAtom(doc: StructureDoc, atom: number): number[] {
  const out: number[] = [];
  doc.bonds.forEach((b, i) => {
    if (b.a === atom || b.b === atom) out.push(i);
  });
  return out;
}

/** Index of the bond between `a` and `b`, or -1. */
export function findBond(doc: StructureDoc, a: number, b: number): number {
  return doc.bonds.findIndex((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
}

/** Connected component containing `start`, optionally ignoring one bond (index). */
export function fragmentOf(doc: StructureDoc, start: number, ignoreBond = -1): Set<number> {
  const adj: number[][] = doc.atoms.map(() => []);
  doc.bonds.forEach((b, i) => {
    if (i === ignoreBond) return;
    adj[b.a]?.push(b.b);
    adj[b.b]?.push(b.a);
  });
  const seen = new Set<number>([start]);
  const stack = [start];
  while (stack.length) {
    const i = stack.pop()!;
    for (const j of adj[i] ?? []) {
      if (!seen.has(j)) {
        seen.add(j);
        stack.push(j);
      }
    }
  }
  return seen;
}

/** All connected components (each sorted ascending). */
export function fragments(doc: StructureDoc): number[][] {
  const adj = adjacency(doc);
  const comp = new Int32Array(doc.atoms.length).fill(-1);
  const out: number[][] = [];
  for (let s = 0; s < doc.atoms.length; s++) {
    if (comp[s] !== -1) continue;
    const members: number[] = [];
    const stack = [s];
    comp[s] = out.length;
    while (stack.length) {
      const i = stack.pop()!;
      members.push(i);
      for (const j of adj[i] ?? []) {
        if (comp[j] === -1) {
          comp[j] = out.length;
          stack.push(j);
        }
      }
    }
    out.push(members.sort((x, y) => x - y));
  }
  return out;
}

/**
 * Atoms on the `atom` side of bond `bondIndex` when that bond is cut. For a ring bond both ends
 * stay connected, so only `atom` itself is returned.
 */
export function sideOfBond(doc: StructureDoc, bondIndex: number, atom: number): Set<number> {
  const bond = doc.bonds[bondIndex];
  if (!bond) return new Set([atom]);
  const other = bond.a === atom ? bond.b : bond.a;
  const side = fragmentOf(doc, atom, bondIndex);
  return side.has(other) ? new Set([atom]) : side;
}

/** Bonds `atom` should have to existing atoms by the distance rule (excluding already-bonded). */
export function perceiveBondsForAtom(
  doc: StructureDoc,
  atom: number,
  tolerance = BOND_TOLERANCE,
): Bond[] {
  const me = doc.atoms[atom];
  if (!me) return [];
  const rMe = elementBySymbol(me.element).covalentRadius;
  const out: Bond[] = [];
  doc.atoms.forEach((other, j) => {
    if (j === atom || findBond(doc, atom, j) >= 0) return;
    const cutoff = tolerance * (rMe + elementBySymbol(other.element).covalentRadius);
    if (distance(me.position, other.position) < cutoff) {
      out.push({ a: Math.min(atom, j), b: Math.max(atom, j), order: 1, aromatic: false });
    }
  });
  return out;
}
