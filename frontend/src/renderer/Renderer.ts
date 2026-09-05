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

export type Projection = 'perspective' | 'orthographic';

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

  /** Add a display layer (e.g. isosurfaces) on top of the structure layer. */
  addLayer(layer: DisplayLayer): void {
    if (this.layers.includes(layer)) return;
    this.layers.push(layer);
    this.scene.add(layer.object);
    if (this.ctx) layer.update(this.ctx);
    this.invalidate();
  }

  /** Remove and dispose a layer added with `addLayer`. */
  removeLayer(layer: DisplayLayer): void {
    const idx = this.layers.indexOf(layer);
    if (idx < 0 || layer === this.structureLayer) return;
    this.layers.splice(idx, 1);
    this.scene.remove(layer.object);
    layer.dispose();
    this.invalidate();
  }

  /** Push a new structure snapshot to all layers. */
  update(ctx: LayerContext): void {
    this.ctx = ctx;
    for (const layer of this.layers) if (layer.visible) layer.update(ctx);
    this.invalidate();
  }

  fitToStructure(): void {
    if (!this.ctx || this.ctx.structure.atoms.length === 0) {
      this.controller.fit(new Vector3(), 5);
      return;
    }
    const c = new Vector3();
    for (const a of this.ctx.structure.atoms) c.add(new Vector3(...a.position));
    c.divideScalar(this.ctx.structure.atoms.length);
    let r = 0;
    for (const a of this.ctx.structure.atoms)
      r = Math.max(r, c.distanceTo(new Vector3(...a.position)));
    this.controller.fit(c, r + 1.5);
  }

  /** Atom index under the pointer (client coordinates), or null. */
  pickAtom(clientX: number, clientY: number): number | null {
    const rect = this.gl.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.structureLayer.pickables, false);
    for (const hit of hits) {
      const idx = this.structureLayer.atomIndexForInstance(hit.object, hit.instanceId);
      if (idx !== null) return idx;
    }
    return null;
  }

  /** World-space point on the plane through the pivot facing the camera, for placing atoms. */
  unprojectOnPivotPlane(clientX: number, clientY: number): Vector3 {
    const rect = this.gl.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const normal = this.controller.viewDirection(new Vector3());
    const denom = normal.dot(this.raycaster.ray.direction);
    const t =
      normal.dot(new Vector3().subVectors(this.controller.pivot, this.raycaster.ray.origin)) /
      denom;
    return this.raycaster.ray.at(t, new Vector3());
  }

  screenshotDataUrl(type = 'image/png'): string {
    this.renderNow();
    return this.gl.domElement.toDataURL(type);
  }

  invalidate(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.renderNow();
    });
  }

  private renderNow(): void {
    this.gl.render(this.scene, this.camera);
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
