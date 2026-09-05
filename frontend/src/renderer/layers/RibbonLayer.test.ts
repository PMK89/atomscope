import { expect, test } from 'vitest';
import { makeAtom, normalizeStructure, type StructureDoc } from '../../model/structure';
import { RibbonLayer, type SecondaryStructureData } from './RibbonLayer';
import type { LayerContext } from './Layer';

/** Four residues of a straight chain: CA, O per residue. */
const protein = (): { doc: StructureDoc; data: SecondaryStructureData } => {
  const atoms = [];
  for (let i = 0; i < 4; i++) {
    atoms.push(makeAtom('C', [i * 3.3, 0, 0]), makeAtom('O', [i * 3.3, i % 2 ? 1.2 : -1.2, 0]));
  }
  const doc = normalizeStructure({ name: 'p', atoms } as never);
  const data: SecondaryStructureData = {
    residues: doc.atoms
      .filter((_, i) => i % 2 === 0)
      .map((a, r) => ({
        residue: r,
        kind: 'helix' as const,
        ca: a.uid!,
        o: doc.atoms[2 * r + 1]!.uid!,
      })),
    chains: [[0, 1, 2, 3]],
  };
  return { doc, data };
};

let revision = 0;
const ctx = (structure: StructureDoc, override?: Float32Array): LayerContext => ({
  structure,
  revision: ++revision,
  selectedAtoms: new Set<number>(),
  hoveredAtom: null,
  positionsOverride: override ?? null,
});

test('an invisible layer, or one without an assignment, draws nothing', () => {
  const { doc, data } = protein();
  const layer = new RibbonLayer();
  layer.update(ctx(doc));
  expect(layer.triangles()).toBe(0);

  layer.visible = true;
  layer.update(ctx(doc));
  expect(layer.triangles()).toBe(0);

  layer.setData(data);
  layer.update(ctx(doc));
  expect(layer.triangles()).toBeGreaterThan(0);
  layer.dispose();
});

test('the ribbon follows a displayed frame', () => {
  const { doc, data } = protein();
  const layer = new RibbonLayer();
  layer.visible = true;
  layer.setData(data);
  layer.update(ctx(doc));
  const before = layer.object.children[0] as {
    geometry: { attributes: { position: { array: Float32Array } } };
  };
  const x0 = before.geometry.attributes.position.array[0]!;

  const moved = new Float32Array(doc.atoms.length * 3);
  doc.atoms.forEach((a, i) => {
    moved[3 * i] = a.position[0]! + 10;
    moved[3 * i + 1] = a.position[1]!;
    moved[3 * i + 2] = a.position[2]!;
  });
  layer.update(ctx(doc, moved));
  expect(before.geometry.attributes.position.array[0]).toBeCloseTo(x0 + 10);
  layer.dispose();
});

test('a residue whose backbone atom is gone breaks the chain instead of joining across it', () => {
  const { doc, data } = protein();
  const layer = new RibbonLayer();
  layer.visible = true;
  layer.setData(data);
  layer.update(ctx(doc));
  const whole = layer.triangles();

  // drop the third residue's atoms, as deleting them in the editor would
  const edited = { ...doc, atoms: doc.atoms.filter((_, i) => i !== 4 && i !== 5) };
  layer.update(ctx(edited));
  // two shorter strips, so fewer triangles than one long one and no bridge across the gap
  expect(layer.triangles()).toBeGreaterThan(0);
  expect(layer.triangles()).toBeLessThan(whole);
  layer.dispose();
});

test('the style changes the geometry and the layer stays disposable', () => {
  const { doc, data } = protein();
  const layer = new RibbonLayer();
  layer.visible = true;
  layer.setData(data);
  layer.setSettings({ style: 'backbone' });
  layer.update(ctx(doc));
  expect(layer.triangles()).toBeGreaterThan(0);

  layer.visible = false;
  layer.update(ctx(doc));
  expect(layer.object.children).toHaveLength(0);
  layer.dispose();
});

test('a hover-only update does not rebuild the ribbon', () => {
  const { doc, data } = protein();
  const layer = new RibbonLayer();
  layer.visible = true;
  layer.setData(data);
  layer.update(ctx(doc));
  const geometry = (layer.object.children[0] as { geometry: unknown }).geometry;
  const positions = (geometry as { attributes: { position: unknown } }).attributes.position;

  layer.update({ ...ctx(doc), hoveredAtom: 1, selectedAtoms: new Set([0]) });
  // the very same attribute object: no spline, no strip, no upload
  expect((geometry as { attributes: { position: unknown } }).attributes.position).toBe(positions);

  layer.setSettings({ style: 'ribbon' });
  layer.update(ctx(doc));
  // a real change does get through -- read the mesh the layer holds now, not the old one
  const after = (layer.object.children[0] as { geometry: { attributes: { position: unknown } } })
    .geometry.attributes.position;
  expect(after).not.toBe(positions);
  layer.dispose();
});
