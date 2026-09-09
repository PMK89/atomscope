/**
 * Ring perception: the smallest set of smallest rings (SSSR), which is what Avogadro's Ring
 * engine fills in.
 *
 * A molecule's cycle space has dimension |bonds| - |atoms| + |components| -- the cyclomatic
 * number -- and that is exactly how many rings the answer has. Naphthalene's cycle space is
 * two-dimensional, so it is two six-rings and not three (the twelve-membered perimeter is their
 * sum, and adding it would be drawing the same electrons twice).
 *
 * The method is the usual one: take the smallest ring through each bond, then keep them in
 * increasing size while each is linearly independent over GF(2) of the ones already kept, until
 * the cycle space is spanned. The independence check is what rules out the perimeter.
 */

import type { StructureDoc } from './structure';

export interface Ring {
  /** atom indices in cyclic order, so consecutive entries are bonded */
  atoms: number[];
}

/** Shortest path from `from` to `to` through the adjacency, never using `banned` bond. */
function shortestPath(
  adjacency: { atom: number; bond: number }[][],
  from: number,
  to: number,
  banned: number,
): number[] | null {
  const previous = new Map<number, number>([[from, -1]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!;
    if (at === to) break;
    for (const step of adjacency[at] ?? []) {
      if (step.bond === banned || previous.has(step.atom)) continue;
      previous.set(step.atom, at);
      queue.push(step.atom);
    }
  }
  if (!previous.has(to)) return null;
  const path: number[] = [];
  for (let at = to; at !== -1; at = previous.get(at)!) path.push(at);
  return path;
}

/**
 * The SSSR of a structure. Only the bonds matter, so the answer changes on an edit and not when
 * the atoms move -- a caller may hold on to it across a trajectory frame or a drag.
 */
export function findRings(structure: StructureDoc): Ring[] {
  const n = structure.atoms.length;
  const bonds = structure.bonds;
  const adjacency: { atom: number; bond: number }[][] = structure.atoms.map(() => []);
  bonds.forEach((bond, index) => {
    adjacency[bond.a]?.push({ atom: bond.b, bond: index });
    adjacency[bond.b]?.push({ atom: bond.a, bond: index });
  });

  // how many independent rings there are: |E| - |V| + |components|
  const seen = new Array<boolean>(n).fill(false);
  let components = 0;
  for (let i = 0; i < n; i++) {
    if (seen[i]) continue;
    components++;
    const stack = [i];
    seen[i] = true;
    while (stack.length) {
      const at = stack.pop()!;
      for (const step of adjacency[at] ?? []) {
        if (!seen[step.atom]) {
          seen[step.atom] = true;
          stack.push(step.atom);
        }
      }
    }
  }
  const wanted = bonds.length - n + components;
  if (wanted <= 0) return [];

  /** the smallest ring through each bond, as its atom cycle and its bond set */
  const candidates: { atoms: number[]; mask: bigint }[] = [];
  const bondIndex = new Map<string, number>();
  bonds.forEach((bond, index) => {
    bondIndex.set(`${Math.min(bond.a, bond.b)}-${Math.max(bond.a, bond.b)}`, index);
  });
  const maskOf = (cycle: number[]): bigint => {
    let mask = 0n;
    for (let i = 0; i < cycle.length; i++) {
      const a = cycle[i]!;
      const b = cycle[(i + 1) % cycle.length]!;
      const index = bondIndex.get(`${Math.min(a, b)}-${Math.max(a, b)}`);
      if (index === undefined) return 0n; // not a closed cycle of real bonds
      mask |= 1n << BigInt(index);
    }
    return mask;
  };
  bonds.forEach((bond, index) => {
    const path = shortestPath(adjacency, bond.a, bond.b, index);
    if (!path || path.length < 3) return;
    const mask = maskOf(path);
    if (mask !== 0n) candidates.push({ atoms: path, mask });
  });

  // smallest first, so the rings kept are the smallest ones that span the cycle space
  candidates.sort((a, b) => a.atoms.length - b.atoms.length);

  const out: Ring[] = [];
  /** row-echelon basis of the kept rings' bond vectors, keyed by leading bit */
  const basis = new Map<number, bigint>();
  const leading = (v: bigint): number => v.toString(2).length - 1;
  for (const candidate of candidates) {
    if (out.length >= wanted) break;
    let v = candidate.mask;
    while (v !== 0n) {
      const row = basis.get(leading(v));
      if (row === undefined) break;
      v ^= row;
    }
    // reduced to zero: this ring is the sum of ones already kept (naphthalene's perimeter)
    if (v === 0n) continue;
    basis.set(leading(v), v);
    out.push({ atoms: candidate.atoms });
  }
  return out;
}

/**
 * Avogadro's ring colours, indexed by ring size (`ringengine.cpp:44-51`): red for three, green
 * for four, blue for five, magenta for six and yellow for everything larger.
 */
export const RING_COLORS: readonly [number, number, number][] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 0],
];

export function ringColor(size: number): [number, number, number] {
  const index = Math.min(RING_COLORS.length - 1, Math.max(0, size - 3));
  return [...RING_COLORS[index]!];
}
