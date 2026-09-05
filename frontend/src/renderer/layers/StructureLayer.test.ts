import { Matrix4, Vector3, type InstancedMesh } from 'three';
import { expect, test, vi } from 'vitest';
import { addBond, setElement, setPositions } from '../../editor/edits';
import { makeAtom, makeBond, normalizeStructure, type StructureDoc } from '../../model/structure';
import type { LayerContext } from './Layer';
import { StructureLayer } from './StructureLayer';

const doc = (): StructureDoc =>
  normalizeStructure({
    name: 'c2',
    charge: 0,
    atoms: [makeAtom('C', [0, 0, 0]), makeAtom('C', [1.5, 0, 0]), makeAtom('O', [4, 0, 0])],
    bonds: [makeBond(0, 1)],
  });

let revision = 0;
const ctx = (structure: StructureDoc): LayerContext => ({
  structure,
  revision: ++revision,
  selectedAtoms: new Set<number>(),
  hoveredAtom: null,
});

/** [atom mesh, bond mesh] of the layer. */
const meshes = (layer: StructureLayer): InstancedMesh[] => layer.pickables as InstancedMesh[];

test('a coordinate-only update rewrites instance matrices without recreating meshes', () => {
  const layer = new StructureLayer();
  const base = doc();
  layer.update(ctx(base));
  const [atomMesh, bondMesh] = meshes(layer);
  const dispose = vi.spyOn(atomMesh!, 'dispose');

  const moved = setPositions(base, new Map([[1, [2.5, 0, 0]]]));
  layer.update(ctx(moved));

  expect(meshes(layer)[0]).toBe(atomMesh);
  expect(meshes(layer)[1]).toBe(bondMesh);
  expect(dispose).not.toHaveBeenCalled();
  // the moved atom's instance matrix followed the new position
  const m = new Matrix4();
  atomMesh!.getMatrixAt(1, m);
  expect(m.elements[12]).toBeCloseTo(2.5);
  layer.dispose();
});

test('a bond, an element or a settings change does recreate the meshes', () => {
  const layer = new StructureLayer();
  const base = doc();
  layer.update(ctx(base));
  let atomMesh = meshes(layer)[0];

  const bonded = addBond(base, 1, 2, 1);
  layer.update(ctx(bonded));
  expect(meshes(layer)[0]).not.toBe(atomMesh);
  atomMesh = meshes(layer)[0];

  const swapped = setElement(bonded, 2, 'N');
  layer.update(ctx(swapped));
  expect(meshes(layer)[0]).not.toBe(atomMesh);
  atomMesh = meshes(layer)[0];

  layer.setSettings({ style: 'vdw' });
  layer.update(ctx(swapped));
  expect(meshes(layer)[0]).not.toBe(atomMesh);
  layer.dispose();
});

test('repeating the same snapshot touches nothing', () => {
  const layer = new StructureLayer();
  const base = doc();
  layer.update(ctx(base));
  const [atomMesh] = meshes(layer);
  const dispose = vi.spyOn(atomMesh!, 'dispose');
  layer.update(ctx(base));
  expect(meshes(layer)[0]).toBe(atomMesh);
  expect(dispose).not.toHaveBeenCalled();
  layer.dispose();
});

test('large structures are drawn with coarser spheres', () => {
  const big = (n: number): StructureDoc =>
    normalizeStructure({
      name: `c${n}`,
      charge: 0,
      atoms: Array.from({ length: n }, (_, i) => makeAtom('C', [i * 2, 0, 0])),
      bonds: [],
    });

  const small = new StructureLayer();
  small.update(ctx(big(10)));
  const fine = meshes(small)[0]!.geometry.attributes.position!.count;

  const large = new StructureLayer();
  large.update(ctx(big(25_000)));
  const coarse = meshes(large)[0]!.geometry.attributes.position!.count;

  // 25k atoms at the fine tessellation is 37 M triangles a frame; the coarse sphere is what
  // keeps the viewport interactive, and one atom of 25 000 is a few pixels wide anyway
  expect(coarse).toBeLessThan(fine / 8);

  // hiding hydrogens changes the visible count, and the settings path rebuilds, so the tier is
  // re-picked rather than left on the geometry the first build happened to choose
  large.settings = { ...large.settings, showHydrogens: false };
  large.update(ctx(big(25_000)));
  expect(meshes(large)[0]!.geometry.attributes.position!.count).toBe(coarse);
  small.dispose();
  large.dispose();
});

