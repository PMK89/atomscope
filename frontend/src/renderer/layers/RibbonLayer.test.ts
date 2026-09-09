import type { Mesh } from 'three';
import { expect, test } from 'vitest';
import { CHAIN_COLORS, RESIDUE_COLOR } from '../atomColors';
import { KIND_COLOR } from '../../model/ribbon';
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
  const before = layer.object.children[0] as unknown as {
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
  const geometry = (layer.object.children[0] as unknown as { geometry: unknown }).geometry;
  const positions = (geometry as { attributes: { position: unknown } }).attributes.position;

  layer.update({ ...ctx(doc), hoveredAtom: 1, selectedAtoms: new Set([0]) });
  // the very same attribute object: no spline, no strip, no upload
  expect((geometry as { attributes: { position: unknown } }).attributes.position).toBe(positions);

  layer.setSettings({ style: 'ribbon' });
  layer.update(ctx(doc));
  // a real change does get through -- read the mesh the layer holds now, not the old one
  const after = (
    layer.object.children[0] as unknown as { geometry: { attributes: { position: unknown } } }
  ).geometry.attributes.position;
  expect(after).not.toBe(positions);
  layer.dispose();
});

test('the ribbon has a colour map of its own: secondary structure, chain or residue', () => {
  const { doc, data } = protein();
  // two chains of two residues, so both the chain and the residue map have something to say
  const withResidues: StructureDoc = {
    ...doc,
    residues: [
      { name: 'LYS', number: 1, chain: 'A', atom_indices: [0, 1] },
      { name: 'LYS', number: 2, chain: 'A', atom_indices: [2, 3] },
      { name: 'ASP', number: 3, chain: 'B', atom_indices: [4, 5] },
      { name: 'ASP', number: 4, chain: 'B', atom_indices: [6, 7] },
    ],
  };
  const layer = new RibbonLayer();
  layer.visible = true;
  layer.setData(data);

  /** the distinct vertex colours of the strip, rounded so float32 comparisons hold */
  const colors = (): string[] => {
    const mesh = layer.object.children[0] as Mesh;
    const attribute = mesh.geometry.getAttribute('color');
    const out = new Set<string>();
    for (let i = 0; i < attribute.count; i++)
      out.add(
        [attribute.getX(i), attribute.getY(i), attribute.getZ(i)]
          .map((v) => v.toFixed(3))
          .join(','),
      );
    return [...out];
  };
  const key = (c: readonly number[]): string => c.map((v) => v.toFixed(3)).join(',');

  layer.update(ctx(withResidues));
  expect(colors()).toEqual([key(KIND_COLOR.helix)]);

  layer.setSettings({ colorScheme: 'chain' });
  layer.update(ctx(withResidues));
  expect(colors().sort()).toEqual([key(CHAIN_COLORS[0]!), key(CHAIN_COLORS[1]!)].sort());

  layer.setSettings({ colorScheme: 'residue' });
  layer.update(ctx(withResidues));
  expect(colors().sort()).toEqual([key(RESIDUE_COLOR['LYS']!), key(RESIDUE_COLOR['ASP']!)].sort());

  // back to the structure's own colours
  layer.setSettings({ colorScheme: 'secondary' });
  layer.update(ctx(withResidues));
  expect(colors()).toEqual([key(KIND_COLOR.helix)]);
  layer.dispose();
});

test('hiding a backbone atom breaks the chain there instead of running through it', () => {
  const { doc, data } = protein();
  const layer = new RibbonLayer();
  layer.visible = true;
  layer.setData(data);
  layer.update(ctx(doc));
  const whole = layer.triangles();
  expect(whole).toBeGreaterThan(0);

  // residue 1's CA is atom 2; with it hidden the four residues become two guides of one
  // residue each, and a guide of one residue is not drawn at all
  layer.setHidden(new Set([2]));
  layer.update(ctx(doc));
  expect(layer.triangles()).toBeLessThan(whole);

  // every atom of this fixture is backbone, so hiding residue 0's carbonyl O drops it too
  layer.setHidden(new Set([1]));
  layer.update(ctx(doc));
  const withoutO = layer.triangles();
  layer.setHidden(null);
  layer.update(ctx(doc));
  expect(withoutO).toBeLessThan(layer.triangles());
  expect(layer.triangles()).toBe(whole);
  layer.dispose();
});

test('an equal hidden set does not rebuild the spline', () => {
  const { doc, data } = protein();
  const layer = new RibbonLayer();
  layer.visible = true;
  layer.setData(data);
  layer.setHidden(new Set([2]));
  layer.update(ctx(doc));
  const geometry = (layer.object.children[0] as Mesh).geometry;
  const positions = geometry.getAttribute('position');

  // the set is rebuilt from the document on every frame of a drag: a fresh one with the same
  // atoms in it must not cost a spline, a strip and a normal pass
  layer.setHidden(new Set([2]));
  layer.update(ctx(doc));
  expect((layer.object.children[0] as Mesh).geometry.getAttribute('position')).toBe(positions);
  layer.dispose();
});

test('the cartoon colours are Avogadro defaults and are settable', () => {
  const { doc, data } = protein();
  const layer = new RibbonLayer();
  layer.visible = true;
  layer.setData(data);

  const distinct = (): string[] => {
    const mesh = layer.object.children[0] as Mesh;
    const attribute = mesh.geometry.getAttribute('color');
    const out = new Set<string>();
    for (let i = 0; i < attribute.count; i++)
      out.add(
        [attribute.getX(i), attribute.getY(i), attribute.getZ(i)]
          .map((v) => v.toFixed(3))
          .join(','),
      );
    return [...out];
  };

  // Avogadro's cartoonengine.cpp:60-62 -- Qt::red, Qt::yellow, Qt::green
  layer.update(ctx(doc));
  expect(distinct()).toEqual(['1.000,0.000,0.000']);

  layer.setSettings({ cartoonColors: { helix: '#0000ff', sheet: '#ffff00', loop: '#00ff00' } });
  layer.update(ctx(doc));
  expect(distinct()).toEqual(['0.000,0.000,1.000']);
  layer.dispose();
});
