import {
  cartToFrac,
  cellParameters,
  cellVolume,
  formatFractional,
  formatMatrix,
  fracToCart,
  invert3,
  latticeTypeFromParameters,
  parseFractional,
  parseMatrix,
  parseMiller,
  parseRepeat,
  type Mat3,
} from './crystal';
import { makeAtom, normalizeStructure, type Cell } from './structure';

const hex: Cell = {
  vectors: [
    [4, 0, 0],
    [-2, 2 * Math.sqrt(3), 0],
    [0, 0, 6],
  ],
  pbc: [true, true, true],
};
const cubic: Cell = {
  vectors: [
    [5, 0, 0],
    [0, 5, 0],
    [0, 0, 5],
  ],
  pbc: [true, true, true],
};

test('cell parameters and volume', () => {
  const p = cellParameters(hex);
  expect(p.a).toBeCloseTo(4);
  expect(p.b).toBeCloseTo(4);
  expect(p.c).toBeCloseTo(6);
  expect(p.alpha).toBeCloseTo(90);
  expect(p.beta).toBeCloseTo(90);
  expect(p.gamma).toBeCloseTo(120);
  expect(cellVolume(cubic)).toBeCloseTo(125);
  expect(cellVolume(hex)).toBeCloseTo(4 * 2 * Math.sqrt(3) * 6);
});

test('fractional <-> Cartesian round trip and inverse', () => {
  const f = cartToFrac([2, 2 * Math.sqrt(3), 3], hex);
  expect(f[0]).toBeCloseTo(1);
  expect(f[1]).toBeCloseTo(1);
  expect(f[2]).toBeCloseTo(0.5);
  const back = fracToCart(f, hex);
  expect(back[0]).toBeCloseTo(2);
  expect(back[1]).toBeCloseTo(2 * Math.sqrt(3));
  expect(back[2]).toBeCloseTo(3);
  const inv = invert3(cubic.vectors as Mat3);
  expect(inv[0][0]).toBeCloseTo(0.2);
  expect(inv[0][1]).toBe(0);
  expect(() =>
    invert3([
      [1, 0, 0],
      [2, 0, 0],
      [0, 0, 1],
    ]),
  ).toThrow(/singular/);
});

test('lattice type from parameters', () => {
  const p = (a: number, b: number, c: number, al: number, be: number, ga: number) =>
    latticeTypeFromParameters({ a, b, c, alpha: al, beta: be, gamma: ga });
  expect(p(4, 4, 4, 90, 90, 90)).toBe('cubic');
  expect(p(4, 4, 6, 90, 90, 90)).toBe('tetragonal');
  expect(p(4, 5, 6, 90, 90, 90)).toBe('orthorhombic');
  expect(p(4, 4, 6, 90, 90, 120)).toBe('hexagonal');
  expect(p(4, 4, 4, 70, 70, 70)).toBe('rhombohedral');
  expect(p(4, 5, 6, 90, 100, 90)).toBe('monoclinic');
  expect(p(4, 5, 6, 80, 100, 95)).toBe('triclinic');
});

test('matrix text round trip and errors', () => {
  const text = formatMatrix(hex.vectors as Mat3);
  const m = parseMatrix(text);
  expect(m[1][1]).toBeCloseTo(2 * Math.sqrt(3), 4);
  expect(parseMatrix('1 0 0\n0, 1, 0\n\n0 0 1\n')).toEqual([
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]);
  expect(() => parseMatrix('1 0 0\n0 1 0')).toThrow(/3 rows/);
  expect(() => parseMatrix('1 0 0\n0 x 0\n0 0 1')).toThrow(/row 2/);
});

test('fractional editor text', () => {
  const doc = normalizeStructure({
    name: 'x',
    charge: 0,
    cell: cubic,
    atoms: [makeAtom('Na', [0, 0, 0]), makeAtom('Cl', [2.5, 2.5, 2.5])],
  });
  const text = formatFractional(doc);
  expect(text.split('\n')).toHaveLength(2);
  expect(text).toMatch(/Cl\s+0.50000\s+0.50000\s+0.50000/);
  const lines = parseFractional('Na 0 0 0\nCl 0.5 0.5 0.5\nK 0.25 0.25 0.25', cubic);
  expect(lines).toHaveLength(3);
  expect(lines[2]!.position).toEqual([1.25, 1.25, 1.25]);
  expect(() => parseFractional('Xx 0 0 0', cubic)).toThrow(/unknown element/);
  expect(formatFractional({ ...doc, cell: null })).toBe('');
});

test('repeat and Miller parsing', () => {
  expect(parseRepeat(['2', ' 3', '1'])).toEqual([2, 3, 1]);
  expect(() => parseRepeat(['0', '1', '1'])).toThrow(/>= 1/);
  expect(() => parseRepeat(['1.5', '1', '1'])).toThrow();
  expect(parseMiller('1 1 1')).toEqual([1, 1, 1]);
  expect(parseMiller('1,0,-1')).toEqual([1, 0, -1]);
  expect(() => parseMiller('0 0 0')).toThrow(/zero/);
  expect(() => parseMiller('1 1')).toThrow(/three/);
});