test('the quality setting overrides the automatic tessellation in both directions', () => {
  const doc = (n: number): StructureDoc =>
    normalizeStructure({
      name: `c${n}`,
      charge: 0,
      atoms: Array.from({ length: n }, (_, i) => makeAtom('C', [i * 2, 0, 0])),
      bonds: [],
    });
  const vertices = (layer: StructureLayer): number =>
    meshes(layer)[0]!.geometry.attributes.position!.count;

  const small = new StructureLayer();
  small.update(ctx(doc(10)));
  const fine = vertices(small);
  small.settings = { ...small.settings, quality: 'low' };
  small.update(ctx(doc(10)));
  expect(vertices(small)).toBeLessThan(fine / 8);

  // and a big structure can be forced back to the fine spheres
  const large = new StructureLayer();
  large.settings = { ...large.settings, quality: 'high' };
  large.update(ctx(doc(25_000)));
  expect(vertices(large)).toBe(fine);
  small.dispose();
  large.dispose();
});

test('the selection can be drawn in its own style', () => {
  const layer = new StructureLayer();
  const base = doc();
  layer.update(ctx(base));
  const m = new Matrix4();
  meshes(layer)[0]!.getMatrixAt(0, m);
  const ballRadius = m.elements[0]!;

  layer.setSettings({ selectionStyle: 'vdw' });
  layer.update({ ...ctx(base), selectedAtoms: new Set([0]) });

  // the selected carbon grew to its van der Waals radius, the other one did not
  const atomMesh = meshes(layer)[0]!;
  atomMesh.getMatrixAt(0, m);
  expect(m.elements[0]).toBeGreaterThan(ballRadius * 2);
  atomMesh.getMatrixAt(1, m);
  expect(m.elements[0]).toBeCloseTo(ballRadius);
  // a van der Waals atom carries no bonds, so the only bond in the structure is gone
  expect(meshes(layer)).toHaveLength(1);
  layer.dispose();
});

test('a selection change only rebuilds when the selection has a style of its own', () => {
  const layer = new StructureLayer();
  const base = doc();
  layer.update(ctx(base));
  const atomMesh = meshes(layer)[0];

  layer.update({ ...ctx(base), selectedAtoms: new Set([0]) });
  expect(meshes(layer)[0]).toBe(atomMesh);

  layer.setSettings({ selectionStyle: 'stick' });
  layer.update({ ...ctx(base), selectedAtoms: new Set([1]) });
  expect(meshes(layer)[0]).not.toBe(atomMesh);
  layer.dispose();
});

test('a bond between two styles is drawn once, at the thinner radius', () => {
  const layer = new StructureLayer();
  const base = doc();
  layer.setSettings({ selectionStyle: 'wireframe' });
  layer.update({ ...ctx(base), selectedAtoms: new Set([0]) });

  const bondMesh = meshes(layer)[1]!;
  expect(bondMesh.count).toBe(2); // one bond, two half-cylinders
  const m = new Matrix4();
  bondMesh.getMatrixAt(0, m);
  // the cylinder's cross-section scale is the thin wireframe radius, not the default 0.12
  expect(new Vector3().setFromMatrixColumn(m, 0).length()).toBeCloseTo(0.12 * 0.35, 3);
  layer.dispose();
});

