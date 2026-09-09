/**
 * The axes layer: the corner gizmo against the axes drawn in the scene, and Avogadro's three
 * axes types. The vector arithmetic itself is `model/axes`; what is checked here is that the
 * layer rebuilds for it and puts the group where the origin says.
 */
import { expect, test } from 'vitest';
import { Vector3, type Mesh } from 'three';
import { AxesLayer } from './AxesLayer';

/** The far end of each drawn axis: the head of the arrow, whose matrix carries its position. */
const heads = (layer: AxesLayer): Vector3[] => {
  const out: Vector3[] = [];
  for (const child of layer.object.children[0]!.children) {
    const mesh = child as Mesh;
    // the group holds shaft, head and label per axis; a cone geometry is the head
    if (mesh.geometry?.type === 'ConeGeometry') {
      out.push(new Vector3().setFromMatrixPosition(mesh.matrix));
    }
  }
  return out;
};

test('the origin axes are only drawn in origin mode', () => {
  const layer = new AxesLayer();
  // the default is the corner gizmo, which is an orientation indicator and not part of the scene
  expect(layer.object.children[0]!.visible).toBe(false);
  layer.setSettings({ mode: 'origin' });
  expect(layer.object.children[0]!.visible).toBe(true);
});

test('the Cartesian length reaches the drawn axes', () => {
  const layer = new AxesLayer({ mode: 'origin', axesType: 'cartesian', length: 2 });
  const short = heads(layer).map((v) => v.length());
  layer.setSettings({ length: 6 });
  const long = heads(layer).map((v) => v.length());
  for (let i = 0; i < 3; i++) expect(long[i]!).toBeGreaterThan(short[i]!);
});

test('custom vectors are drawn along the directions given, not along x y z', () => {
  const layer = new AxesLayer({
    mode: 'origin',
    axesType: 'custom',
    vectors: [
      [3, 0, 0],
      [0, 0, 4],
      [0, 5, 0],
    ],
  });
  const drawn = heads(layer);
  // the second axis points along z and the third along y, which a uniform scale of the unit axes
  // could never produce -- the group has to be rebuilt, and this is what proves it is
  expect(drawn[1]!.z).toBeGreaterThan(Math.abs(drawn[1]!.y));
  expect(drawn[2]!.y).toBeGreaterThan(Math.abs(drawn[2]!.z));
});

test('the origin moves the whole frame', () => {
  const layer = new AxesLayer({ mode: 'origin' });
  expect(layer.object.children[0]!.position.toArray()).toEqual([0, 0, 0]);
  layer.setSettings({ origin: [1, -2, 3] });
  expect(layer.object.children[0]!.position.toArray()).toEqual([1, -2, 3]);
});

test('orthogonal mode straightens the second axis', () => {
  const layer = new AxesLayer({
    mode: 'origin',
    axesType: 'orthogonal',
    vectors: [
      [2, 0, 0],
      [2, 2, 0], // leaning on the first
      [0, 0, 1],
    ],
  });
  const [a1, a2, a3] = heads(layer);
  expect(a1!.dot(a2!)).toBeCloseTo(0, 4);
  expect(a1!.dot(a3!)).toBeCloseTo(0, 4);
  expect(a2!.dot(a3!)).toBeCloseTo(0, 4);
});

test('a rebuild does not leak the previous group into the scene', () => {
  const layer = new AxesLayer({ mode: 'origin' });
  // one group for the origin axes, whatever the vectors are changed to
  expect(layer.object.children).toHaveLength(1);
  layer.setSettings({
    axesType: 'custom',
    vectors: [
      [1, 1, 0],
      [0, 1, 1],
      [1, 0, 1],
    ],
  });
  layer.setSettings({ length: 4 });
  expect(layer.object.children).toHaveLength(1);
});
