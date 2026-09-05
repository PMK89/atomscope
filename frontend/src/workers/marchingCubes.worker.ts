/**
 * Marching cubes off the main thread. Grids are uploaded once (`loadGrid`) and kept in the
 * worker; each `compute` returns a mesh whose buffers are transferred, not copied.
 */
import { expose, transfer } from 'comlink';
import {
  marchingCubes,
  type GridGeometry,
  type IsosurfaceMesh,
  type MarchingCubesOptions,
} from '../renderer/marchingCubes';

const grids = new Map<string, { values: Float32Array; geometry: GridGeometry }>();

const api = {
  loadGrid(id: string, values: Float32Array, geometry: GridGeometry): void {
    grids.set(id, { values, geometry });
  },
  unloadGrid(id: string): void {
    grids.delete(id);
  },
  compute(gridId: string, opts: MarchingCubesOptions): IsosurfaceMesh {
    const g = grids.get(gridId);
    if (!g) throw new Error(`grid ${gridId} is not loaded in the worker`);
    const mesh = marchingCubes(g.values, g.geometry, opts);
    return transfer(mesh, [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer]);
  },
};

export type MarchingCubesWorkerApi = typeof api;

expose(api);
