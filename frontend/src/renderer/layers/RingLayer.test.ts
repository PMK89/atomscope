import { expect, test } from 'vitest';
import type { BufferGeometry, Mesh, MeshStandardMaterial } from 'three';
import { addBond } from '../../editor/edits';
import { makeAtom, makeBond, normalizeStructure, type StructureDoc } from '../../model/structure';
import { ringColor } from '../../model/rings';
import type { LayerContext } from './Layer';
import { RingLayer } from './RingLayer';

/** Benzene as a flat hexagon, plus one carbon hanging off it that is in no ring. */
const benzene = (): StructureDoc => {
  const ring = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2;
    return makeAtom('C', [Math.cos(a) * 1.4, Math.sin(a) * 1.4, 0]);
  });
  return normalizeStructure({
    name: 'benzene',
    charge: 0,
    atoms: [...ring, makeAtom('C', [3, 0, 0])],
    bonds: [...Array.from({ length: 6 }, (_, i) => makeBond(i, (i + 1) % 6)), makeBond(0, 6)],
  });
};

let revision = 0;
const ctx = (structure: StructureDoc): LayerContext => ({
  structure,
  revision: ++revision,
  selectedAtoms: new Set<number>(),
  hoveredAtom: null,
});

const mesh = (layer: RingLayer): Mesh<BufferGeometry, MeshStandardMaterial> | undefined =>
  layer.object.children[0] as Mesh<BufferGeometry, MeshStandardMaterial> | undefined;

test('an invisible layer draws nothing', () => {
  const layer = new RingLayer();
  layer.update(ctx(benzene()));
  expect(layer.object.children).toHaveLength(0);
  layer.dispose();
});

test('one ring becomes a fan of one triangle per ring bond, in the size colour', () => {
  const layer = new RingLayer();
  layer.visible = true;
  layer.update(ctx(benzene()));

  expect(layer.rings()).toBe(1);
  const geometry = mesh(layer)!.geometry;
  // six triangles, one per ring bond, three vertices each
  expect(geometry.getAttribute('position').count).toBe(18);

  const color = geometry.getAttribute('color');
  const distinct = new Set<string>();
  for (let i = 0; i < color.count; i++)
    distinct.add([color.getX(i), color.getY(i), color.getZ(i)].map((v) => v.toFixed(3)).join(','));
  // magenta, which is Avogadro's colour for a six-ring
  expect([...distinct]).toEqual([
    ringColor(6)
      .map((v) => v.toFixed(3))
      .join(','),
  ]);
  layer.dispose();
});

test('the fan lies in the plane of a flat ring', () => {
  const layer = new RingLayer();
  layer.visible = true;
  layer.update(ctx(benzene()));
  const positions = mesh(layer)!.geometry.getAttribute('position');
  // benzene is in z = 0, and so is every vertex of its fan -- centroid included
  for (let i = 0; i < positions.count; i++) expect(positions.getZ(i)).toBeCloseTo(0);
  layer.dispose();
});

test('opacity is the engine only setting, and turns off depth writing', () => {
  const layer = new RingLayer();
  layer.visible = true;
  layer.update(ctx(benzene()));
  const material = mesh(layer)!.material;
  // Avogadro's m_alpha defaults to 1.0 for this engine, unlike its surface engine
  expect(material.transparent).toBe(false);

  layer.setSettings({ opacity: 0.5 });
  expect(material.transparent).toBe(true);
  expect(material.depthWrite).toBe(false);
  expect(mesh(layer)!.renderOrder).toBeGreaterThan(0);
  layer.dispose();
});

test('a new ring appears when a bond closes one', () => {
  const layer = new RingLayer();
  layer.visible = true;
  const base = benzene();
  layer.update(ctx(base));
  expect(layer.rings()).toBe(1);

  // bond the substituent back onto the ring: a three-ring is closed
  const fused = addBond(base, 1, 6, 1);
  layer.update(ctx(fused));
  expect(layer.rings()).toBe(2);
  layer.dispose();
});

test('hiding one atom of a ring takes the whole ring away', () => {
  const layer = new RingLayer();
  layer.visible = true;
  const s = benzene();
  layer.setHidden(new Set([2]));
  layer.update(ctx(s));
  // half a ring is not a ring
  expect(layer.rings()).toBe(0);

  layer.setHidden(null);
  layer.update(ctx(s));
  expect(layer.rings()).toBe(1);
  layer.dispose();
});

test('a repeated update with nothing changed does not rebuild', () => {
  const layer = new RingLayer();
  layer.visible = true;
  const s = benzene();
  layer.update(ctx(s));
  const first = mesh(layer);
  layer.update({ ...ctx(s), hoveredAtom: 4 });
  expect(mesh(layer)).toBe(first);
  layer.dispose();
});
