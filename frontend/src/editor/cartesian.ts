/** Text <-> coordinates for the Cartesian editor ("El x y z" per line, XYZ-style). */
import { ELEMENT_BY_SYMBOL } from '../model/elements';
import { perceiveBondsForAtom } from '../model/connectivity';
import type { Bond, StructureDoc, Vec3 } from '../model/structure';
import { makeAtom } from '../model/structure';
import { invert3, mulRow, type Mat3 } from '../model/geometry';

/**
 * The Sort box of Avogadro's Cartesian editor: none, by element, or by one coordinate
 * (cartesianextension.h:59-65). By element means heaviest first, which is the order it sorted in
 * (its key was the negated atomic number) and the order an XYZ file is usually written in.
 *
 * Here it is an operation on the structure rather than on the text. Avogadro sorted the text and
 * rebuilt the molecule from it on Apply, perceiving the bonds again from the distances; this
 * document keeps bonds, per-atom properties, constraints and residues by atom index, so a sorted
 * *text* applied line by line would hand every one of them to the wrong atom.
 */
export type SortKey = 'none' | 'element' | 'x' | 'y' | 'z';

export const SORT_LABELS: Record<SortKey, string> = {
  none: '(none)',
  element: 'Element',
  x: 'x',
  y: 'y',
  z: 'z',
};

/** The order the atoms would be in, sorted by `key`: `order[i]` is the old index of new atom i. */
export function sortedOrder(doc: StructureDoc, key: SortKey): number[] {
  const order = doc.atoms.map((_, i) => i);
  if (key === 'none') return order;
  const axis = { x: 0, y: 1, z: 2 } as const;
  const value = (i: number): number => {
    const atom = doc.atoms[i]!;
    if (key === 'element') return -(ELEMENT_BY_SYMBOL.get(atom.element)?.number ?? 0);
    return atom.position[axis[key]]!;
  };
  // a stable sort, so atoms of one element keep the order the user put them in
  return order.sort((a, b) => value(a) - value(b));
}

/**
 * The Format box of Avogadro's Cartesian editor (cartesianextension.h:49-57): the same numbers
 * in the column layout one program or another wants. They are layouts, not file formats -- none
 * of them is a complete input deck, and the deck writers live in the calculation backends.
 */
export type CoordinateFormat =
  'xyz' | 'xyz_numbered' | 'coords' | 'gamess' | 'gamess_name' | 'turbomole' | 'priroda';

export const FORMAT_LABELS: Record<CoordinateFormat, string> = {
  xyz: 'XYZ',
  xyz_numbered: 'XYZ with numbers',
  coords: 'XYZ, coordinates only',
  gamess: 'GAMESS input',
  gamess_name: 'GAMESS input #2',
  turbomole: 'Turbomole input',
  priroda: 'Priroda input',
};

/** What the numbers in the editor mean (Avogadro's Units box: Angstrom / Bohr / Fractional). */
export type CoordinateUnit = 'angstrom' | 'bohr' | 'fractional';

export const UNIT_LABELS: Record<CoordinateUnit, string> = {
  angstrom: 'Ångström',
  bohr: 'Bohr',
  fractional: 'Fractional',
};

/** CODATA-ish, and the same constant Avogadro uses (cartesianextension.cpp:45). */
export const BOHR_TO_ANGSTROM = 0.529177249;

/** One line of the editor: the coordinates already converted, laid out as `format` wants them. */
function coordinateLine(
  element: string,
  index: number,
  position: readonly number[],
  format: CoordinateFormat,
  digits: number,
): string {
  const numbers = position.map((x) => x.toFixed(digits).padStart(12)).join(' ');
  const z = ELEMENT_BY_SYMBOL.get(element)?.number ?? 0;
  switch (format) {
    case 'coords':
      return numbers;
    case 'xyz_numbered':
      return `${(element + String(index + 1)).padEnd(5)} ${numbers}`;
    case 'gamess':
      return `${element.padEnd(2)} ${`${z}.0`.padStart(6)} ${numbers}`;
    case 'gamess_name':
      return `${(ELEMENT_BY_SYMBOL.get(element)?.name ?? element).padEnd(12)} ${`${z}.0`.padStart(6)} ${numbers}`;
    case 'turbomole':
      return `${numbers}  ${element}`;
    case 'priroda':
      return `${String(z).padStart(3)} ${numbers}`;
    default:
      return `${element.padEnd(2)} ${numbers}`;
  }
}

export function formatCartesian(
  doc: StructureDoc,
  digits = 5,
  format: CoordinateFormat = 'xyz',
): string {
  return doc.atoms
    .map((a, i) => coordinateLine(a.element, i, a.position, format, digits))
    .join('\n');
}

/** A line of the editor. `element` is null when the layout carried none (coordinates only). */
export type ParsedLine = { element: string | null; position: Vec3 };

