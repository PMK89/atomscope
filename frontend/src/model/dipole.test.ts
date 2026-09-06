import { expect, test } from 'vitest';
import { dipoleFromCharges } from './dipole';
import { makeAtom, normalizeStructure } from './structure';

const water = (charges?: number[]) =>
  normalizeStructure({
    name: 'water',
    atoms: [
      makeAtom('O', [0, 0, 0.1173]),
      makeAtom('H', [0, 0.7572, -0.4692]),
      makeAtom('H', [0, -0.7572, -0.4692]),
    ],
    bonds: [],
    ...(charges
      ? {
          atomic_scalars: {
            partial_charges: { values: charges, unit: 'e', description: 'test' },
          },
        }
      : {}),
  } as never);

test('the dipole is the charge-weighted sum, in Debye, along the symmetry axis', () => {
  const d = dipoleFromCharges(water([-0.68, 0.34, 0.34]))!;
  expect(d).not.toBeNull();
  // the same numbers the backend's dipole_from_charges gives for these charges and positions
  expect(d.vector[0]).toBeCloseTo(0, 9);
  expect(d.vector[1]).toBeCloseTo(0, 9);
  expect(d.vector[2]).toBeCloseTo(-1.91561408768, 8);
  expect(d.magnitude).toBeCloseTo(1.91561408768, 8);
  // drawn from the middle of the molecule, not from the world origin
  expect(d.origin[2]).toBeCloseTo((0.1173 - 0.4692 - 0.4692) / 3, 9);
});

test('no charges, no dipole; and a charge list that does not fit the atoms is not one', () => {
  expect(dipoleFromCharges(water())).toBeNull();
  const mismatched = normalizeStructure({
    ...water(),
    atomic_scalars: { partial_charges: { values: [0.1, -0.1], unit: 'e', description: 'x' } },
  } as never);
  expect(dipoleFromCharges(mismatched)).toBeNull();
  expect(dipoleFromCharges(normalizeStructure({ name: 'empty' } as never))).toBeNull();
});

test('moving an atom changes the dipole, because it is never stored', () => {
  const first = dipoleFromCharges(water([-0.68, 0.34, 0.34]))!;
  const stretched = water([-0.68, 0.34, 0.34]);
  stretched.atoms[1] = { ...stretched.atoms[1]!, position: [0, 1.5, -0.9] };
  const second = dipoleFromCharges(stretched)!;
  expect(second.magnitude).not.toBeCloseTo(first.magnitude, 6);
});
