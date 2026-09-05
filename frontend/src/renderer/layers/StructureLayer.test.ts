import { Matrix4, type InstancedMesh } from 'three';
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