/**
 * Parse the editor's lines, whichever of the layouts they are in. Blank lines are skipped and
 * errors name the 1-based line.
 *
 * Reading is by shape rather than by the Format box, as it was in Avogadro (its `parseText`
 * classified the first line's tokens and worked out which column was which). The line is read
 * from the front: a first token that names an element -- by symbol (`C`, `C1`), by name
 * (`Carbon`) or by atomic number (`6`) -- is the element, and the three numbers after it are the
 * coordinates. GAMESS puts the nuclear charge between the two, and it is recognised by being
 * that element's atomic number written as a decimal, so `H 6.0 1 2` is an atom at x = 6 and
 * `C 6.0 1 2 3` is a GAMESS line. A line that starts with a number is either Turbomole's
 * (x y z followed by the symbol) or coordinates only, which keep the element the atom has.
 * Columns past the coordinates -- forces in an extxyz block, say -- are ignored.
 */
export function parseCartesian(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(/[\s,;]+/).filter((p) => p !== '');
    const fail = (why: string): never => {
      throw new Error(`line ${i + 1}: ${why}`);
    };
    const numeric = (token: string | undefined): boolean =>
      token !== undefined && Number.isFinite(Number(token));

    let element: string | null = null;
    let numbers: string[];
    if (!numeric(parts[0])) {
      element = elementToken(parts[0]!) ?? fail(`unknown element "${parts[0]}"`);
      const body = parts.slice(1);
      const charge = ELEMENT_BY_SYMBOL.get(element)?.number ?? 0;
      const isCharge = body.length >= 4 && /^\d+\.0*$/.test(body[0]!) && Number(body[0]) === charge;
      numbers = (isCharge ? body.slice(1) : body).slice(0, 3);
    } else if (parts.length > 3 && !numeric(parts.at(-1))) {
      // Turbomole: the symbol comes after the three coordinates
      numbers = parts.slice(0, 3);
      element = elementToken(parts.at(-1)!);
    } else if (parts.length >= 4 && /^\d+$/.test(parts[0]!) && elementToken(parts[0]!)) {
      // Priroda: a bare atomic number, then the coordinates. Four whole numbers are read this
      // way rather than as coordinates with a column after them, which is Avogadro's reading too
      element = elementToken(parts[0]!);
      numbers = parts.slice(1, 4);
    } else {
      numbers = parts.slice(0, 3);
    }
    if (numbers.length < 3) fail('expected "El x y z"');
    const nums = numbers.map(Number);
    if (nums.some((n) => !Number.isFinite(n))) fail('bad coordinate');
    out.push({ element, position: nums as Vec3 });
  });
  return out;
}

/** The element a token names, by symbol, symbol with a number, name or atomic number; else null. */
function elementToken(token: string): string | null {
  const symbol = normalizeSymbol(token);
  if (ELEMENT_BY_SYMBOL.has(symbol)) return symbol;
  // "C1", "Fe12": the numbered XYZ layout labels each atom with its position in the list
  const stem = /^([A-Za-z]{1,2})\d+$/.exec(token);
  if (stem) {
    const bare = normalizeSymbol(stem[1]!);
    if (ELEMENT_BY_SYMBOL.has(bare)) return bare;
  }
  const name = token.toLowerCase();
  for (const el of ELEMENT_BY_SYMBOL.values()) if (el.name.toLowerCase() === name) return el.symbol;
  return null;
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
    const atoms = doc.atoms.map((a, i) => ({
      ...a,
      element: lines[i]!.element ?? a.element,
      position: lines[i]!.position,
    }));
    return { ...doc, atoms };
  }
  const nameless = lines.findIndex((l) => l.element === null);
  if (nameless >= 0)
    throw new Error(
      `line ${nameless + 1}: no element, and the number of atoms changed, so there is none to keep`,
    );
  const atoms = lines.map((l) => makeAtom(l.element!, l.position));
  let next: StructureDoc = { ...doc, atoms, bonds: [] };
  const bonds: Bond[] = [];
  for (let i = 0; i < atoms.length; i++) {
    for (const b of perceiveBondsForAtom(next, i)) if (b.a === i) bonds.push(b);
  }
  next = { ...next, bonds };
  return next;
}

/** The document's coordinates in `unit`. Fractional needs a cell and is empty without one. */
export function formatCoordinates(
  doc: StructureDoc,
  unit: CoordinateUnit,
  digits = 5,
  format: CoordinateFormat = 'xyz',
): string {
  if (unit === 'fractional') {
    if (!doc.cell) return '';
    let inverse: Mat3;
    try {
      inverse = invert3(doc.cell.vectors as Mat3);
    } catch {
      return ''; // a singular cell has no fractional coordinates to show
    }
    return doc.atoms
      .map((a, i) =>
        coordinateLine(a.element, i, mulRow(a.position as Vec3, inverse), format, digits),
      )
      .join('\n');
  }
  if (unit === 'angstrom') return formatCartesian(doc, digits, format);
  return doc.atoms
    .map((a, i) =>
      coordinateLine(
        a.element,
        i,
        a.position.map((x) => x / BOHR_TO_ANGSTROM),
        format,
        digits,
      ),
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
