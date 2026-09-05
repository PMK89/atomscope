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

  layer.setSurfaces([{ ...spec(0.1), colorSource: colorSource() }]);
  await flush();

  const mesh = layer.object.children[0] as { geometry: { getAttribute(n: string): unknown } };
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

  const mesh = layer.object.children[0] as { geometry: { getAttribute(n: string): unknown } };
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

  const mesh = layer.object.children[0] as {
    geometry: { getAttribute(n: string): unknown };
    material: { vertexColors: boolean };
  };
  expect(mesh.geometry.getAttribute('color')).toBeUndefined();
  expect(mesh.material.vertexColors).toBe(false);
  layer.dispose();
});
