import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { expect, test } from 'vitest';
import { rotationCentre, selectionCentre, visibleBarycentre } from './rotationCenter';

const atoms = [
  { position: [0, 0, 0] },
  { position: [2, 0, 0] },
  { position: [0, 2, 0] },
  { position: [0, 0, 20] },
];

/** A camera at +z looking back at the origin, as `updateMatrixWorld` leaves it. */
const looking = (from: [number, number, number], at: [number, number, number]): Matrix4 => {
  const camera = new PerspectiveCamera();
  camera.position.set(...from);
  camera.lookAt(new Vector3(...at));
  camera.updateMatrixWorld();
  return camera.matrixWorldInverse;
};

test('a selection wins, and it is the centroid of every selected atom', () => {
  const centre = rotationCentre(atoms, new Set([1, 2]), 0, looking([0, 0, 30], [0, 0, 0]));
  expect(centre?.toArray()).toEqual([1, 1, 0]);
});

test('indices nothing is at are ignored, and a selection of only those is no selection', () => {
  expect(selectionCentre(atoms, new Set([1, 99]))?.toArray()).toEqual([2, 0, 0]);
  expect(selectionCentre(atoms, new Set([99]))).toBeNull();
  expect(selectionCentre(atoms, new Set())).toBeNull();
  expect(selectionCentre(atoms, undefined)).toBeNull();
});

test('without a selection the atom the drag started on is what it turns about', () => {
  const centre = rotationCentre(atoms, new Set(), 2, looking([0, 0, 30], [0, 0, 0]));
  expect(centre?.toArray()).toEqual([0, 2, 0]);
});

test('with neither, it is the barycentre of what is being looked at', () => {
  // the two off-axis atoms are what the view direction separates: looking down -x leaves the one
  // at x=2 dead centre and the one at y=2 out to the side, and swapping the axis swaps the answer
  const alongX = rotationCentre(atoms, undefined, null, looking([30, 0, 0], [0, 0, 0]));
  const alongY = rotationCentre(atoms, undefined, null, looking([0, 30, 0], [0, 0, 0]));
  expect(alongX?.x).toBeGreaterThan(alongX?.y ?? 0);
  expect(alongY?.y).toBeGreaterThan(alongY?.x ?? 0);
});

test('the weight is angular, not by depth: two atoms on the axis of view count the same', () => {
  // worth stating, because it is not what "what is being looked at" first suggests. Avogadro's
  // weight is exp(-30(1 + cos t)) with t the angle off the view direction; distance never enters,
  // so an atom straight ahead counts fully however far away it is.
  const centre = visibleBarycentre(
    [{ position: [0, 0, 0] }, { position: [0, 0, -20] }],
    looking([0, 0, 30], [0, 0, 0]),
  );
  expect(centre?.z).toBeCloseTo(-10, 6);
});

test('an atom behind the camera does not count at all', () => {
  const centre = visibleBarycentre(
    [{ position: [0, 0, 0] }, { position: [0, 0, 60] }],
    looking([0, 0, 30], [0, 0, 0]),
  );
  expect(centre?.z).toBeCloseTo(0, 6);
});

test('the weighting is sharp: an atom off the axis of view barely counts', () => {
  const centre = visibleBarycentre(
    [{ position: [0, 0, 0] }, { position: [0, 40, 0] }],
    looking([0, 0, 30], [0, 0, 0]),
  );
  expect(centre?.y).toBeLessThan(0.5);
});

test('nothing drawn, nothing to turn about', () => {
  expect(rotationCentre([], new Set([0]), 0, looking([0, 0, 30], [0, 0, 0]))).toBeNull();
});
