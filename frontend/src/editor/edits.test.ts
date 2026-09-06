import { expect, test } from 'vitest';
import { makeAtom, makeBond, normalizeStructure } from '../model/structure';
import { removeAtoms, reorderAtoms } from './edits';

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

test('reordering the atoms takes everything that names them by index along', () => {
  const doc = normalizeStructure({
    name: 'reorder',
    atoms: [makeAtom('H', [0, 0, 0]), makeAtom('O', [1, 0, 0]), makeAtom('C', [2, 0, 0])],
    bonds: [makeBond(0, 1), makeBond(1, 2)],
    atomic_scalars: { q: { values: [1, 2, 3], unit: '', description: 'q' } },
    atomic_vectors: {
      f: {
        values: [
          [1, 0, 0],
          [2, 0, 0],
          [3, 0, 0],
        ],
        unit: 'eV/angstrom',
        description: 'f',
      },
    },
    constraints: [{ kind: 'fix_atoms', indices: [0, 2] }],
    residues: [{ name: 'RES', number: 1, chain: 'A', atom_indices: [1, 2] }],
  } as never);

  const out = reorderAtoms(doc, [2, 1, 0]);
  expect(out.atoms.map((a) => a.element)).toEqual(['C', 'O', 'H']);
  expect(out.atoms.map((a) => a.uid)).toEqual([
    doc.atoms[2]!.uid,
    doc.atoms[1]!.uid,
    doc.atoms[0]!.uid,
  ]);
  expect(out.bonds).toEqual([
    { a: 2, b: 1, order: 1, aromatic: false },
    { a: 1, b: 0, order: 1, aromatic: false },
  ]);
  expect(out.atomic_scalars['q']!.values).toEqual([3, 2, 1]);
  expect(out.atomic_vectors['f']!.values).toEqual([
    [3, 0, 0],
    [2, 0, 0],
    [1, 0, 0],
  ]);
  expect(out.constraints[0]).toMatchObject({ indices: [2, 0] });
  expect(out.residues[0]!.atom_indices).toEqual([0, 1]); // renumbered and back in order

  // a permutation is every atom exactly once, and anything else is a bug in the caller
  expect(() => reorderAtoms(doc, [0, 1])).toThrow(/every atom once/);
  expect(() => reorderAtoms(doc, [0, 1, 1])).toThrow(/every atom once/);
});
