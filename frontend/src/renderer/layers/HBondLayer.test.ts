import { expect, test } from 'vitest';
import { makeAtom, makeBond, normalizeStructure, type StructureDoc } from '../../model/structure';
import { HBondLayer } from './HBondLayer';
import type { LayerContext } from './Layer';

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

let revision = 0;
const ctx = (structure: StructureDoc, override?: Float32Array): LayerContext => ({
  structure,
  revision: ++revision,
  selectedAtoms: new Set<number>(),
  hoveredAtom: null,
  positionsOverride: override ?? null,
});

test('an invisible layer draws nothing', () => {
  const layer = new HBondLayer();
  layer.update(ctx(dimer()));
  expect(layer.bonds()).toBe(0);
  expect(layer.object.children).toHaveLength(0);
  layer.dispose();
});

test('a water dimer is drawn as one dashed bond', () => {
  const layer = new HBondLayer();
  layer.visible = true;
  layer.update(ctx(dimer()));
  expect(layer.bonds()).toBe(1);
  // one instanced mesh holding the dashes of that bond
  expect(layer.object.children).toHaveLength(1);
  layer.dispose();
});

test('the cut-offs are settings, and a wider one finds more', () => {
  const layer = new HBondLayer();
  layer.visible = true;
  layer.update(ctx(dimer(3.6)));
  expect(layer.bonds()).toBe(0);

  layer.setSettings({ maxDistance: 4.0 });
  layer.update(ctx(dimer(3.6)));
  expect(layer.bonds()).toBe(1);
  layer.dispose();
});

test('a displayed frame decides what is bonded', () => {
  const doc = dimer(4.0);
  const layer = new HBondLayer();
  layer.visible = true;
  layer.update(ctx(doc));
  expect(layer.bonds()).toBe(0);

  const frame = new Float32Array(doc.atoms.length * 3);
  doc.atoms.forEach((a, i) => {
    frame[3 * i] = a.position[0]!;
    frame[3 * i + 1] = a.position[1]! * 0.7;
    frame[3 * i + 2] = a.position[2]!;
  });
  layer.update(ctx(doc, frame));
  expect(layer.bonds()).toBe(1);

  layer.visible = false;
  layer.update(ctx(doc, frame));
  expect(layer.object.children).toHaveLength(0);
  layer.dispose();
});

test('a hover-only update does not run the search again', () => {
  const doc = dimer();
  const layer = new HBondLayer();
  layer.visible = true;
  layer.update(ctx(doc));
  const mesh = layer.object.children[0];

  // same atoms, different hover: nothing to recompute
  layer.update({ ...ctx(doc), hoveredAtom: 3 });
  expect(layer.object.children[0]).toBe(mesh);
  expect(layer.bonds()).toBe(1);

  // a real change still gets through
  layer.setSettings({ maxDistance: 1.5 });
  layer.update(ctx(doc));
  expect(layer.bonds()).toBe(0);
  layer.dispose();
});
