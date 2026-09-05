/**
 * Pure document edits used by the editor tools. Every function returns a new StructureDoc (or
 * the same instance when nothing changes); callers pass the result to structureStore.commit.
 */
import { findBond, perceiveBondsForAtom } from '../model/connectivity';
import { add, rotateAbout, scale, sub, normalize, distance } from '../model/geometry';
import type { Bond, StructureDoc, Vec3 } from '../model/structure';
import { centroid, makeAtom, makeBond } from '../model/structure';

/** Append an atom; when `perceiveBonds` is set, single bonds to atoms in range are added too. */
export function addAtom(
  doc: StructureDoc,
  element: string,
  position: Vec3,
  perceiveBonds = false,
): { doc: StructureDoc; index: number } {
  const index = doc.atoms.length;
  let next: StructureDoc = { ...doc, atoms: [...doc.atoms, makeAtom(element, position)] };
  if (perceiveBonds) {
    const extra = perceiveBondsForAtom(next, index);
    if (extra.length) next = { ...next, bonds: [...next.bonds, ...extra] };
  }
  return { doc: next, index };
}

/** Add a bond a-b if absent (or set its order when present). */
export function addBond(
  doc: StructureDoc,
  a: number,
  b: number,
  order: Bond['order'],
): StructureDoc {
  if (a === b) return doc;
  const existing = findBond(doc, a, b);
  if (existing >= 0) return setBondOrder(doc, existing, order);
  return { ...doc, bonds: [...doc.bonds, makeBond(Math.min(a, b), Math.max(a, b), order)] };
}

export function setBondOrder(doc: StructureDoc, bond: number, order: Bond['order']): StructureDoc {
  const b = doc.bonds[bond];
  if (!b || b.order === order) return doc;
  const bonds = [...doc.bonds];
  bonds[bond] = { ...b, order, aromatic: false };
  return { ...doc, bonds };
}

export function cycleBondOrder(doc: StructureDoc, bond: number): StructureDoc {
  const b = doc.bonds[bond];
  if (!b) return doc;
  return setBondOrder(doc, bond, b.order === 3 ? 1 : ((b.order + 1) as Bond['order']));
}

export function removeBond(doc: StructureDoc, bond: number): StructureDoc {
  if (!doc.bonds[bond]) return doc;
  return { ...doc, bonds: doc.bonds.filter((_, i) => i !== bond) };
}

export function setElement(doc: StructureDoc, atom: number, element: string): StructureDoc {
  const a = doc.atoms[atom];
  if (!a || a.element === element) return doc;
  const atoms = [...doc.atoms];
  atoms[atom] = { ...a, element };
  return { ...doc, atoms };
}

export function setPositions(
  doc: StructureDoc,
  positions: ReadonlyMap<number, Vec3>,
): StructureDoc {
  if (positions.size === 0) return doc;
  const atoms = doc.atoms.map((a, i) => {
    const p = positions.get(i);
    return p ? { ...a, position: p } : a;
  });
  return { ...doc, atoms };
}

/** Remove atoms (and their bonds), remapping the remaining bond indices. */
export function removeAtoms(doc: StructureDoc, indices: Iterable<number>): StructureDoc {
  const gone = new Set(indices);
  if (gone.size === 0) return doc;
  const remap = new Int32Array(doc.atoms.length).fill(-1);
  let n = 0;
  for (let i = 0; i < doc.atoms.length; i++) if (!gone.has(i)) remap[i] = n++;
  const atoms = doc.atoms.filter((_, i) => !gone.has(i));
  const bonds = doc.bonds
    .filter((b) => !gone.has(b.a) && !gone.has(b.b))
    .map((b) => ({ ...b, a: remap[b.a]!, b: remap[b.b]! }));
  return { ...doc, atoms, bonds, ...reindexed(doc, remap) };
}

/**
 * Residues and constraints after a removal: everything that refers to an atom by index has to be
 * renumbered with it, or it starts describing a different atom. A residue that lost every atom
 * and a constraint that lost any of its atoms are dropped.
 */
