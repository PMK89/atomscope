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

const emptyMesh = (): IsosurfaceMesh => ({
  positions: new Float32Array(9),
  normals: new Float32Array(9),
  indices: new Uint32Array([0, 1, 2]),
  vertexCount: 3,
  triangleCount: 1,
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
