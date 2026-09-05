/**
 * The document's geometric constraints as the Constraints dialog sees them: one flat list of
 * rows with a kind, the atoms it names and the value it holds them at.
 *
 * The model mirrors ASE (`fix_atoms`, `fix_cartesian`, `fix_bond_length`, `fix_angle`,
 * `fix_dihedral`, plus `ignore_atoms` for Open Babel), which is not the shape a table wants:
 * a single `fix_atoms` can name many atoms and a `fix_cartesian` encodes three axes in a mask.
 * These helpers translate in both directions.
 */
import { angleDeg, dihedralDeg, distance } from '../model/geometry';
import type { StructureDoc, Vec3 } from '../model/structure';

export type Constraint = StructureDoc['constraints'][number];

/** The kinds the dialog offers, in Avogadro's order. */
export const CONSTRAINT_KINDS = [
  { id: 'ignore', label: 'Ignore atom', atoms: 1, unit: '' },
  { id: 'fix', label: 'Fix atom', atoms: 1, unit: '' },
  { id: 'fix_x', label: 'Fix X', atoms: 1, unit: '' },
  { id: 'fix_y', label: 'Fix Y', atoms: 1, unit: '' },
  { id: 'fix_z', label: 'Fix Z', atoms: 1, unit: '' },
  { id: 'distance', label: 'Distance', atoms: 2, unit: 'Å' },
  { id: 'angle', label: 'Angle', atoms: 3, unit: '°' },
  { id: 'torsion', label: 'Torsion', atoms: 4, unit: '°' },
] as const;

export type ConstraintKind = (typeof CONSTRAINT_KINDS)[number]['id'];

export const kindInfo = (kind: ConstraintKind): (typeof CONSTRAINT_KINDS)[number] =>
  CONSTRAINT_KINDS.find((k) => k.id === kind)!;

/** One line of the table. `constraint` is the index in `doc.constraints` it came from. */
export interface ConstraintRow {
  constraint: number;
  kind: ConstraintKind;
  atoms: number[];
  /** the value the user asked for, or null when the constraint follows the geometry */
  value: number | null;
  /** what the geometry has now, for the kinds that have a value at all */
  current: number | null;
}

const AXES = ['fix_x', 'fix_y', 'fix_z'] as const;

/** The rows for one constraint: a `fix_atoms` over three atoms is three rows, one each. */
function rowsOf(c: Constraint, at: number, doc: StructureDoc): ConstraintRow[] {
  const row = (kind: ConstraintKind, atoms: number[], value: number | null): ConstraintRow => ({
    constraint: at,
    kind,
    atoms,
    value,
    current: currentValue(doc, kind, atoms),
  });
  switch (c.kind) {
    case 'fix_atoms':
      return c.indices.map((i) => row('fix', [i], null));
    case 'ignore_atoms':
      return c.indices.map((i) => row('ignore', [i], null));
    case 'fix_cartesian':
      return c.mask.every((m) => m)
        ? [row('fix', [c.index], null)]
        : c.mask.flatMap((m, i) => (m ? [row(AXES[i]!, [c.index], null)] : []));
    case 'fix_bond_length':
      return [row('distance', [c.a, c.b], c.value ?? null)];
    case 'fix_angle':
      return [row('angle', [c.a, c.b, c.c], c.value ?? null)];
    default:
      return [row('torsion', [c.a, c.b, c.c, c.d], c.value ?? null)];
  }
}

/** Every constraint of the document as table rows. */
export const constraintRows = (doc: StructureDoc): ConstraintRow[] =>
  doc.constraints.flatMap((c, i) => rowsOf(c, i, doc));

/** What the geometry has now for a distance, angle or torsion; null for the other kinds. */
export function currentValue(
  doc: StructureDoc,
  kind: ConstraintKind,
  atoms: number[],
): number | null {
  const p: (Vec3 | undefined)[] = atoms.map((i) => doc.atoms[i]?.position);
  const [a, b, c, d] = p;
  if (kind === 'distance') return a && b ? distance(a, b) : null;
  if (kind === 'angle') return a && b && c ? angleDeg(a, b, c) : null;
  if (kind === 'torsion') return a && b && c && d ? dihedralDeg(a, b, c, d) : null;
  return null;
}

