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
import { colorsFromValues, makeSampler, sampleAtVertices, symmetricRange } from '../gridSampling';
import type { GridGeometry, IsosurfaceMesh, MarchingCubesOptions } from '../marchingCubes';
import type { DisplayLayer } from './Layer';

/** A second grid painted onto the surface: the values decide the colour, the range the scale. */
export interface ColorSource {
  gridId: string;
  values: Float32Array;
  geometry: GridGeometry;
  /** low and high end of the colour scale, or null to take the range of what was sampled */
  range: [number, number] | null;
}

/** One rendered surface. `inside: 'below'` is the negative lobe of a signed field. */
export interface SurfaceSpec {
  id: string;
  isovalue: number;
  inside: 'above' | 'below';
  step: number;
  color: string;
  opacity: number;
  visible: boolean;
  /** paint the surface with a second grid (electrostatic potential on a density, say) */
  colorSource?: ColorSource | null;
}

/** The meshing service the layer talks to; the worker in the app, a stub in tests. */
export interface Mesher {
  loadGrid(id: string, values: Float32Array, geometry: GridGeometry): void | Promise<void>;
  unloadGrid(id: string): void | Promise<void>;
  compute(gridId: string, opts: MarchingCubesOptions): IsosurfaceMesh | Promise<IsosurfaceMesh>;
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

/** Identity of a values array, so a grid reloaded under the same id counts as a new source. */
const arrayIds = new WeakMap<Float32Array, number>();
let nextArrayId = 0;
function arrayId(a: Float32Array): number {
  let id = arrayIds.get(a);
  if (id === undefined) {
    id = ++nextArrayId;
    arrayIds.set(a, id);
  }
  return id;
}

/** What decides whether the vertex colours have to be written again. */
const colorKey = (s: SurfaceSpec): string =>
  s.colorSource
    ? `${s.colorSource.gridId}#${arrayId(s.colorSource.values)}|${
        s.colorSource.range?.join(':') ?? 'auto'
      }`
    : '';

/** Message for a surface the triangle budget forced to a coarser resolution, or null. */
function coarsenedMessage(spec: SurfaceSpec, mesh: IsosurfaceMesh): string | null {
  if (mesh.step <= spec.step) return null;
  return `Reduced to 1/${mesh.step} resolution to stay within the triangle budget (${Math.round(
    mesh.triangleCount / 1000,
  )}k triangles).`;
}

/** Values sampled onto the current vertices, kept so a range change is a recolour, not a resample. */
interface PaintCache {
  /** identity of the colour grid the values came from */
  source: Float32Array;
  /** identity of the vertex positions they were sampled at */
  positions: Float32Array;
  values: Float32Array;
  min: number;
  max: number;
}

interface Entry {
  mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  key: string;
  /** colour source of the last painting, so a range change repaints without re-meshing */
  colorKey: string;
  sampled: PaintCache | null;
  /** Newest spec waiting to be meshed; a running job picks it up when it finishes. */
  pending: SurfaceSpec | null;
  running: boolean;
  /** False once the surface was removed, so a late result is dropped. */
  alive: boolean;
}

export class IsosurfaceLayer implements DisplayLayer {
  readonly object = new Group();
  visible = true;
  /** called when an asynchronous mesh arrives so the owner can re-render */
  onChange: (() => void) | null = null;
  /** called with a message when a surface had to be coarsened, or null when it no longer is */
  onWarning: ((surfaceId: string, message: string | null) => void) | null = null;
  /** called with the range of the values a colour source painted onto a surface */
  onRange: ((surfaceId: string, range: [number, number]) => void) | null = null;
  private readonly entries = new Map<string, Entry>();
  private readonly ready: Promise<void>;
  private disposed = false;

