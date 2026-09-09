import { expect, test, vi } from 'vitest';
import type { GridGeometry, IsosurfaceMesh, MarchingCubesOptions } from '../marchingCubes';
import { IsosurfaceLayer, type Mesher, type SurfaceSpec } from './IsosurfaceLayer';

const geometry: GridGeometry = {
  shape: [2, 2, 2],
  origin: [0, 0, 0],
  axes: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
};

const emptyMesh = (step = 1): IsosurfaceMesh => ({
  positions: new Float32Array(9),
  normals: new Float32Array(9),
  indices: new Uint32Array([0, 1, 2]),
  vertexCount: 3,
  triangleCount: 1,
  step,
});

/** Mesher whose computations only finish when the test releases them. */
function controllableMesher(): Mesher & {
  calls: MarchingCubesOptions[];
  release: () => void;
} {
  const waiting: (() => void)[] = [];
  const calls: MarchingCubesOptions[] = [];
  return {
    calls,
    loadGrid: () => undefined,
    unloadGrid: () => undefined,
    compute: (_id: string, opts: MarchingCubesOptions) => {
      calls.push(opts);
      return new Promise<IsosurfaceMesh>((resolve) => {
        waiting.push(() => resolve(emptyMesh()));
      });
    },
    release: () => {
      const due = waiting.splice(0);
      for (const r of due) r();
    },
  };
}