/** A constraint of `kind` over `atoms`, or an error message explaining why it cannot be made. */
export function makeConstraint(
  doc: StructureDoc,
  kind: ConstraintKind,
  atoms: number[],
  value: number | null,
): Constraint | string {
  const info = kindInfo(kind);
  if (atoms.length !== info.atoms) {
    const n = info.atoms;
    return `${info.label} needs ${n} atom${n === 1 ? '' : 's'}, got ${atoms.length}`;
  }
  if (atoms.some((i) => !Number.isInteger(i) || i < 0 || i >= doc.atoms.length)) {
    return `atom numbers must be between 1 and ${doc.atoms.length}`;
  }
  if (new Set(atoms).size !== atoms.length) return 'the same atom cannot appear twice';
  const [a, b, c, d] = atoms as [number, number, number, number];
  switch (kind) {
    case 'ignore':
      return { kind: 'ignore_atoms', indices: [a] };
    case 'fix':
      return { kind: 'fix_atoms', indices: [a] };
    case 'fix_x':
    case 'fix_y':
    case 'fix_z':
      return {
        kind: 'fix_cartesian',
        index: a,
        mask: AXES.map((axis) => axis === kind) as [boolean, boolean, boolean],
      };
    case 'distance':
      return { kind: 'fix_bond_length', a, b, value };
    case 'angle':
      return { kind: 'fix_angle', a, b, c, value };
    default:
      return { kind: 'fix_dihedral', a, b, c, d, value };
  }
}

/** Identity of a row: the rows are rebuilt from the document, so object identity says nothing. */
export const rowKey = (r: ConstraintRow): string =>
  `${r.constraint}|${r.kind}|${r.atoms.join('-')}`;

/** The document's constraints without the rows in `rows`. */
export function withoutRows(doc: StructureDoc, rows: ConstraintRow[]): Constraint[] {
  const out: Constraint[] = [];
  const dropped = new Set(rows.map(rowKey));
  const touched = new Set(rows.map((r) => r.constraint));
  doc.constraints.forEach((c, i) => {
    if (!touched.has(i)) {
      out.push(c);
      return;
    }
    // a constraint that names several atoms survives with the atoms whose rows stayed
    const kept = rowsOf(c, i, doc).filter((r) => !dropped.has(rowKey(r)));
    if (kept.length === 0) return;
    for (const r of kept) {
      const made = makeConstraint(doc, r.kind, r.atoms, r.value);
      if (typeof made !== 'string') out.push(made);
    }
  });
  return out;
}

/** The document's constraints with the value of one row changed (null = follow the geometry). */
export function withRowValue(
  doc: StructureDoc,
  row: ConstraintRow,
  value: number | null,
): Constraint[] {
  return doc.constraints.map((c, i) => {
    if (i !== row.constraint) return c;
    if (c.kind === 'fix_bond_length' || c.kind === 'fix_angle' || c.kind === 'fix_dihedral') {
      return { ...c, value };
    }
    return c;
  });
}

/** Constraints as a JSON file (Avogadro's Save), and back (Load). */
export const constraintsJson = (constraints: readonly Constraint[]): string =>
  `${JSON.stringify({ atomscope_constraints: 1, constraints }, null, 2)}\n`;

const KINDS = new Set([
  'fix_atoms',
  'fix_cartesian',
  'fix_bond_length',
  'fix_angle',
  'fix_dihedral',
  'ignore_atoms',
]);

/** Constraints from a file written by `constraintsJson`; throws on anything else. */
export function parseConstraintsJson(text: string): Constraint[] {
  const data: unknown = JSON.parse(text);
  const list = (data as { constraints?: unknown })?.constraints;
  if (!Array.isArray(list)) throw new Error('no constraints in this file');
  for (const c of list) {
    const kind = (c as { kind?: unknown })?.kind;
    if (typeof kind !== 'string' || !KINDS.has(kind)) {
      throw new Error(`unknown constraint ${JSON.stringify(kind)}`);
    }
  }
  return list as Constraint[];
}