  constructor(
    readonly id: string,
    values: Float32Array,
    geometry: GridGeometry,
    private readonly mesher: Mesher = worker(),
  ) {
    this.ready = Promise.resolve(this.mesher.loadGrid(id, values, geometry));
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
        entry = {
          mesh,
          key: '',
          colorKey: '',
          sampled: null,
          pending: null,
          running: false,
          alive: true,
        };
        this.entries.set(spec.id, entry);
      }
      this.applyMaterial(entry.mesh, spec);
      const key = meshKey(spec);
      if (key !== entry.key) {
        entry.key = key;
        entry.colorKey = '';
        this.schedule(entry, spec);
      } else if (colorKey(spec) !== entry.colorKey) {
        // same shape, different paint: no need to mesh again
        entry.colorKey = colorKey(spec);
        this.paint(entry, spec);
      }
    }
    for (const [id, entry] of this.entries) {
      if (seen.has(id)) continue;
      this.entries.delete(id);
      entry.alive = false;
      entry.pending = null;
      this.onWarning?.(id, null);
      this.object.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      entry.mesh.material.dispose();
    }
  }

  private applyMaterial(mesh: Mesh<BufferGeometry, MeshStandardMaterial>, spec: SurfaceSpec): void {
    const m = mesh.material;
    // with vertex colours the material colour multiplies them, so it has to be white
    m.vertexColors = !!spec.colorSource;
    m.color = new Color(spec.colorSource ? '#ffffff' : spec.color);
    const transparent = spec.opacity < 1;
    m.transparent = transparent;
    m.opacity = spec.opacity;
    m.depthWrite = !transparent;
    m.side = transparent ? DoubleSide : FrontSide;
    m.needsUpdate = true;
    mesh.renderOrder = transparent ? 10 : 0;
    mesh.visible = spec.visible;
  }

  /**
   * Queue `spec` for meshing. At most one job per surface is in flight; while it runs, further
   * requests only replace the pending spec, so a dragged isovalue slider never piles up work.
   */
  private schedule(entry: Entry, spec: SurfaceSpec): void {
    entry.pending = spec;
    if (entry.running) return;
    this.drain(entry).catch((e: unknown) => console.error('isosurface', e));
  }

  private async drain(entry: Entry): Promise<void> {
    entry.running = true;
    try {
      await this.ready;
      while (entry.pending && entry.alive && !this.disposed) {
        const spec = entry.pending;
        entry.pending = null;
        const mesh: IsosurfaceMesh = await this.mesher.compute(this.id, {
          isovalue: spec.isovalue,
          inside: spec.inside,
          step: spec.step,
        });
        // a newer request arrived while this one ran: drop the stale mesh and compute again
        if (this.disposed || !entry.alive || entry.pending) continue;
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
        geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
        geometry.setIndex(new BufferAttribute(mesh.indices, 1));
        entry.mesh.geometry.dispose();
        entry.mesh.geometry = geometry;
        entry.colorKey = colorKey(spec);
        this.paint(entry, spec);
        this.onWarning?.(spec.id, coarsenedMessage(spec, mesh));
        this.onChange?.();
      }
    } finally {
      entry.running = false;
    }
  }

  /**
   * Write (or clear) the vertex colours sampled from the colour source. Reports the range that
   * was actually found, which is what the panel shows when the range is automatic.
   */
  private paint(entry: Entry, spec: SurfaceSpec): void {
    const geometry = entry.mesh.geometry;
    const position = geometry.getAttribute('position');
    if (!spec.colorSource || !position) {
      entry.sampled = null;
      geometry.deleteAttribute('color');
      this.applyMaterial(entry.mesh, spec);
      return;
    }
    const source = spec.colorSource;
    const positions = position.array as Float32Array;
    let cache = entry.sampled;
    if (!cache || cache.source !== source.values || cache.positions !== positions) {
      const sampled = sampleAtVertices(positions, makeSampler(source.values, source.geometry));
      cache = { source: source.values, positions, ...sampled };
      entry.sampled = cache;
    }
    // an automatic scale is symmetric about zero, so white on the surface means zero
    const [low, high] = source.range ?? symmetricRange(cache.min, cache.max);
    geometry.setAttribute(
      'color',
      new BufferAttribute(colorsFromValues(cache.values, low, high), 3),
    );
    this.applyMaterial(entry.mesh, spec);
    this.onRange?.(spec.id, [cache.min, cache.max]);
    this.onChange?.();
  }

  update(): void {
    // surfaces do not depend on the structure snapshot
  }

  dispose(): void {
    this.disposed = true;
    this.setSurfaces([]);
    void this.mesher.unloadGrid(this.id);
  }
}
