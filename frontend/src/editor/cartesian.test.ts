import { makeAtom, makeBond, normalizeStructure, type StructureDoc } from '../model/structure';
import {
  applyCartesian,
  BOHR_TO_ANGSTROM,
  formatCartesian,
  formatCoordinates,
  normalizeSymbol,
  parseCartesian,
  parseCoordinates,
} from './cartesian';

const water = () =>
  normalizeStructure({
    name: 'w',
    charge: 0,
    atoms: [
      makeAtom('O', [0, 0, 0.1173]),
      makeAtom('H', [0, 0.7572, -0.4692]),
      makeAtom('H', [0, -0.7572, -0.4692]),
    ],
    bonds: [makeBond(0, 1), makeBond(0, 2)],
  });

test('format / parse round trip', () => {
  const w = water();
  const lines = parseCartesian(formatCartesian(w));
  expect(lines.map((l) => l.element)).toEqual(['O', 'H', 'H']);
  expect(lines[1]!.position[1]).toBeCloseTo(0.7572, 5);
});

test('parse accepts lowercase / atomic numbers and reports bad lines', () => {
  expect(parseCartesian('c 0 0 0\n\n8 1 0 0')).toEqual([
    { element: 'C', position: [0, 0, 0] },
    { element: 'O', position: [1, 0, 0] },
  ]);
  expect(() => parseCartesian('C 0 0')).toThrow(/line 1/);
  expect(() => parseCartesian('Qq 0 0 0')).toThrow(/unknown element/);
  expect(() => parseCartesian('C 0 x 0')).toThrow(/bad coordinate/);
  expect(normalizeSymbol('CL')).toBe('Cl');
});

test('apply keeps uids/bonds for equal counts, otherwise replaces atoms and re-perceives bonds', () => {
  const w = water();
  const same = applyCartesian(w, parseCartesian('O 0 0 0\nH 0 0.8 -0.5\nH 0 -0.8 -0.5'));
  expect(same.atoms[0]!.uid).toBe(w.atoms[0]!.uid);
  expect(same.bonds).toHaveLength(2);
  const other = applyCartesian(w, parseCartesian('C 0 0 0\nH 1.0 0 0'));
  expect(other.atoms).toHaveLength(2);
  expect(other.bonds).toEqual([{ a: 0, b: 1, order: 1, aromatic: false }]);
});

test('Bohr and fractional coordinates round-trip through the editor', () => {
  const cell = {
    vectors: [
      [4, 0, 0],
      [0, 5, 0],
      [0, 0, 6],
    ],
    pbc: [true, true, true],
  } as StructureDoc['cell'];
  const doc = normalizeStructure({
    name: 'crystal',
    atoms: [makeAtom('Na', [0, 0, 0]), makeAtom('Cl', [2, 2.5, 3])],
    cell,
  } as never);

  // Bohr: the same positions in a longer unit, so the numbers are larger
  const bohr = formatCoordinates(doc, 'bohr');
  expect(bohr.split('\n')[1]).toContain((2 / BOHR_TO_ANGSTROM).toFixed(5));
  // the editor writes five decimals, so the round trip is good to about 1e-6 Å
  expect(parseCoordinates(bohr, 'bohr', cell)[1]!.position[0]).toBeCloseTo(2, 5);

  // fractional: the corner atom is 0 0 0 and the body centre is a half along each axis
  const frac = formatCoordinates(doc, 'fractional');
  expect(frac.split('\n')[1]!.split(/\s+/).slice(1).map(Number)).toEqual([0.5, 0.5, 0.5]);
  expect(parseCoordinates(frac, 'fractional', cell)[1]!.position).toEqual([2, 2.5, 3]);

  // and the same numbers read as Ångström would put the atom somewhere else entirely, so a
  // structure without a cell refuses them rather than guessing
  expect(formatCoordinates({ ...doc, cell: null }, 'fractional')).toBe('');
  expect(() => parseCoordinates(frac, 'fractional', null)).toThrow(/need a unit cell/);
});

