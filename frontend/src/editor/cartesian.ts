/** Text <-> coordinates for the Cartesian editor ("El x y z" per line, XYZ-style). */
import { ELEMENT_BY_SYMBOL } from '../model/elements';
import { perceiveBondsForAtom } from '../model/connectivity';
import type { Bond, StructureDoc, Vec3 } from '../model/structure';
import { makeAtom } from '../model/structure';
import { invert3, mulRow, type Mat3 } from '../model/geometry';

/** What the numbers in the editor mean (Avogadro's Units box: Angstrom / Bohr / Fractional). */
export type CoordinateUnit = 'angstrom' | 'bohr' | 'fractional';

export const UNIT_LABELS: Record<CoordinateUnit, string> = {
  angstrom: 'Ångström',
  bohr: 'Bohr',
  fractional: 'Fractional',
};

/** CODATA-ish, and the same constant Avogadro uses (cartesianextension.cpp:45). */
export const BOHR_TO_ANGSTROM = 0.529177249;

export function formatCartesian(doc: StructureDoc, digits = 5): string {
  return doc.atoms
    .map(
      (a) =>
        `${a.element.padEnd(2)} ${a.position.map((x) => x.toFixed(digits).padStart(12)).join(' ')}`,
    )
    .join('\n');
}

export type ParsedLine = { element: string; position: Vec3 };

/** Parse lines of "El x y z"; blank lines are skipped. Throws with a 1-based line number. */
export function parseCartesian(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(/[\s,;]+/);
    if (parts.length < 4) throw new Error(`line ${i + 1}: expected "El x y z"`);
    const symbol = normalizeSymbol(parts[0]!);
    if (!ELEMENT_BY_SYMBOL.has(symbol))
      throw new Error(`line ${i + 1}: unknown element "${parts[0]}"`);
    const nums = parts.slice(1, 4).map(Number);
    if (nums.some((n) => !Number.isFinite(n))) throw new Error(`line ${i + 1}: bad coordinate`);
    out.push({ element: symbol, position: nums as Vec3 });
  });
  return out;
}

/** Accept "c", "CL", "6" (atomic number) and return the canonical symbol. */
export function normalizeSymbol(input: string): string {
  const t = input.trim();
  if (/^\d+$/.test(t)) {
    const z = Number(t);
    for (const el of ELEMENT_BY_SYMBOL.values()) if (el.number === z) return el.symbol;
    return t;
  }
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/**
 * Apply parsed lines: with an unchanged atom count, positions/elements are updated in place
 * (uids and bonds kept); otherwise atoms are replaced and bonds re-perceived.
 */
export function applyCartesian(doc: StructureDoc, lines: ParsedLine[]): StructureDoc {
  if (lines.length === doc.atoms.length) {
    const atoms = doc.atoms.map((a, i) => ({ ...a, ...lines[i]! }));
    return { ...doc, atoms };
  }
  const atoms = lines.map((l) => makeAtom(l.element, l.position));
  let next: StructureDoc = { ...doc, atoms, bonds: [] };
  const bonds: Bond[] = [];
  for (let i = 0; i < atoms.length; i++) {
    for (const b of perceiveBondsForAtom(next, i)) if (b.a === i) bonds.push(b);
  }
  next = { ...next, bonds };
  return next;
}

/** The document's coordinates in `unit`. Fractional needs a cell and is empty without one. */
export function formatCoordinates(doc: StructureDoc, unit: CoordinateUnit, digits = 5): string {
  if (unit === 'fractional') {
    if (!doc.cell) return '';
    let inverse: Mat3;
    try {
      inverse = invert3(doc.cell.vectors as Mat3);
    } catch {
      return ''; // a singular cell has no fractional coordinates to show
    }
    return doc.atoms
      .map(
        (a) =>
          `${a.element.padEnd(2)} ${mulRow(a.position as Vec3, inverse)
            .map((x) => x.toFixed(digits).padStart(12))
            .join(' ')}`,
      )
      .join('\n');
  }
  if (unit === 'angstrom') return formatCartesian(doc, digits);
  return doc.atoms
    .map(
      (a) =>
        `${a.element.padEnd(2)} ${a.position
          .map((x) => (x / BOHR_TO_ANGSTROM).toFixed(digits).padStart(12))
          .join(' ')}`,
    )
    .join('\n');
}

/**
 * Parse the editor's text as `unit`, always returning Ångström, which is what the document holds.
 * Fractional coordinates without a cell are refused rather than read as Ångström: 0.5 0.5 0.5
 * means something quite different in each.
 */
export function parseCoordinates(
  text: string,
  unit: CoordinateUnit,
  cell: StructureDoc['cell'],
): ParsedLine[] {
  if (unit === 'fractional') {
    if (!cell) throw new Error('fractional coordinates need a unit cell');
    return parseCartesian(text).map((l) => ({
      ...l,
      position: mulRow(l.position, cell.vectors as Mat3),
    }));
  }
  const lines = parseCartesian(text);
  if (unit === 'angstrom') return lines;
  return lines.map((l) => ({
    ...l,
    position: l.position.map((x) => x * BOHR_TO_ANGSTROM) as Vec3,
  }));
}
