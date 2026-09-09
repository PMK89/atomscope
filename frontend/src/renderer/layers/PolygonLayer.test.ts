import { expect, test } from 'vitest';
import type { BufferGeometry, Mesh, MeshStandardMaterial } from 'three';
import { setPositions } from '../../editor/edits';
import {
  makeAtom,
  makeBond,
  normalizeStructure,
  type StructureDoc,
  type Vec3,
} from '../../model/structure';
import type { LayerContext } from './Layer';
import { PolygonLayer } from './PolygonLayer';

/** An octahedral nickel with six fluorines, and a lone carbon that must not get a polyhedron. */
const site = (): StructureDoc =>
  normalizeStructure({
    name: 'nif6',
    charge: 0,
    atoms: [
      makeAtom('Ni', [0, 0, 0]),
      makeAtom('F', [2, 0, 0]),
      makeAtom('F', [-2, 0, 0]),
      makeAtom('F', [0, 2, 0]),
      makeAtom('F', [0, -2, 0]),
      makeAtom('F', [0, 0, 2]),
      makeAtom('F', [0, 0, -2]),
      makeAtom('C', [9, 9, 9]),
    ],
    bonds: [1, 2, 3, 4, 5, 6].map((i) => makeBond(0, i)),
  });

let revision = 0;
const ctx = (structure: StructureDoc): LayerContext => ({
  structure,
  revision: ++revision,
  selectedAtoms: new Set<number>(),
  hoveredAtom: null,
});

const mesh = (layer: PolygonLayer): Mesh<BufferGeometry, MeshStandardMaterial> | undefined =>
  layer.object.children[0] as Mesh<BufferGeometry, MeshStandardMaterial> | undefined;

test('an invisible layer draws nothing', () => {
  const layer = new PolygonLayer();
  layer.update(ctx(site()));
  expect(layer.object.children).toHaveLength(0);
  expect(layer.polyhedra()).toBe(0);
  layer.dispose();
});

test('an octahedral site becomes eight triangles in the nickel colour', () => {
  const layer = new PolygonLayer();
  layer.visible = true;
  const s = site();
  layer.update(ctx(s));

  expect(layer.polyhedra()).toBe(1);
  const geometry = mesh(layer)!.geometry;
  // eight faces, three vertices each, not indexed
  expect(geometry.getAttribute('position').count).toBe(24);

  // every vertex carries the central atom's colour, so one solid is one colour
  const color = geometry.getAttribute('color');
  const distinct = new Set<string>();
  for (let i = 0; i < color.count; i++)
    distinct.add([color.getX(i), color.getY(i), color.getZ(i)].map((v) => v.toFixed(3)).join(','));
  expect(distinct.size).toBe(1);

  // normals are computed, or the solid would be flat black
  expect(geometry.getAttribute('normal')).toBeDefined();
  layer.dispose();
});

test('opacity turns off depth writing and pushes the mesh later', () => {
  const layer = new PolygonLayer();
  layer.visible = true;
  layer.update(ctx(site()));
  const material = mesh(layer)!.material;
  // the default is Avogadro's surface default: solid polyhedra hide the atoms they are built from
  expect(material.transparent).toBe(true);
  expect(material.depthWrite).toBe(false);
  expect(mesh(layer)!.renderOrder).toBeGreaterThan(0);

  layer.setSettings({ opacity: 1 });
  expect(material.transparent).toBe(false);
  expect(material.depthWrite).toBe(true);
  expect(mesh(layer)!.renderOrder).toBe(0);
  layer.dispose();
});

test('the solids follow a moved atom', () => {
  const layer = new PolygonLayer();
  layer.visible = true;
  const base = site();
  layer.update(ctx(base));
  const before = mesh(layer)!.geometry.getAttribute('position').getX(0);

  // pull one fluorine out along x; the hull has to move with it
  const moved = setPositions(base, new Map<number, Vec3>([[1, [5, 0, 0]]]));
  layer.update(ctx(moved));
  const positions = mesh(layer)!.geometry.getAttribute('position');
  let max = -Infinity;
  for (let i = 0; i < positions.count; i++) max = Math.max(max, positions.getX(i));
  expect(max).toBeCloseTo(5);
  expect(max).toBeGreaterThan(before);
  layer.dispose();
});

test('a repeated update with nothing changed does not rebuild', () => {
  const layer = new PolygonLayer();
  layer.visible = true;
  const s = site();
  layer.update(ctx(s));
  const first = mesh(layer);
  // the hull is O(n^4) per site, so a pointer move must not pay for it
  layer.update({ ...ctx(s), hoveredAtom: 3 });
  expect(mesh(layer)).toBe(first);
  layer.dispose();
});

test('hiding the centre takes its polyhedron away', () => {
  const layer = new PolygonLayer();
  layer.visible = true;
  const s = site();
  layer.setHidden(new Set([0]));
  layer.update(ctx(s));
  expect(layer.polyhedra()).toBe(0);
  expect(layer.object.children).toHaveLength(0);

  layer.setHidden(null);
  layer.update(ctx(s));
  expect(layer.polyhedra()).toBe(1);
  layer.dispose();
});