function reindexed(
  doc: StructureDoc,
  remap: Int32Array,
): Pick<StructureDoc, 'residues' | 'constraints'> {
  const residues = doc.residues
    .map((r) => ({
      ...r,
      atom_indices: r.atom_indices.map((i) => remap[i]!).filter((i) => i >= 0),
    }))
    .filter((r) => r.atom_indices.length > 0);
  const kept = (i: number): boolean => remap[i] !== undefined && remap[i]! >= 0;
  type Constraint = StructureDoc['constraints'][number];
  const constraints = doc.constraints.flatMap((c): Constraint[] => {
    // a constraint over a set of atoms keeps those that remain; one that ties specific atoms
    // together (a bond, an angle, a torsion) goes as soon as one of them does
    if (c.kind === 'fix_atoms' || c.kind === 'ignore_atoms') {
      const keptIndices = c.indices.filter(kept).map((i) => remap[i]!);
      return keptIndices.length ? [{ ...c, indices: keptIndices }] : [];
    }
    if (c.kind === 'fix_cartesian') {
      return kept(c.index) ? [{ ...c, index: remap[c.index]! }] : [];
    }
    if (c.kind === 'fix_bond_length') {
      return kept(c.a) && kept(c.b) ? [{ ...c, a: remap[c.a]!, b: remap[c.b]! }] : [];
    }
    if (c.kind === 'fix_angle') {
      return kept(c.a) && kept(c.b) && kept(c.c)
        ? [{ ...c, a: remap[c.a]!, b: remap[c.b]!, c: remap[c.c]! }]
        : [];
    }
    return kept(c.a) && kept(c.b) && kept(c.c) && kept(c.d)
      ? [{ ...c, a: remap[c.a]!, b: remap[c.b]!, c: remap[c.c]!, d: remap[c.d]! }]
      : [];
  });
  return { residues, constraints };
}

/** Map old atom indices to new ones after `removeAtoms(doc, removed)`; removed ones are dropped. */
export function remapAfterRemoval(
  removed: ReadonlySet<number>,
  indices: Iterable<number>,
): number[] {
  const sortedRemoved = [...removed].sort((a, b) => a - b);
  const out: number[] = [];
  for (const i of indices) {
    if (removed.has(i)) continue;
    let shift = 0;
    for (const r of sortedRemoved) {
      if (r < i) shift++;
      else break;
    }
    out.push(i - shift);
  }
  return out;
}

export function translateAtoms(
  doc: StructureDoc,
  atoms: Iterable<number>,
  delta: Vec3,
): StructureDoc {
  const moved = new Map<number, Vec3>();
  for (const i of atoms) {
    const a = doc.atoms[i];
    if (a) moved.set(i, add(a.position, delta));
  }
  return setPositions(doc, moved);
}

/** Rotate atoms about an axis through `origin` (defaults to the centroid of the moved atoms). */
export function rotateAtoms(
  doc: StructureDoc,
  atoms: Iterable<number>,
  axis: Vec3,
  angleRad: number,
  origin?: Vec3,
): StructureDoc {
  const idx = [...atoms];
  const o = origin ?? centroid(doc, idx);
  const moved = new Map<number, Vec3>();
  for (const i of idx) {
    const a = doc.atoms[i];
    if (a) moved.set(i, rotateAbout(a.position, o, axis, angleRad));
  }
  return setPositions(doc, moved);
}

/** Set the length of a bond by translating the atoms in `movingSide` (which contains one end). */
export function setBondLength(
  doc: StructureDoc,
  bond: number,
  length: number,
  movingSide: Iterable<number>,
): StructureDoc {
  const b = doc.bonds[bond];
  if (!b) return doc;
  const moving = new Set(movingSide);
  const movingEnd = moving.has(b.b) ? b.b : b.a;
  const fixedEnd = movingEnd === b.b ? b.a : b.b;
  const pf = doc.atoms[fixedEnd]!.position;
  const pm = doc.atoms[movingEnd]!.position;
  const current = distance(pf, pm);
  if (current < 1e-9) return doc;
  const dir = normalize(sub(pm, pf));
  return translateAtoms(doc, moving, scale(dir, length - current));
}

/** Position for a new atom bonded to `from` in direction `towards`, at the covalent-radius sum. */
export function bondedPosition(
  doc: StructureDoc,
  from: number,
  towards: Vec3,
  newElement: string,
  radiusOf: (el: string) => number,
): Vec3 {
  const a = doc.atoms[from]!;
  const dir = normalize(sub(towards, a.position));
  return add(a.position, scale(dir, radiusOf(a.element) + radiusOf(newElement)));
}
