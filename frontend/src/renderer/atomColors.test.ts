import { expect, test } from 'vitest';
import { atomColors, CHAIN_COLORS, RESIDUE_COLOR, UNKNOWN_COLOR } from './atomColors';
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
