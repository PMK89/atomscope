import { expect, test } from 'vitest';
import { makeAtom, makeBond, normalizeStructure, type StructureDoc } from '../model/structure';
import {
  atomLabel,
  bondLabel,
  distanceLabel,
  formatCharge,
  partialCharges,
  residueOfAtom,
} from './labels';

const doc = (): StructureDoc =>
  normalizeStructure({
    name: 'ion',
    atoms: [
      { ...makeAtom('N', [0, 0, 0]), formal_charge: 1, label: 'amine' },
      { ...makeAtom('H', [0, 1.01, 0]), formal_charge: 0 },
      { ...makeAtom('O', [1.5, 0, 0]), formal_charge: -1 },
    ],
    bonds: [makeBond(0, 1), { ...makeBond(0, 2), order: 2 }],
    atomic_scalars: {
      partial_charges: { values: [-0.42, 0.21, -0.79], unit: 'e', description: '' },
    },
    residues: [{ name: 'ALA', number: 7, chain: 'A', atom_indices: [0, 1] }],
  } as never);

test('atom label content options', () => {
  const s = doc();
  expect(atomLabel(s, 0, 'none')).toBe('');
  expect(atomLabel(s, 0, 'index')).toBe('1');
  expect(atomLabel(s, 0, 'symbol')).toBe('N');
  expect(atomLabel(s, 2, 'symbol_index')).toBe('O3');
  expect(atomLabel(s, 0, 'formal_charge')).toBe('+');
  expect(atomLabel(s, 2, 'formal_charge')).toBe('-');
  // an uncharged atom gets no label rather than a "0" on every hydrogen
  expect(atomLabel(s, 1, 'formal_charge')).toBe('');
  expect(atomLabel(s, 0, 'partial_charge')).toBe('-0.42');
  expect(atomLabel(s, 0, 'residue_name')).toBe('ALA');
  expect(atomLabel(s, 0, 'residue_number')).toBe('7');
  expect(atomLabel(s, 2, 'residue_name')).toBe(''); // outside every residue
  expect(atomLabel(s, 0, 'custom')).toBe('amine');
  expect(atomLabel(s, 0, 'uid')).toBe(s.atoms[0]!.uid);
});

test('formal charges are written the way chemists write them', () => {
  expect(formatCharge(1)).toBe('+');
  expect(formatCharge(-1)).toBe('-');
  expect(formatCharge(2)).toBe('2+');
  expect(formatCharge(-3)).toBe('3-');
});

test('bond label content options', () => {
  const s = doc();
  expect(bondLabel(s, 0, 'none')).toBe('');
  expect(bondLabel(s, 0, 'index')).toBe('1');
  expect(bondLabel(s, 1, 'order')).toBe('2');
  // three decimals, which is Avogadro's default `lengthPrecision`
  expect(bondLabel(s, 0, 'length')).toBe('1.010');
  expect(bondLabel(s, 1, 'length')).toBe('1.500');
});

test('partial charges are only used when they cover every atom', () => {
  const s = doc();
  expect(partialCharges(s)).toEqual([-0.42, 0.21, -0.79]);
  const short = {
    ...s,
    atomic_scalars: { partial_charges: { values: [0.1], unit: 'e', description: '' } },
  } as StructureDoc;
  expect(partialCharges(short)).toEqual([]);
  expect(atomLabel(short, 0, 'partial_charge')).toBe('');
});

test('residues map to their atoms', () => {
  const map = residueOfAtom(doc());
  expect(map.get(1)).toEqual({ name: 'ALA', number: 7 });
  expect(map.has(2)).toBe(false);
});

test('the bond-length precision is settable, as Avogadro settable it', () => {
  const s = normalizeStructure({
    name: 'x',
    charge: 0,
    atoms: [makeAtom('C', [0, 0, 0]), makeAtom('C', [1.2345678, 0, 0])],
    bonds: [makeBond(0, 1)],
  });
  const a = s.atoms[0]!.position;
  const b = s.atoms[1]!.position;
  expect(distanceLabel(a, b)).toBe('1.235'); // the default, Avogadro's 3
  expect(distanceLabel(a, b, 0)).toBe('1');
  expect(distanceLabel(a, b, 8)).toBe('1.23456780');
  // out of Avogadro's 0-8 range is clamped rather than handed to toFixed, which would throw
  expect(distanceLabel(a, b, -3)).toBe('1');
  expect(distanceLabel(a, b, 42)).toBe('1.23456780');
  expect(distanceLabel(a, b, 2.4)).toBe('1.23');
});
