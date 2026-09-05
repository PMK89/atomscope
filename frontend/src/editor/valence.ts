/**
 * Minimal client-side valence model for the Draw tool's "adjust hydrogens" option. The backend
 * remains the authority for chemistry; this exists only so drawing feels immediate.
 */
import { elementBySymbol } from '../model/elements';
import { add, cross, normalize, perpendicular, scale, sub } from '../model/geometry';
import type { StructureDoc, Vec3 } from '../model/structure';
import { makeAtom, makeBond } from '../model/structure';
import { removeAtoms } from './edits';

export const VALENCE: Readonly<Record<string, number>> = {
  H: 1,
  C: 4,
  N: 3,
  O: 2,
  F: 1,
  Si: 4,
  P: 3,
  S: 2,
  Cl: 1,
  Br: 1,
  I: 1,
};

const H_BOND_LENGTH: Readonly<Record<string, number>> = { C: 1.09, N: 1.01, O: 0.96 };

export function hydrogenBondLength(element: string): number {
  return (
    H_BOND_LENGTH[element] ??
    elementBySymbol(element).covalentRadius + elementBySymbol('H').covalentRadius
  );
}

/** Ideal angle (radians) between substituents for a given total coordination number. */
function idealAngle(total: number): number {
  if (total <= 2) return Math.PI;
  if (total === 3) return (2 * Math.PI) / 3;
  return Math.acos(-1 / 3); // tetrahedral 109.47°
}

/**
 * Unit vectors for `count` new substituents on a center that already has neighbors in the
 * `existing` unit directions, following linear / trigonal / tetrahedral templates.
 */
export function substituentDirections(existing: Vec3[], count: number): Vec3[] {
  if (count <= 0) return [];
  const total = existing.length + count;
  const alpha = idealAngle(total);
  const out: Vec3[] = [];
  if (existing.length === 0) {
    // template around an arbitrary first direction
    const first: Vec3 = [1, 0, 0];
    out.push(first);
    out.push(...substituentDirections([first], count - 1));
    return out;
  }
  if (existing.length === 1) {
    const u = existing[0]!;
    const p = perpendicular(u);
    const q = cross(u, p);
    for (let k = 0; k < count; k++) {
      const phi = (2 * Math.PI * k) / count;
      const ring = add(scale(p, Math.cos(phi)), scale(q, Math.sin(phi)));
      out.push(normalize(add(scale(u, Math.cos(alpha)), scale(ring, Math.sin(alpha)))));
    }
    return out;
  }
  if (existing.length === 2) {
    const [u1, u2] = existing as [Vec3, Vec3];
    const bisector = normalize(scale(add(u1, u2), -1), perpendicular(u1));
    if (count === 1) return [bisector];
    let n = cross(u1, u2);
    if (Math.hypot(...n) < 1e-6) n = perpendicular(u1);
    n = normalize(n);
    const half = alpha / 2;
    out.push(normalize(add(scale(bisector, Math.cos(half)), scale(n, Math.sin(half)))));
    out.push(normalize(add(scale(bisector, Math.cos(half)), scale(n, -Math.sin(half)))));
    for (let k = 2; k < count; k++) out.push(scale(bisector, 1));
    return out;
  }
  // three or more: point away from the existing substituents
  let sum: Vec3 = [0, 0, 0];
  for (const u of existing) sum = add(sum, u);
  const away = normalize(scale(sum, -1), cross(existing[0]!, existing[1]!));
  for (let k = 0; k < count; k++) out.push(away);
  return out;
}

/** Sum of bond orders and neighbor indices of `atom`. */
function neighborhood(doc: StructureDoc, atom: number): { order: number; neighbors: number[] } {
  let order = 0;
  const neighbors: number[] = [];
  for (const b of doc.bonds) {
    if (b.a === atom) neighbors.push(b.b);
    else if (b.b === atom) neighbors.push(b.a);
    else continue;
    order += b.order;
  }
  return { order, neighbors };
}

/**
 * Add or remove hydrogens on `atom` so its bond-order sum matches the valence table. Elements
 * without a table entry are left alone. Returns the same doc instance when nothing changes.
 */
export function adjustHydrogens(doc: StructureDoc, atom: number): StructureDoc {
  const center = doc.atoms[atom];
  if (!center || center.element === 'H') return doc;
  const valence = VALENCE[center.element];
  if (valence === undefined) return doc;
  const { order, neighbors } = neighborhood(doc, atom);
  const needed = valence - order;
  if (needed === 0) return doc;
  if (needed < 0) {
    const hs = neighbors.filter((j) => doc.atoms[j]?.element === 'H').slice(0, -needed);
    return hs.length ? removeAtoms(doc, hs) : doc;
  }
  const existing = neighbors.map((j) => normalize(sub(doc.atoms[j]!.position, center.position)));
  const dirs = substituentDirections(existing, needed);
  const len = hydrogenBondLength(center.element);
  const atoms = [...doc.atoms];
  const bonds = [...doc.bonds];
  for (const d of dirs) {
    bonds.push(makeBond(atom, atoms.length));
    atoms.push(makeAtom('H', add(center.position, scale(d, len))));
  }
  return { ...doc, atoms, bonds };
}

/** Remove the hydrogen neighbors of `atom` (used before re-adjusting after an element change). */
export function hydrogenNeighbors(doc: StructureDoc, atom: number): number[] {
  return neighborhood(doc, atom).neighbors.filter((j) => doc.atoms[j]?.element === 'H');
}
