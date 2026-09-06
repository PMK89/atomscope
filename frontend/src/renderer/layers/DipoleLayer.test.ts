import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { emptyStructure, makeAtom } from '../../model/structure';
import { DipoleLayer } from './DipoleLayer';
import type { LayerContext } from './Layer';

const water = (charges?: number[]) => ({
  ...emptyStructure(),
  atoms: [
    makeAtom('O', [0, 0, 0.1173]),
    makeAtom('H', [0, 0.7572, -0.4692]),
    makeAtom('H', [0, -0.7572, -0.4692]),
  ],
  ...(charges
    ? {
        atomic_scalars: {
          partial_charges: { values: charges, unit: 'e' as never, description: '' },
        },
      }
    : {}),
});

const ctx = (structure: ReturnType<typeof water>, revision = 1): LayerContext => ({
  structure,
  revision,
  selectedAtoms: new Set<number>(),
  hoveredAtom: null,
});

test('one arrow when the structure carries charges, none when it does not', () => {
  const layer = new DipoleLayer();
  layer.update(ctx(water()));
  expect(layer.drawn).toBe(false);

  layer.update(ctx(water([-0.68, 0.34, 0.34]), 2));
  expect(layer.drawn).toBe(true);
  // the arrow is anchored at the centroid and points down -z for this charge distribution
  const shaft = layer.object.children[0]!;
  const position = new Vector3().setFromMatrixPosition(shaft.matrix);
  expect(position.x).toBeCloseTo(0, 6);
  expect(position.z).toBeLessThan((0.1173 - 0.4692 - 0.4692) / 3);

  // charges that cancel are no dipole to draw
  layer.update(ctx(water([0, 0, 0]), 3));
  expect(layer.drawn).toBe(false);
  layer.dispose();
});

test('the scale is Angstrom per Debye, so a bigger scale is a longer arrow', () => {
  const layer = new DipoleLayer();
  const centroid = new Vector3(0, 0, (0.1173 - 0.4692 - 0.4692) / 3);
  // how far the head sits from where the arrow starts, which is what the scale changes
  const length = (): number => {
    const head = layer.object.children[1]!;
    return new Vector3().setFromMatrixPosition(head.matrix).distanceTo(centroid);
  };
  layer.update(ctx(water([-0.68, 0.34, 0.34])));
  const short = length();
  layer.setSettings({ scale: 6 });
  layer.update(ctx(water([-0.68, 0.34, 0.34]), 2));
  expect(length()).toBeGreaterThan(short);
  layer.dispose();
});
