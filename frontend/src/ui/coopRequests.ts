/**
 * Overlap populations for the bonds someone has selected.
 *
 * A COOP is between two *orbitals*, and choosing which orbitals is a chemical decision, not a
 * mechanical one. This makes the choice the tutorial makes for its own O-H example (ch. 3.5): a
 * hybrid on the heavier partner pointing along the bond, and the s orbital on hydrogen. It is a
 * default, not an answer -- a d-block atom in a crystal field wants a named d orbital instead,
 * which is what the `orbital_weights` and `coops` inputs are for.
 */
import type { Bond, StructureDoc } from '../model/structure';

/** Orbital types `!ORB` accepts, from the tutorial's paw_dos cheat sheet (app. A.4). */
export type OrbitalType =
  | 'S'
  | 'PX'
  | 'PY'
  | 'PZ'
  | 'DXY'
  | 'DXZ'
  | 'DYZ'
  | 'D3Z2-R2'
  | 'DX2-Y2'
  | 'SP'
  | 'SP2'
  | 'SP3';

export interface CoopRequest {
  id: string;
  label: string;
  first: { atom: number; type: OrbitalType; toward: number };
  second: { atom: number; type: OrbitalType; toward: number };
}

/** Hydrogen and helium have only s; everything else gets a hybrid along the bond. */
function orbitalFor(element: string): OrbitalType {
  return element === 'H' || element === 'He' ? 'S' : 'SP3';
}

/** A file-name-safe id: the .dos file is named after it. */
function idFor(doc: StructureDoc, a: number, b: number): string {
  const name = (i: number): string => `${doc.atoms[i]?.element ?? 'X'}${i + 1}`;
  return `coop-${name(a)}-${name(b)}`.replace(/[^A-Za-z0-9_.-]/g, '');
}

export function coopsForBonds(
  doc: StructureDoc,
  bondIndices: ReadonlySet<number>,
): CoopRequest[] {
  const out: CoopRequest[] = [];
  const seen = new Set<string>();
  for (const index of [...bondIndices].sort((x, y) => x - y)) {
    const bond: Bond | undefined = doc.bonds[index];
    if (!bond) continue;
    const [a, b] = [bond.a, bond.b];
    const first = doc.atoms[a];
    const second = doc.atoms[b];
    if (!first || !second) continue;
    const id = idFor(doc, a, b);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: `${first.element}${a + 1} ${orbitalFor(first.element).toLowerCase()} – ${second.element}${b + 1} ${orbitalFor(second.element).toLowerCase()}`,
      first: { atom: a, type: orbitalFor(first.element), toward: b },
      second: { atom: b, type: orbitalFor(second.element), toward: a },
    });
  }
  return out;
}
