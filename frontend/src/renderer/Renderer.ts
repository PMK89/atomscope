/**
 * Owns the WebGL context, scene, lights, cameras and display layers. Rendering is on demand:
 * call `invalidate()` after any change; a frame is scheduled via requestAnimationFrame.
 */
import {
  AmbientLight,
  Color,
  DirectionalLight,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { CameraController, type AnyCamera } from './CameraController';
import type { DisplayLayer, LayerContext } from './layers/Layer';
import { StructureLayer } from './layers/StructureLayer';
import { principalAxes } from './principalAxes';

export type Projection = 'perspective' | 'orthographic';

export type PickResult = { kind: 'atom'; index: number } | { kind: 'bond'; index: number };

export class Renderer {
  readonly scene = new Scene();
  readonly gl: WebGLRenderer;
  readonly controller: CameraController;
  readonly structureLayer = new StructureLayer();
  private readonly layers: DisplayLayer[] = [this.structureLayer];
  private perspective = new PerspectiveCamera(40, 1, 0.1, 5000);
  private orthographic = new OrthographicCamera(-10, 10, 10, -10, -5000, 5000);
  private camera: AnyCamera = this.perspective;
  private readonly keyLight = new DirectionalLight(0xffffff, 2.2);
  private frame: number | null = null;
  private readonly observer: ResizeObserver;
  private readonly raycaster = new Raycaster();
  private ctx: LayerContext | null = null;
  /** Called whenever a frame is scheduled (camera or content changed); used by HTML overlays. */
  onInvalidate: (() => void) | null = null;

  constructor(private readonly container: HTMLElement) {
    this.gl = new WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.domElement.style.display = 'block';
    container.appendChild(this.gl.domElement);
    this.scene.background = new Color(0xffffff);
    this.scene.add(new AmbientLight(0xffffff, 0.9));
    this.keyLight.position.set(1, 1.5, 2);
    this.scene.add(this.keyLight);
    for (const layer of this.layers) this.scene.add(layer.object);
    this.controller = new CameraController(this.camera, this.gl.domElement);
    this.controller.onChange = () => {
      // light follows the camera so shading stays readable from every angle
      this.keyLight.position.copy(this.camera.position).sub(this.controller.pivot);
      this.keyLight.position.add(new Vector3(0, 0.3, 0).applyQuaternion(this.camera.quaternion));
      this.invalidate();
    };
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  get projection(): Projection {
    return this.camera === this.perspective ? 'perspective' : 'orthographic';
  }

  setProjection(p: Projection): void {
    this.camera = p === 'perspective' ? this.perspective : this.orthographic;
    this.controller.setCamera(this.camera);
    this.resize();
  }

  setBackground(hex: number): void {
    this.scene.background = new Color(hex);
    this.invalidate();
  }

  /** Push a new structure snapshot to all layers. */
  update(ctx: LayerContext): void {
    this.ctx = ctx;
    for (const layer of this.layers) {
      layer.object.visible = layer.visible;
      if (layer.visible) layer.update(ctx);
    }
    this.invalidate();
  }

  /** Add a display layer (no-op if a layer with the same id exists). */
  addLayer(layer: DisplayLayer): void {
    if (this.getLayer(layer.id)) return;
    this.layers.push(layer);
    this.scene.add(layer.object);
    if (this.ctx && layer.visible) layer.update(this.ctx);
    this.invalidate();
  }

  /**
   * Detach a layer from the scene. Passing the layer object also disposes it; passing an id
   * only detaches (the caller owns `dispose()`). The structure layer cannot be removed.
   */
  removeLayer(layerOrId: DisplayLayer | string): DisplayLayer | undefined {
    const id = typeof layerOrId === 'string' ? layerOrId : layerOrId.id;
    const idx = this.layers.findIndex((l) => l.id === id);
    if (idx < 0) return undefined;
    const [layer] = this.layers.splice(idx, 1);
    if (!layer || layer === this.structureLayer) return undefined;
    this.scene.remove(layer.object);
    if (typeof layerOrId !== 'string') layer.dispose();
    this.invalidate();
    return layer;
  }

  getLayer(id: string): DisplayLayer | undefined {
    return this.layers.find((l) => l.id === id);
  }

  fitToStructure(): void {
    if (!this.ctx || this.ctx.structure.atoms.length === 0) {
      this.controller.fit(new Vector3(), 5);
      return;
    }
    const atoms = this.ctx.structure.atoms;
    const flat = new Float64Array(atoms.length * 3);
    atoms.forEach((a, i) => flat.set(a.position, 3 * i));
    const pa = principalAxes(flat, atoms.length);
    const c = pa ? new Vector3(...pa.center) : new Vector3(...(atoms[0]?.position ?? [0, 0, 0]));
    let r = 0;
    for (const a of atoms) r = Math.max(r, c.distanceTo(new Vector3(...a.position)));
    // Default orientation: look along the axis of least extent, largest extent horizontal.
    if (pa && pa.variances[0] > 1e-6) {
      const view = new Vector3(...pa.axes[2]);
      const up = new Vector3(...pa.axes[1]);
      this.controller.lookAlong(view, up);
    }
    this.controller.fit(c, r + 1.5);
  }

  /** Atom index under the pointer (client coordinates), or null. */
  pickAtom(clientX: number, clientY: number): number | null {
    const hit = this.pick(clientX, clientY);
    return hit?.kind === 'atom' ? hit.index : null;
  }

  /** Nearest atom or bond under the pointer (client coordinates), or null. */
  pick(clientX: number, clientY: number): PickResult | null {
    this.setRay(clientX, clientY);
    const hits = this.raycaster.intersectObjects(this.structureLayer.pickables, false);
    for (const hit of hits) {
      const atom = this.structureLayer.atomIndexForInstance(hit.object, hit.instanceId);
      if (atom !== null) return { kind: 'atom', index: atom };
      const bond = this.structureLayer.bondIndexForInstance(hit.object, hit.instanceId);
      if (bond !== null) return { kind: 'bond', index: bond };
    }
    return null;
  }

  /** World-space point on the plane through the pivot facing the camera, for placing atoms. */
  unprojectOnPivotPlane(clientX: number, clientY: number): Vector3 {
    return this.unprojectOnPlane(clientX, clientY, this.controller.pivot);
  }

  /** World-space point on the camera-facing plane through `planePoint`. */
  unprojectOnPlane(clientX: number, clientY: number, planePoint: Vector3): Vector3 {
    this.setRay(clientX, clientY);
    const normal = this.controller.viewDirection(new Vector3());
    const denom = normal.dot(this.raycaster.ray.direction);
    const t = normal.dot(new Vector3().subVectors(planePoint, this.raycaster.ray.origin)) / denom;
    return this.raycaster.ray.at(t, new Vector3());
  }

  /** Project a world point to CSS pixels relative to the canvas' top-left corner. */
  project(world: Vector3): { x: number; y: number } {
    const rect = this.gl.domElement.getBoundingClientRect();
    const v = world.clone().project(this.camera);
    return { x: ((v.x + 1) / 2) * rect.width, y: ((1 - v.y) / 2) * rect.height };
  }

  /** Client coordinates -> CSS pixels relative to the canvas' top-left corner. */
  toCanvasCoords(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.gl.domElement.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  private setRay(clientX: number, clientY: number): void {
    const rect = this.gl.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
  }

  screenshotDataUrl(type = 'image/png'): string {
    this.renderNow();
    return this.gl.domElement.toDataURL(type);
  }

  invalidate(): void {
    this.onInvalidate?.();
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.renderNow();
    });
  }

  private renderNow(): void {
    this.gl.render(this.scene, this.camera);
    for (const layer of this.layers)
      if (layer.visible && layer.renderOverlay) layer.renderOverlay(this.gl, this.camera);
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.gl.setSize(w, h, false);
    this.perspective.aspect = w / h;
    this.perspective.updateProjectionMatrix();
    const half = (this.orthographic.top - this.orthographic.bottom) / 2;
    this.orthographic.left = -half * (w / h);
    this.orthographic.right = half * (w / h);
    this.orthographic.updateProjectionMatrix();
    this.invalidate();
  }

  dispose(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.controller.dispose();
    for (const layer of this.layers) layer.dispose();
    this.gl.dispose();
    this.gl.domElement.remove();
  }
}
