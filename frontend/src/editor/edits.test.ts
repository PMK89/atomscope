import { expect, test } from 'vitest';
import { makeAtom, makeBond, normalizeStructure } from '../model/structure';
import { removeAtoms } from './edits';

test('removing atoms renumbers the residues and constraints that referred to them', () => {
  const doc = normalizeStructure({
    name: 'tripeptide',
    atoms: [
      makeAtom('N', [0, 0, 0]),
      makeAtom('C', [1.4, 0, 0]),
      makeAtom('C', [2.8, 0, 0]),
      makeAtom('O', [4.2, 0, 0]),
    ],
    bonds: [makeBond(0, 1), makeBond(1, 2), makeBond(2, 3)],
    residues: [
      { name: 'ALA', number: 1, chain: 'A', atom_indices: [0, 1] },
      { name: 'GLY', number: 2, chain: 'A', atom_indices: [2] },
      { name: 'SER', number: 3, chain: 'A', atom_indices: [3] },
    ],
    constraints: [
      { kind: 'fix_atoms', indices: [0, 2] },
      { kind: 'fix_bond_length', a: 2, b: 3 },
    ],
  } as never);

  const after = removeAtoms(doc, [2]);
  expect(after.residues.map((r) => r.name)).toEqual(['ALA', 'SER']);
  // SER's atom moved from 3 to 2 and its residue followed
  expect(after.residues.at(-1)!.atom_indices).toEqual([2]);
  expect(after.constraints).toEqual([{ kind: 'fix_atoms', indices: [0] }]);
});

test('removing atoms takes their partial charges and forces with them', () => {
  const doc = normalizeStructure({
    name: 'water',
    atoms: [makeAtom('O', [0, 0, 0]), makeAtom('H', [1, 0, 0]), makeAtom('H', [0, 1, 0])],
    bonds: [makeBond(0, 1), makeBond(0, 2)],
    atomic_scalars: {
      partial_charges: { description: 'gasteiger', unit: 'e', values: [-0.8, 0.4, 0.4] },
    },
    atomic_vectors: {
      forces: {
        description: '',
        unit: 'eV/angstrom',
        values: [
          [0, 0, 1],
          [0, 0, 2],
          [0, 0, 3],
        ],
      },
    },
  } as never);

  const after = removeAtoms(doc, [1]);
  // one entry per atom, and the entries left are the ones whose atoms are left
  expect(after.atomic_scalars['partial_charges']!.values).toEqual([-0.8, 0.4]);
  expect(after.atomic_vectors['forces']!.values).toEqual([
    [0, 0, 1],
    [0, 0, 3],
  ]);
  // the unit and the description come along
  expect(after.atomic_scalars['partial_charges']!.unit).toBe('e');
});
