/**
 * Isosurfaces of one volumetric grid. Meshing runs in the shared marching-cubes worker; the
 * layer owns one Mesh per surface and swaps geometry when a result arrives. Transparent
 * surfaces render double-sided without depth writes and after the opaque scene.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  FrontSide,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { wrap, type Remote } from 'comlink';
import type { MarchingCubesWorkerApi } from '../../workers/marchingCubes.worker';
import type { GridGeometry, IsosurfaceMesh } from '../marchingCubes';
import type { DisplayLayer } from './Layer';

/** One rendered surface. `inside: 'below'` is the negative lobe of a signed field. */
export interface SurfaceSpec {
  id: string;
  isovalue: number;
  inside: 'above' | 'below';
  step: number;
  color: string;
  opacity: number;
  visible: boolean;
}

let sharedWorker: Remote<MarchingCubesWorkerApi> | null = null;
function worker(): Remote<MarchingCubesWorkerApi> {
  sharedWorker ??= wrap<MarchingCubesWorkerApi>(
    new Worker(new URL('../../workers/marchingCubes.worker.ts', import.meta.url), {
      type: 'module',
    }),
  );
  return sharedWorker;
}

const meshKey = (s: SurfaceSpec): string => `${s.isovalue}|${s.inside}|${s.step}`;

interface Entry {
  mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  key: string;
  request: number;
}

export class IsosurfaceLayer implements DisplayLayer {
  readonly object = new Group();
  visible = true;
  /** called when an asynchronous mesh arrives so the owner can re-render */
  onChange: (() => void) | null = null;
  private readonly entries = new Map<string, Entry>();
  private readonly ready: Promise<void>;
  private disposed = false;

  constructor(
    readonly id: string,
    values: Float32Array,
    geometry: GridGeometry,
  ) {
    this.ready = worker().loadGrid(id, values, geometry);
  }

  /** Reconcile the rendered meshes with `specs` (added, changed or removed surfaces). */
  setSurfaces(specs: SurfaceSpec[]): void {
    const seen = new Set<string>();
    for (const spec of specs) {
      seen.add(spec.id);
      let entry = this.entries.get(spec.id);
      if (!entry) {
        const mesh = new Mesh(new BufferGeometry(), new MeshStandardMaterial({ roughness: 0.4 }));
        mesh.name = spec.id;
        this.object.add(mesh);
        entry = { mesh, key: '', request: 0 };
        this.entries.set(spec.id, entry);
      }
      this.applyMaterial(entry.mesh, spec);
      const key = meshKey(spec);
      if (key !== entry.key) {
        entry.key = key;
        this.recompute(entry, spec).catch((e: unknown) => console.error('isosurface', e));
      }
    }
    for (const [id, entry] of this.entries) {
      if (seen.has(id)) continue;
      this.entries.delete(id);
      this.object.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      entry.mesh.material.dispose();
    }
  }

  private applyMaterial(mesh: Mesh<BufferGeometry, MeshStandardMaterial>, spec: SurfaceSpec): void {
    const m = mesh.material;
    m.color = new Color(spec.color);
    const transparent = spec.opacity < 1;
    m.transparent = transparent;
    m.opacity = spec.opacity;
    m.depthWrite = !transparent;
    m.side = transparent ? DoubleSide : FrontSide;
    m.needsUpdate = true;
    mesh.renderOrder = transparent ? 10 : 0;
    mesh.visible = spec.visible;
  }

  private async recompute(entry: Entry, spec: SurfaceSpec): Promise<void> {
    const request = ++entry.request;
    await this.ready;
    const mesh: IsosurfaceMesh = await worker().compute(this.id, {
      isovalue: spec.isovalue,
      inside: spec.inside,
      step: spec.step,
    });
    if (this.disposed || entry.request !== request) return; // superseded or gone
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
    geometry.setIndex(new BufferAttribute(mesh.indices, 1));
    entry.mesh.geometry.dispose();
    entry.mesh.geometry = geometry;
    this.onChange?.();
  }

  update(): void {
    // surfaces do not depend on the structure snapshot
  }

  dispose(): void {
    this.disposed = true;
    this.setSurfaces([]);
    void worker().unloadGrid(this.id);
  }
}
