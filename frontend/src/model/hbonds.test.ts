import { expect, test } from 'vitest';
import { hydrogenBonds, MAX_HBONDS } from './hbonds';
import { makeAtom, makeBond, normalizeStructure, type StructureDoc, type Vec3 } from './structure';

/** Two waters: the second donates a hydrogen straight at the first one's oxygen. */
const dimer = (separation = 2.8): StructureDoc =>
  normalizeStructure({
    name: 'dimer',
    atoms: [
      makeAtom('O', [0, 0, 0]),
      makeAtom('H', [0.76, 0.59, 0]),
      makeAtom('H', [-0.76, 0.59, 0]),
      makeAtom('O', [0, -separation, 0]),
      makeAtom('H', [0, -separation + 0.98, 0]),
      makeAtom('H', [0.76, -separation - 0.59, 0]),
    ],
    bonds: [makeBond(0, 1), makeBond(0, 2), makeBond(3, 4), makeBond(3, 5)],
  } as never);

const positions = (doc: StructureDoc) => (i: number) => doc.atoms[i]!.position as Vec3;

test('a water dimer has one hydrogen bond, from the donor to the other oxygen', () => {
  const doc = dimer();
  const bonds = hydrogenBonds(doc, positions(doc));
  expect(bonds).toHaveLength(1);
  expect(bonds[0]).toMatchObject({ hydrogen: 4, donor: 3, acceptor: 0 });
  expect(bonds[0]!.distance).toBeCloseTo(2.8);
});

test('pulling the molecules apart breaks it', () => {
  const doc = dimer(4.0);
  expect(hydrogenBonds(doc, positions(doc))).toHaveLength(0);
});

test('a hydrogen that does not point at the acceptor is not a hydrogen bond', () => {
  const doc = dimer();
  // turn the donor's hydrogen away: the distance still qualifies, the angle does not
  const moved = doc.atoms.map((a, i) =>
    i === 4 ? { ...a, position: [0.98, -2.8, 0] as Vec3 } : a,
  );
  const turned = { ...doc, atoms: moved };
  expect(hydrogenBonds(turned, positions(turned))).toHaveLength(0);
});

test('covalent neighbours are not reported', () => {
  // one water on its own: its own oxygen is in range of its own hydrogens
  const doc = normalizeStructure({
    name: 'water',
    atoms: [
      makeAtom('O', [0, 0, 0]),
      makeAtom('H', [0.76, 0.59, 0]),
      makeAtom('H', [-0.76, 0.59, 0]),
    ],
    bonds: [makeBond(0, 1), makeBond(0, 2)],
  } as never);
  expect(hydrogenBonds(doc, positions(doc))).toHaveLength(0);
});

test('a carbon-bound hydrogen donates nothing', () => {
  const doc = normalizeStructure({
    name: 'methane and water',
    atoms: [
      makeAtom('C', [0, 0, 0]),
      makeAtom('H', [0, 1.09, 0]),
      makeAtom('O', [0, 2.9, 0]),
      makeAtom('H', [0.76, 3.5, 0]),
    ],
    bonds: [makeBond(0, 1), makeBond(2, 3)],
  } as never);
  expect(hydrogenBonds(doc, positions(doc))).toHaveLength(0);
});

test('the search is measured on the positions it is given, and is bounded', () => {
  const doc = dimer(4.0);
  // a displayed frame that brings them together makes the bond appear
  const frame = new Float32Array(doc.atoms.length * 3);
  doc.atoms.forEach((a, i) => {
    frame[3 * i] = a.position[0]!;
    frame[3 * i + 1] = a.position[1]! * 0.7;
    frame[3 * i + 2] = a.position[2]!;
  });
  const at = (i: number): Vec3 => [frame[3 * i]!, frame[3 * i + 1]!, frame[3 * i + 2]!];
  expect(hydrogenBonds(doc, at)).toHaveLength(1);
  expect(MAX_HBONDS).toBeGreaterThan(0);
});