/** Ethene: a C=C with two hydrogens on each carbon, all in the xy plane. */
const ethene = (): StructureDoc =>
  normalizeStructure({
    name: 'ethene',
    atoms: [
      makeAtom('C', [0, 0, 0]),
      makeAtom('C', [1.33, 0, 0]),
      makeAtom('H', [-0.55, 0.94, 0]),
      makeAtom('H', [-0.55, -0.94, 0]),
      makeAtom('H', [1.88, 0.94, 0]),
      makeAtom('H', [1.88, -0.94, 0]),
    ],
    bonds: [makeBond(0, 1, 2), makeBond(0, 2), makeBond(0, 3), makeBond(1, 4), makeBond(1, 5)],
  } as never);

test('a double bond is drawn as two sticks in the plane of the molecule', () => {
  const layer = new StructureLayer();
  const doc = ethene();
  layer.update(ctx(doc));

  const bondMesh = meshes(layer)[1]!;
  // four single bonds (2 halves each) plus the double bond (2 sticks x 2 halves)
  expect(bondMesh.count).toBe(4 * 2 + 4);

  // the two sticks of the C=C are offset from the axis, symmetrically, and stay in z = 0
  const m = new Matrix4();
  const positions: number[][] = [];
  for (let i = 0; i < bondMesh.count; i++) {
    bondMesh.getMatrixAt(i, m);
    positions.push([m.elements[12]!, m.elements[13]!, m.elements[14]!]);
  }
  const doubleHalves = positions.filter((p) => Math.abs(p[1]!) > 1e-6 && p[0]! < 1.0 && p[0]! > 0);
  expect(doubleHalves.length).toBeGreaterThanOrEqual(2);
  expect(doubleHalves.every((p) => Math.abs(p[2]!) < 1e-6)).toBe(true);
  const ys = doubleHalves.map((p) => p[1]!).sort((a, b) => a - b);
  expect(ys[0]).toBeCloseTo(-ys[ys.length - 1]!);
  layer.dispose();
});

test('switching multiple bonds off draws one stick again', () => {
  const layer = new StructureLayer();
  layer.setSettings({ multipleBonds: false });
  layer.update(ctx(ethene()));
  expect(meshes(layer)[1]!.count).toBe(5 * 2);
  layer.dispose();
});

