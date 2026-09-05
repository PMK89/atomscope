/** Text <-> coordinates for the Cartesian editor ("El x y z" per line, XYZ-style). */
import { ELEMENT_BY_SYMBOL } from '../model/elements';
import { perceiveBondsForAtom } from '../model/connectivity';
import type { Bond, StructureDoc, Vec3 } from '../model/structure';
import { makeAtom } from '../model/structure';

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
