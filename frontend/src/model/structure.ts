/**
 * Frontend view of the backend Structure. The generated API type marks defaulted fields as
 * optional; `normalizeStructure` fills them so the rest of the UI can rely on required arrays.
 */
import type { components } from '../api/schema';
import { ELEMENT_BY_SYMBOL } from './elements';

export type ApiStructure = Omit<components['schemas']['Structure'], 'id'> & { id?: string };
export type Atom = components['schemas']['Atom'];
export type Bond = components['schemas']['Bond'];
export type Cell = components['schemas']['Cell'];
export type Vec3 = [number, number, number];

export interface StructureDoc {
  id: string;
  name: string;
  atoms: Atom[];
  bonds: Bond[];
  cell: Cell | null;
  charge: number;
  multiplicity: number | null;
  atomic_scalars: NonNullable<ApiStructure['atomic_scalars']>;
  atomic_vectors: NonNullable<ApiStructure['atomic_vectors']>;
  properties: NonNullable<ApiStructure['properties']>;
  constraints: NonNullable<ApiStructure['constraints']>;
  residues: NonNullable<ApiStructure['residues']>;
  provenance: NonNullable<ApiStructure['provenance']> | null;
  /**
   * Named adsorption sites, for a slab built by one of ASE's named surface builders. Carried
   * through opaquely -- and, unlike `provenance`, sent back with the structure
   * (`api/structureBody.ts`), because the adsorbate route needs it to place an adsorbate on a
   * site by name.
   */
  surface: NonNullable<ApiStructure['surface']> | null;
}

export function newUid(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * What a route, a file or a test can hand over: every field optional, because this is the
 * function that fills the blanks in (ids, uids, empty collections).
 */
export type PartialStructure = Partial<ApiStructure>;

/**
 * Keep the previous atom identities when an operation returned the same atoms in order, so a
 * selection, a measurement or an undo entry still refers to the same atoms after an optimization.
 */
export function withUids(next: StructureDoc, previous: StructureDoc): StructureDoc {
  if (next.atoms.length !== previous.atoms.length) return next;
  if (next.atoms.some((a, i) => a.element !== previous.atoms[i]?.element)) return next;
  return {
    ...next,
    id: previous.id,
    atoms: next.atoms.map((a, i) => {
      const uid = previous.atoms[i]?.uid;
      return uid ? { ...a, uid } : a;
    }),
  };
}

export function normalizeStructure(s: PartialStructure): StructureDoc {
  return {
    id: s.id ?? newUid(),
    name: s.name ?? 'untitled',
    atoms: (s.atoms ?? []).map((a) => ({ ...a, uid: a.uid ?? newUid() })),
    bonds: s.bonds ?? [],
    cell: s.cell ?? null,
    charge: s.charge ?? 0,
    multiplicity: s.multiplicity ?? null,
    atomic_scalars: s.atomic_scalars ?? {},
    atomic_vectors: s.atomic_vectors ?? {},
    properties: s.properties ?? {},
    constraints: s.constraints ?? [],
    residues: s.residues ?? [],
    provenance: s.provenance ?? null,
    surface: s.surface ?? null,
  };
}

export function emptyStructure(name = 'untitled'): StructureDoc {
  return normalizeStructure({ name, charge: 0 });
}

export function makeAtom(element: string, position: Vec3, extra: Partial<Atom> = {}): Atom {
  return { element, position, formal_charge: 0, uid: newUid(), ...extra };
}

export function makeBond(a: number, b: number, order: 1 | 2 | 3 = 1): Bond {
  return { a, b, order, aromatic: false };
}

/** Hill-order formula, same rule as the backend. */
export function formula(s: StructureDoc): string {
  const counts = new Map<string, number>();
  for (const a of s.atoms) counts.set(a.element, (counts.get(a.element) ?? 0) + 1);
  let order = [...counts.keys()].sort();
  if (counts.has('C')) {
    order = [
      'C',
      ...(counts.has('H') ? ['H'] : []),
      ...order.filter((e) => e !== 'C' && e !== 'H'),
    ];
  }
  return order.map((e) => `${e}${(counts.get(e) ?? 0) > 1 ? counts.get(e) : ''}`).join('');
}

/**
 * Molecular weight in g/mol: the standard atomic weights of the elements present. Avogadro showed
 * it in the Molecule Properties dialog (molecularpropextension.cpp).
 */
export function molecularWeight(s: StructureDoc): number {
  let total = 0;
  for (const a of s.atoms) total += ELEMENT_BY_SYMBOL.get(a.element)?.mass ?? 0;
  return total;
}

const CHARGE_KEYS = ['partial_charges', 'charges', 'mulliken_charges'];

/** Which scalar property carries the partial charges, if any; the order is the preference. */
export function partialChargeKey(s: StructureDoc): string | null {
  for (const key of CHARGE_KEYS) {
    const property = s.atomic_scalars?.[key];
    if (property && property.values.length === s.atoms.length) return key;
  }
  return null;
}

export function centroid(s: StructureDoc, indices?: Iterable<number>): Vec3 {
  const idx = indices ? [...indices] : s.atoms.map((_, i) => i);
  if (idx.length === 0) return [0, 0, 0];
  const c: Vec3 = [0, 0, 0];
  for (const i of idx) {
    const p = s.atoms[i]?.position;
    if (!p) continue;
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  return [c[0] / idx.length, c[1] / idx.length, c[2] / idx.length];
}

export function boundingRadius(s: StructureDoc, center: Vec3): number {
  let r2 = 0;
  for (const a of s.atoms) {
    const dx = a.position[0] - center[0];
    const dy = a.position[1] - center[1];
    const dz = a.position[2] - center[2];
    r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
  }
  return Math.sqrt(r2);
}
