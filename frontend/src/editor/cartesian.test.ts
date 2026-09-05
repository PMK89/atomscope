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