test('picking still finds the bond a stick belongs to', () => {
  const layer = new StructureLayer();
  const doc = ethene();
  layer.update(ctx(doc));
  const bondMesh = meshes(layer)[1]!;
  const found = new Set<number>();
  for (let i = 0; i < bondMesh.count; i++) {
    found.add(layer.bondIndexForInstance(bondMesh, i)!);
  }
  // every bond of the document is reachable, and nothing points past the end of the list
  expect([...found].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  layer.dispose();
});

/** One atom in a 3 Å cubic cell. */
const crystal = (): StructureDoc =>
  normalizeStructure({
    name: 'po',
    atoms: [makeAtom('Po', [0, 0, 0])],
    bonds: [],
    cell: {
      vectors: [
        [3, 0, 0],
        [0, 3, 0],
        [0, 0, 3],
      ],
      pbc: [true, true, true],
    },
  } as never);

test('repeating the cell repeats the atoms in it, not only the box', () => {
  const layer = new StructureLayer();
  const doc = crystal();
  layer.update(ctx(doc));
  expect(meshes(layer)[0]!.count).toBe(1);

  layer.setSettings({ cellRepeat: [2, 2, 1] });
  layer.update(ctx(doc));
  const atomMesh = meshes(layer)[0]!;
  expect(atomMesh.count).toBe(4);

  // the images sit one cell vector apart, and every one of them still names the atom it copies
  const m = new Matrix4();
  const xs = new Set<string>();
  for (let i = 0; i < atomMesh.count; i++) {
    atomMesh.getMatrixAt(i, m);
    xs.add(`${m.elements[12]!.toFixed(3)},${m.elements[13]!.toFixed(3)}`);
    expect(layer.atomIndexForInstance(atomMesh, i)).toBe(0);
  }
  expect(xs).toEqual(new Set(['0.000,0.000', '0.000,3.000', '3.000,0.000', '3.000,3.000']));
  layer.dispose();
});

test('a structure without a cell ignores the repeat', () => {
  const layer = new StructureLayer();
  layer.setSettings({ cellRepeat: [3, 3, 3] });
  layer.update(ctx(doc()));
  expect(meshes(layer)[0]!.count).toBe(3);
  layer.dispose();
});

test('removing the cell takes the images with it', () => {
  const layer = new StructureLayer();
  const doc = crystal();
  layer.setSettings({ cellRepeat: [2, 2, 2] });
  layer.update(ctx(doc));
  expect(meshes(layer)[0]!.count).toBe(8);

  // the atoms and bonds are the same arrays: only the cell went away
  layer.update(ctx({ ...doc, cell: null }));
  expect(meshes(layer)[0]!.count).toBe(1);
  layer.dispose();
});

test('a repeat larger than the instance budget is cut short and says so', () => {
  const many = normalizeStructure({
    name: 'big',
    atoms: Array.from({ length: 30_000 }, (_, i) => makeAtom('C', [i * 0.1, 0, 0])),
    bonds: [],
    cell: {
      vectors: [
        [100, 0, 0],
        [0, 100, 0],
        [0, 0, 100],
      ],
      pbc: [true, true, true],
    },
  } as never);
  const layer = new StructureLayer();
  layer.setSettings({ cellRepeat: [10, 10, 10] });
  layer.update(ctx(many));

  // 1000 images of 30k atoms would be 3e7 spheres; the budget stops well short of that
  expect(layer.truncated).toBe(true);
  expect(meshes(layer)[0]!.count).toBeLessThanOrEqual(2_000_000);
  layer.dispose();
});

test('a hidden atom leaves the meshes, its bonds and the picking behind', () => {
  const layer = new StructureLayer();
  const base = addBond(doc(), 1, 2, 1);
  layer.update(ctx(base));
  const [atomMesh, bondMesh] = meshes(layer);
  // 3 atoms, 2 bonds, one half-cylinder per bond end
  expect(atomMesh!.count).toBe(3);
  expect(bondMesh!.count).toBe(4);

  layer.setSettings({ atomStyles: [null, null, 'hidden'] });
  layer.update(ctx(base));
  const [atomMesh2, bondMesh2] = meshes(layer);
  expect(atomMesh2!.count).toBe(2);
  // only the C-C bond is left
  expect(bondMesh2!.count).toBe(2);
  // and nothing on screen picks the hidden atom
  const picked = [0, 1].map((k) => layer.atomIndexForInstance(atomMesh2!, k));
  expect(picked).toEqual([0, 1]);

  // showing it again brings everything back
  layer.setSettings({ atomStyles: null });
  layer.update(ctx(base));
  expect(meshes(layer)[0]!.count).toBe(3);
  expect(meshes(layer)[1]!.count).toBe(4);
  layer.dispose();
});

test('an assigned display type beats the selection style and the global one', () => {
  const layer = new StructureLayer();
  const base = doc();
  layer.setSettings({ style: 'ball-and-stick', selectionStyle: 'vdw' });
  const selected = { ...ctx(base), selectedAtoms: new Set([0, 1]) };
  layer.update(selected);
  // a van der Waals atom draws no bonds, so the C-C bond is gone with both ends selected
  expect(meshes(layer)[1]).toBeUndefined();

  // both ends are assigned back to sticks, over the selection style: the bond is drawn again
  layer.setSettings({ atomStyles: ['ball-and-stick', 'ball-and-stick', null] });
  layer.update({ ...ctx(base), selectedAtoms: selected.selectedAtoms });
  expect(meshes(layer)[1]!.count).toBe(2);
  layer.dispose();
});