const spec = (isovalue: number): SurfaceSpec => ({
  id: 's1',
  isovalue,
  inside: 'above',
  step: 1,
  color: '#fff',
  opacity: 1,
  visible: true,
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

test('only one meshing job per surface runs at a time and the newest request wins', async () => {
  const mesher = controllableMesher();
  const layer = new IsosurfaceLayer('g1', new Float32Array(8), geometry, mesher);

  layer.setSurfaces([spec(0.1)]);
  await flush();
  expect(mesher.calls).toHaveLength(1);

  // three more slider positions while the first job is still running
  layer.setSurfaces([spec(0.2)]);
  layer.setSurfaces([spec(0.3)]);
  layer.setSurfaces([spec(0.4)]);
  await flush();
  expect(mesher.calls).toHaveLength(1);

  mesher.release();
  await flush();
  // exactly one follow-up job, for the newest isovalue - the intermediate ones were coalesced
  expect(mesher.calls).toHaveLength(2);
  expect(mesher.calls[1]!.isovalue).toBe(0.4);

  const onChange = vi.fn();
  layer.onChange = onChange;
  mesher.release();
  await flush();
  expect(mesher.calls).toHaveLength(2);
  expect(onChange).toHaveBeenCalledTimes(1);
  layer.dispose();
});

test('a coarsened surface reports a warning, and clears it when it fits again', async () => {
  const steps = [2, 1];
  const mesher: Mesher = {
    loadGrid: () => undefined,
    unloadGrid: () => undefined,
    compute: () => Promise.resolve(emptyMesh(steps.shift() ?? 1)),
  };
  const layer = new IsosurfaceLayer('g1', new Float32Array(8), geometry, mesher);
  const warnings: [string, string | null][] = [];
  layer.onWarning = (id, message) => warnings.push([id, message]);

  layer.setSurfaces([spec(0.01)]);
  await flush();
  expect(warnings).toHaveLength(1);
  expect(warnings[0]![0]).toBe('s1');
  expect(warnings[0]![1]).toMatch(/1\/2 resolution/);

  layer.setSurfaces([spec(0.5)]);
  await flush();
  expect(warnings[1]).toEqual(['s1', null]);
  layer.dispose();
});

test('a surface removed while its job runs does not receive the late mesh', async () => {
  const mesher = controllableMesher();
  const layer = new IsosurfaceLayer('g1', new Float32Array(8), geometry, mesher);
  layer.setSurfaces([spec(0.1)]);
  await flush();
  const onChange = vi.fn();
  layer.onChange = onChange;
  layer.setSurfaces([]);
  mesher.release();
  await flush();
  expect(onChange).not.toHaveBeenCalled();
  layer.dispose();
});

/** A mesher returning three vertices at x = 0, 0.5 and 1 of the unit cube. */
const rampMesher: Mesher = {
  loadGrid: () => undefined,
  unloadGrid: () => undefined,
  compute: () =>
    Promise.resolve({
      positions: new Float32Array([0, 0, 0, 0.5, 0, 0, 1, 0, 0]),
      normals: new Float32Array(9),
      indices: new Uint32Array([0, 1, 2]),
      vertexCount: 3,
      triangleCount: 1,
      step: 1,
    }),
};

/** A second grid ramping from 0 to 1 along x, as an electrostatic potential would. */
const colorSource = (range: [number, number] | null = null) => ({
  gridId: 'esp',
  values: new Float32Array([0, 0, 0, 0, 1, 1, 1, 1]),
  geometry,
  range,
});

test('a colour source paints the vertices and reports the range it found', async () => {
  const layer = new IsosurfaceLayer('g1', new Float32Array(8), geometry, rampMesher);
  const ranges: [string, [number, number]][] = [];
  layer.onRange = (id, range) => ranges.push([id, range]);

  layer.setSurfaces([{ ...spec(0.1), colorSource: colorSource([0, 1]) }]);
  await flush();

  const mesh = layer.object.children[0] as unknown as {
    geometry: { getAttribute(n: string): unknown };
  };
  const colors = mesh.geometry.getAttribute('color') as { array: Float32Array } | undefined;
  expect(colors).toBeTruthy();
  // blue at the low end, white in the middle, red at the high end
  expect([...colors!.array.slice(0, 3)]).toEqual([0, 0, 1]);
  expect([...colors!.array.slice(3, 6)]).toEqual([1, 1, 1]);
  expect([...colors!.array.slice(6, 9)]).toEqual([1, 0, 0]);
  expect(ranges).toEqual([['s1', [0, 1]]]);
  layer.dispose();
});

test('changing only the range repaints without meshing again', async () => {
  const calls: number[] = [];
  const counting: Mesher = {
    ...rampMesher,
    compute: (...args: Parameters<Mesher['compute']>) => {
      calls.push(1);
      return rampMesher.compute(...args);
    },
  };
  const layer = new IsosurfaceLayer('g1', new Float32Array(8), geometry, counting);
  layer.setSurfaces([{ ...spec(0.1), colorSource: colorSource() }]);
  await flush();
  expect(calls).toHaveLength(1);

  layer.setSurfaces([{ ...spec(0.1), colorSource: colorSource([0, 2]) }]);
  await flush();
  expect(calls).toHaveLength(1);

  const mesh = layer.object.children[0] as unknown as {
    geometry: { getAttribute(n: string): unknown };
  };
  const colors = mesh.geometry.getAttribute('color') as { array: Float32Array };
  // over [0, 2] the middle vertex (0.5) is a quarter of the way up, still on the blue side
  expect(colors.array[2]).toBe(1);
  expect(colors.array[3]).toBeCloseTo(0.5);
  layer.dispose();
});

test('taking the colour source away restores the flat colour', async () => {
  const layer = new IsosurfaceLayer('g1', new Float32Array(8), geometry, rampMesher);
  layer.setSurfaces([{ ...spec(0.1), colorSource: colorSource() }]);
  await flush();
  layer.setSurfaces([{ ...spec(0.1), colorSource: null }]);
  await flush();

  const mesh = layer.object.children[0] as unknown as {
    geometry: { getAttribute(n: string): unknown };
    material: { vertexColors: boolean };
  };
  expect(mesh.geometry.getAttribute('color')).toBeUndefined();
  expect(mesh.material.vertexColors).toBe(false);
  layer.dispose();
});

/** A mesher whose vertices sit at the given fractions along x. */
const mesherAt = (xs: number[]): Mesher => ({
  loadGrid: () => undefined,
  unloadGrid: () => undefined,
  compute: () =>
    Promise.resolve({
      positions: new Float32Array(xs.flatMap((x) => [x, 0, 0])),
      normals: new Float32Array(xs.length * 3),
      indices: new Uint32Array(xs.map((_, i) => i)),
      vertexCount: xs.length,
      triangleCount: 1,
      step: 1,
    }),
});

test('an automatic scale is symmetric, so zero on the surface is white', async () => {
  // a signed field running from -1 to 3: white has to land on zero, not on the middle value of 1
  const signed = {
    gridId: 'esp',
    values: new Float32Array([-1, -1, -1, -1, 3, 3, 3, 3]),
    geometry,
    range: null,
  };
  const layer = new IsosurfaceLayer('g1', new Float32Array(8), geometry, mesherAt([0, 0.25, 1]));
  layer.setSurfaces([{ ...spec(0.1), colorSource: signed }]);
  await flush();

  const mesh = layer.object.children[0] as unknown as {
    geometry: { getAttribute(n: string): unknown };
  };
  const colors = (mesh.geometry.getAttribute('color') as { array: Float32Array }).array;
  // the vertex sampling exactly 0 is white; the negative one is blue-ish, the positive one red-ish
  expect([...colors.slice(3, 6)].map((c) => Number(c.toFixed(3)))).toEqual([1, 1, 1]);
  expect(colors[2]).toBe(1);
  expect(colors[0]).toBeLessThan(1);
  expect(colors[6]).toBe(1);
  expect(colors[7]).toBeLessThan(1);
  layer.dispose();
});

test('a grid reloaded under the same id repaints the surface', async () => {
  const layer = new IsosurfaceLayer('g1', new Float32Array(8), geometry, rampMesher);
  layer.setSurfaces([{ ...spec(0.1), colorSource: colorSource([0, 1]) }]);
  await flush();
  const mesh = layer.object.children[0] as unknown as {
    geometry: { getAttribute(n: string): unknown };
  };
  expect([
    ...(mesh.geometry.getAttribute('color') as { array: Float32Array }).array.slice(0, 3),
  ]).toEqual([0, 0, 1]);

  // same grid id and range, new data (the grid was unloaded and loaded again): reversed ramp
  layer.setSurfaces([
    {
      ...spec(0.1),
      colorSource: {
        gridId: 'esp',
        values: new Float32Array([1, 1, 1, 1, 0, 0, 0, 0]),
        geometry,
        range: [0, 1] as [number, number],
      },
    },
  ]);
  await flush();
  expect([
    ...(mesh.geometry.getAttribute('color') as { array: Float32Array }).array.slice(0, 3),
  ]).toEqual([1, 0, 0]);
  layer.dispose();
});

/**
 * The three ways Avogadro's surface engine draws a mesh (`renderCombo`: Fill, Lines, Points) and
 * its `drawBoxCheck`.
 */
test('Fill, Lines and Points draw the same surface three ways', async () => {
  const mesher = controllableMesher();
  const layer = new IsosurfaceLayer('g', new Float32Array(8), geometry, mesher);
  layer.setSurfaces([spec(0.1)]);
  mesher.release();
  await flush();

  const mesh = layer.object.children.find((c) => c.name === 's1')!;
  const points = layer.object.children.find((c) => c.name === 's1-points')!;
  const material = (): { wireframe: boolean } =>
    (mesh as unknown as { material: { wireframe: boolean } }).material;

  // fill is the default, as Avogadro's m_renderMode 0 is
  expect(mesh.visible).toBe(true);
  expect(points.visible).toBe(false);
  expect(material().wireframe).toBe(false);

  layer.setSurfaces([{ ...spec(0.1), renderMode: 'lines' }]);
  expect(material().wireframe).toBe(true);
  expect(mesh.visible).toBe(true);
  expect(points.visible).toBe(false);

  layer.setSurfaces([{ ...spec(0.1), renderMode: 'points' }]);
  expect(mesh.visible).toBe(false);
  expect(points.visible).toBe(true);
  // the points share the mesh's geometry rather than copying the vertices
  expect((points as unknown as { geometry: unknown }).geometry).toBe(
    (mesh as unknown as { geometry: unknown }).geometry,
  );
  layer.dispose();
});

test('the drawn box is the grid bounding box, once for the whole grid', async () => {
  const mesher = controllableMesher();
  const layer = new IsosurfaceLayer('g', new Float32Array(8), geometry, mesher);
  layer.setSurfaces([spec(0.1)]);
  mesher.release();
  await flush();
  expect(layer.object.children.filter((c) => c.name === 'g-box')).toHaveLength(0);

  layer.setSurfaces([{ ...spec(0.1), drawBox: true }]);
  const boxes = layer.object.children.filter((c) => c.name === 'g-box');
  expect(boxes).toHaveLength(1);
  expect(boxes[0]!.visible).toBe(true);
  // twelve edges of a cuboid, two endpoints each
  const position = (
    boxes[0] as unknown as { geometry: { getAttribute: (n: string) => { count: number } } }
  ).geometry.getAttribute('position');
  expect(position.count).toBe(24);

  // two surfaces of one grid share the box: drawing it twice would only make it brighter
  layer.setSurfaces([
    { ...spec(0.1), drawBox: true },
    { ...spec(0.2), id: 's2', drawBox: true },
  ]);
  expect(layer.object.children.filter((c) => c.name === 'g-box')).toHaveLength(1);

  // and it goes away with the request
  layer.setSurfaces([spec(0.1)]);
  expect(layer.object.children.find((c) => c.name === 'g-box')!.visible).toBe(false);
  layer.dispose();
});

test('a hidden surface does not keep the box on screen', async () => {
  const mesher = controllableMesher();
  const layer = new IsosurfaceLayer('g', new Float32Array(8), geometry, mesher);
  layer.setSurfaces([{ ...spec(0.1), drawBox: true, visible: false }]);
  mesher.release();
  await flush();
  const box = layer.object.children.find((c) => c.name === 'g-box');
  expect(box === undefined || !box.visible).toBe(true);
  layer.dispose();
});
