import { makeAtom, makeBond, normalizeStructure } from '../model/structure';
import { applyCartesian, formatCartesian, normalizeSymbol, parseCartesian } from './cartesian';

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
