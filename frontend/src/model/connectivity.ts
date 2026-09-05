/**
 * Graph helpers over a StructureDoc plus distance-based bond perception. The bonding rule is the
 * same as the backend (`atomscope.chem.bonds`): bonded when d < tolerance * (r_i + r_j), with
 * `d` the minimum-image distance across the periodic directions of the cell.
 */
import { elementBySymbol } from './elements';
import { distance, dot, invert3, mulRow, sub, type Mat3 } from './geometry';
import type { Bond, Cell, StructureDoc, Vec3 } from './structure';

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

/** Neighbour and the bond that leads to it, so a walk can skip one bond without rebuilding. */
export type BondAdjacency = [neighbour: number, bond: number][][];

export function bondAdjacency(doc: StructureDoc): BondAdjacency {
  return bondAdjacencyOf(doc.atoms.length, doc.bonds);
}

/**
 * The same adjacency from the two things it actually depends on. A caller that only needs the
 * connectivity can then memoize on the atom count and the bond array, and moving atoms (a drag,
 * a trajectory frame) costs it nothing: `setPositions` keeps the bond array's identity.
 */
export function bondAdjacencyOf(atomCount: number, bonds: StructureDoc['bonds']): BondAdjacency {
  const adj: BondAdjacency = Array.from({ length: atomCount }, () => []);
  bonds.forEach((b, i) => {
    adj[b.a]?.push([b.b, i]);
    adj[b.b]?.push([b.a, i]);
  });
  return adj;
}

/** Connected component containing `start`, optionally ignoring one bond (index). */
export function fragmentOf(doc: StructureDoc, start: number, ignoreBond = -1): Set<number> {
  return fragmentIn(bondAdjacency(doc), start, ignoreBond);
}

/** The same walk over an adjacency built once: the caller pays for it, not every call. */
export function fragmentIn(adj: BondAdjacency, start: number, ignoreBond = -1): Set<number> {
  const seen = new Set<number>([start]);
  const stack = [start];
  while (stack.length) {
    const i = stack.pop()!;
    for (const [j, bond] of adj[i] ?? []) {
      if (bond === ignoreBond || seen.has(j)) continue;
      seen.add(j);
      stack.push(j);
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

// ---- periodic distances ------------------------------------------------------------------------

/** Cell vectors, their inverse and the periodic flags; null when the structure is not periodic. */
interface Lattice {
  vectors: Mat3;
  inverse: Mat3;
  pbc: Cell['pbc'];
}

function latticeOf(cell: Cell | null): Lattice | null {
  if (!cell) return null;
  const pbc = cell.pbc;
  if (!pbc.some(Boolean)) return null;
  const vectors = cell.vectors as Mat3;
  try {
    return { vectors, inverse: invert3(vectors), pbc };
  } catch {
    return null; // singular cell: fall back to plain Cartesian distances
  }
}

const SHIFTS: readonly number[] = [0, -1, 1];

function distanceIn(a: Vec3, b: Vec3, lattice: Lattice | null): number {
  if (!lattice) return distance(a, b);
  const { vectors, inverse, pbc } = lattice;
  const f = mulRow(sub(b, a), inverse);
  // wrap the fractional difference into [-1/2, 1/2) on the periodic axes
  if (pbc[0]) f[0] -= Math.round(f[0]);
  if (pbc[1]) f[1] -= Math.round(f[1]);
  if (pbc[2]) f[2] -= Math.round(f[2]);
  // the rounded image is the nearest one only for near-orthogonal cells; scanning the adjacent
  // images as well makes this exact for strongly skewed (triclinic) lattices too
  let best = Infinity;
  const range = (k: 0 | 1 | 2): readonly number[] => (pbc[k] ? SHIFTS : [0]);
  for (const s0 of range(0)) {
    for (const s1 of range(1)) {
      for (const s2 of range(2)) {
        const d = mulRow([f[0] + s0, f[1] + s1, f[2] + s2], vectors);
        best = Math.min(best, dot(d, d));
      }
    }
  }
  return Math.sqrt(best);
}

/** Shortest distance between two positions across the cell's periodic directions. */
export function minimumImageDistance(a: Vec3, b: Vec3, cell: Cell | null): number {
  return distanceIn(a, b, latticeOf(cell));
}

/** Bonds `atom` should have to existing atoms by the distance rule (excluding already-bonded). */
export function perceiveBondsForAtom(
  doc: StructureDoc,
  atom: number,
  tolerance = BOND_TOLERANCE,
): Bond[] {
  const me = doc.atoms[atom];
  if (!me) return [];
  const lattice = latticeOf(doc.cell);
  const rMe = elementBySymbol(me.element).covalentRadius;
  // Collect the existing partners once. Calling findBond() inside the loop made this
  // O(atoms x bonds): 58 s for one atom placed in a 100k-atom document (docs/performance.md).
  const bonded = new Set<number>();
  for (const b of doc.bonds) {
    if (b.a === atom) bonded.add(b.b);
    else if (b.b === atom) bonded.add(b.a);
  }
  const out: Bond[] = [];
  doc.atoms.forEach((other, j) => {
    if (j === atom || bonded.has(j)) return;
    const cutoff = tolerance * (rMe + elementBySymbol(other.element).covalentRadius);
    if (distanceIn(me.position, other.position, lattice) < cutoff) {
      out.push({ a: Math.min(atom, j), b: Math.max(atom, j), order: 1, aromatic: false });
    }
  });
  return out;
}