test('every layout writes what the parser reads back', () => {
  const doc = normalizeStructure({
    name: 'formats',
    atoms: [makeAtom('C', [1.5, -0.25, 0]), makeAtom('Fe', [0, 0, 2])],
    bonds: [],
  } as never);
  const formats = [
    'xyz',
    'xyz_numbered',
    'coords',
    'gamess',
    'gamess_name',
    'turbomole',
    'priroda',
  ] as const;
  for (const format of formats) {
    const text = formatCoordinates(doc, 'angstrom', 5, format);
    const back = applyCartesian(doc, parseCartesian(text));
    expect(
      back.atoms.map((a) => a.element),
      format,
    ).toEqual(['C', 'Fe']);
    back.atoms.forEach((a, i) =>
      a.position.forEach((x, k) => expect(x, format).toBeCloseTo(doc.atoms[i]!.position[k]!, 4)),
    );
  }
  // the layouts themselves, one line each
  const line = (format: (typeof formats)[number]): string =>
    formatCoordinates(doc, 'angstrom', 2, format).split('\n')[0]!;
  expect(line('xyz').trim()).toBe('C          1.50        -0.25         0.00');
  expect(line('xyz_numbered').trim().startsWith('C1')).toBe(true);
  expect(line('coords').trim().startsWith('1.50')).toBe(true);
  expect(line('gamess').trim().startsWith('C     6.0')).toBe(true);
  expect(line('gamess_name').trim().startsWith('Carbon')).toBe(true);
  expect(line('turbomole').trim().endsWith('C')).toBe(true);
  expect(line('priroda').trim().startsWith('6 ')).toBe(true);
});

test('a line with no element keeps the one the atom has, unless the count changed', () => {
  const doc = normalizeStructure({
    name: 'water',
    atoms: [makeAtom('O', [0, 0, 0]), makeAtom('H', [0, 0.8, 0.5])],
    bonds: [],
  } as never);
  const moved = applyCartesian(doc, parseCartesian('0 0 0\n0 1.0 0.5'));
  expect(moved.atoms.map((a) => a.element)).toEqual(['O', 'H']);
  expect(moved.atoms[1]!.position[1]).toBeCloseTo(1.0, 6);
  expect(() => applyCartesian(doc, parseCartesian('0 0 0'))).toThrow(/no element/);
  // a token that is meant to be an element but is not one is still an error
  expect(() => parseCartesian('Qq 0 0 0')).toThrow(/unknown element/);
});

test('a trailing column is not mistaken for a coordinate', () => {
  // "El x y z fx fy fz" is what an extxyz block looks like; the coordinates are still x y z
  expect(parseCartesian('C 1 2 3 0.5')[0]).toEqual({ element: 'C', position: [1, 2, 3] });
  expect(parseCartesian('C 1 2 3 0.1 0.2 0.3')[0]).toEqual({ element: 'C', position: [1, 2, 3] });
  // GAMESS puts the nuclear charge between the symbol and the coordinates
  expect(parseCartesian('C 6.0 1 2 3')[0]).toEqual({ element: 'C', position: [1, 2, 3] });
  expect(parseCartesian('Carbon 6.0 1 2 3')[0]).toEqual({ element: 'C', position: [1, 2, 3] });
  // a number that is not this element's charge is a coordinate: x = 6 here, not a GAMESS column
  expect(parseCartesian('H 6.0 1 2')[0]).toEqual({ element: 'H', position: [6, 1, 2] });
  // the two layouts that start with a number: the symbol last is Turbomole, a bare Z is Priroda
  expect(parseCartesian('1 2 3 C')[0]).toEqual({ element: 'C', position: [1, 2, 3] });
  expect(parseCartesian('6 1 2 3')[0]).toEqual({ element: 'C', position: [1, 2, 3] });
  expect(parseCartesian('1 2 3')[0]).toEqual({ element: null, position: [1, 2, 3] });
});
