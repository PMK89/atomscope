import { expect, test } from 'vitest';
import {
  atomColors,
  CHAIN_COLORS,
  parseHexColor,
  rainbow,
  RESIDUE_COLOR,
  UNKNOWN_COLOR,
} from './atomColors';
import { KIND_COLOR } from '../model/ribbon';
import { makeAtom, normalizeStructure } from '../model/structure';

const doc = normalizeStructure({
  name: 'two chains',
  atoms: Array.from({ length: 5 }, (_, i) => makeAtom('C', [i, 0, 0])),
  residues: [
    { name: 'LYS', number: 1, chain: 'A', atom_indices: [0, 1] },
    { name: 'GLY', number: 2, chain: 'A', atom_indices: [2] },
    { name: 'XYZ', number: 3, chain: 'B', atom_indices: [3, 4] },
  ],
} as never);

/** Float32 rounds, so compare at the precision the palette is written with. */
const rgb = (c: Float32Array, atom: number): number[] =>
  [...c.slice(3 * atom, 3 * atom + 3)].map((v) => Number(v.toFixed(4)));

test('the element scheme leaves the colours to the layer', () => {
  expect(atomColors(doc.residues, doc.atoms.length, 'element')).toBe(null);
  // and a document with no residues has nothing to colour by
  const plain = normalizeStructure({ name: 'water', atoms: [makeAtom('O', [0, 0, 0])] } as never);
  expect(atomColors(plain.residues, plain.atoms.length, 'residue')).toBe(null);
});

test('residues take the RasMol colours, and an unknown one is grey', () => {
  const c = atomColors(doc.residues, doc.atoms.length, 'residue')!;
  expect(rgb(c, 0)).toEqual(RESIDUE_COLOR['LYS']);
  expect(rgb(c, 2)).toEqual(RESIDUE_COLOR['GLY']);
  expect(rgb(c, 3)).toEqual(UNKNOWN_COLOR);
  // the aliphatic residues are RasMol's green (15, 130, 15), not black
  expect(RESIDUE_COLOR['LEU']).toEqual([0.06, 0.51, 0.06]);
  expect(RESIDUE_COLOR['VAL']).toEqual(RESIDUE_COLOR['LEU']);
  expect(RESIDUE_COLOR['ILE']).toEqual(RESIDUE_COLOR['LEU']);
});

test('chains take the cycle in the order they appear', () => {
  const c = atomColors(doc.residues, doc.atoms.length, 'chain')!;
  expect(rgb(c, 0)).toEqual(CHAIN_COLORS[0]);
  expect(rgb(c, 3)).toEqual(CHAIN_COLORS[1]);
});

test('secondary structure uses the cartoon colours, and unassigned residues stay grey', () => {
  const data = {
    residues: [{ residue: 0, kind: 'helix' as const, ca: 'x', o: 'y' }],
    chains: [[0]],
  };
  const c = atomColors(doc.residues, doc.atoms.length, 'secondary', data)!;
  expect(rgb(c, 0)).toEqual(KIND_COLOR.helix);
  expect(rgb(c, 2)).toEqual(UNKNOWN_COLOR);
  // without the assignment nothing is coloured, rather than everything being wrong
  expect(rgb(atomColors(doc.residues, doc.atoms.length, 'secondary')!, 0)).toEqual(UNKNOWN_COLOR);
});

test('the index scheme sweeps the rainbow from the first atom to the last', () => {
  const plain = normalizeStructure({
    name: 'chain',
    atoms: Array.from({ length: 5 }, (_, i) => makeAtom('C', [i, 0, 0])),
  } as never);
  const c = atomColors(plain.residues, plain.atoms.length, 'index')!;
  expect(rgb(c, 0)).toEqual([1, 0, 0]);
  // the last atom is violet: blue with a little red, and nothing in between is red again
  const last = rgb(c, 4);
  expect(last[2]).toBe(1);
  expect(last[0]).toBeGreaterThan(0.5);
  expect(rgb(c, 2)[1]).toBeGreaterThan(0.5);
});

test('the distance scheme measures from the first atom, whatever the order', () => {
  const plain = normalizeStructure({
    name: 'spread',
    atoms: [makeAtom('C', [0, 0, 0]), makeAtom('C', [4, 0, 0]), makeAtom('C', [2, 0, 0])],
  } as never);
  const c = atomColors(plain.residues, plain.atoms.length, 'distance', null, {
    atoms: plain.atoms,
  })!;
  expect(rgb(c, 0)).toEqual([1, 0, 0]);
  // atom 1 is the farthest, so it gets the far end of the ramp and atom 2 the middle
  expect(rgb(c, 1)).toEqual(rainbow(1));
  expect(rgb(c, 2)).toEqual(rainbow(0.5));
  // without the atoms the scheme has nothing to measure and says so
  expect(atomColors(plain.residues, plain.atoms.length, 'distance')).toBeNull();
});

test('the charge scheme is red for negative, blue for positive and scaled by the largest', () => {
  const plain = normalizeStructure({
    name: 'charged',
    atoms: [makeAtom('O', [0, 0, 0]), makeAtom('H', [1, 0, 0]), makeAtom('H', [2, 0, 0])],
  } as never);
  const charges = [-0.8, 0.4, 0];
  const c = atomColors(plain.residues, plain.atoms.length, 'charge', null, { charges })!;
  expect(rgb(c, 0)).toEqual([1, 0, 0]);
  expect(rgb(c, 1)).toEqual([0.5, 0.5, 1]);
  expect(rgb(c, 2)).toEqual([1, 1, 1]);
  // a structure that carries no charges keeps its element colours
  expect(atomColors(plain.residues, plain.atoms.length, 'charge')).toBeNull();
  expect(
    atomColors(plain.residues, plain.atoms.length, 'charge', null, { charges: [] }),
  ).toBeNull();
});

test('one colour paints every atom, and unparseable text is grey rather than black', () => {
  const plain = normalizeStructure({
    name: 'two',
    atoms: [makeAtom('C', [0, 0, 0]), makeAtom('O', [1, 0, 0])],
  } as never);
  const c = atomColors(plain.residues, plain.atoms.length, 'custom', null, { custom: '#ff8000' })!;
  expect(rgb(c, 0)).toEqual(rgb(c, 1));
  expect(rgb(c, 0).map((v) => Number(v.toFixed(3)))).toEqual([1, 0.502, 0]);
  expect(parseHexColor('#f80')).toEqual(parseHexColor('#ff8800'));
  expect(parseHexColor('not a colour')).toEqual(UNKNOWN_COLOR);
});
