/**
 * Owns the WebGL context, scene, lights, cameras and display layers. Rendering is on demand:
 * call `invalidate()` after any change; a frame is scheduled via requestAnimationFrame.
 */
import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { CameraController, type AnyCamera } from './CameraController';
import type { DisplayLayer, LayerContext } from './layers/Layer';
import { StructureLayer } from './layers/StructureLayer';
import { imageDataUrl } from './imageData';
import { principalAxes } from './principalAxes';

export type Projection = 'perspective' | 'orthographic';

export type PickResult = { kind: 'atom'; index: number } | { kind: 'bond'; index: number };

/** Vite's `import.meta.env` without pulling `vite/client` into the app tsconfig. */
interface ViteMeta {
  readonly env?: { readonly DEV?: boolean };
}
const IS_DEV = (import.meta as unknown as ViteMeta).env?.DEV === true;

declare global {
  interface Window {
    /** Development-only handle used by `e2e/perf.spec.ts`; undefined in production builds. */
    __atomscopeRenderer?: Renderer;
  }
}

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
  /** Frames actually drawn since construction (one integer increment per frame). */
  frameCount = 0;
  /** Called after each drawn frame. Null in the application; set by the performance harness. */
  onFrame: ((count: number) => void) | null = null;

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
    if (IS_DEV) window.__atomscopeRenderer = this;
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
    if (this.scene.fog) this.scene.fog.color = new Color(hex);
    this.invalidate();
  }

  /**
   * Depth cueing: distant atoms fade into the background, which is what tells the eye which end
   * of a large molecule is nearer. The band follows the camera, so it works at any zoom.
   */
  setFog(enabled: boolean): void {
    if (enabled === !!this.scene.fog) return;
    this.scene.fog = enabled
      ? new Fog(
          this.scene.background instanceof Color ? this.scene.background.getHex() : 0xffffff,
          1,
          100,
        )
      : null;
    this.invalidate();
  }

  /** Put the fog band around whatever the camera is looking at, just before rendering. */
  private updateFog(): void {
    const fog = this.scene.fog;
    if (!(fog instanceof Fog)) return;
    const distance = this.camera.position.distanceTo(this.controller.pivot);
    fog.near = distance;
    fog.far = distance * 2.2;
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
    // periodic images are part of what is drawn, so they are part of what has to fit on screen
    const cell = this.ctx.cellOverride ?? this.ctx.structure.cell?.vectors ?? null;
    const images = this.structureLayer.imageExtent(cell);
    c.add(new Vector3(...images.center));
    r += images.radius;
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

  /**
   * Largest image the GPU will render in one go. A render target above the texture limit fails
   * silently, so the export offers nothing bigger.
   */
  get maxImageSize(): number {
    return this.gl.capabilities.maxTextureSize;
  }

  /** Size of the drawing buffer in CSS pixels, which is what an export scales up from. */
  get viewportSize(): { width: number; height: number } {
    const size = new Vector2();
    this.gl.getSize(size);
    return { width: Math.max(1, Math.round(size.x)), height: Math.max(1, Math.round(size.y)) };
  }

  /**
   * Render one frame at an arbitrary size and return it as a data URL.
   *
   * It goes through a render target rather than the canvas: the export size is then independent
   * of the window, nothing flickers on screen, and a transparent background is possible even
   * though the on-screen context has no alpha channel (`alpha: false` is what keeps the viewport
   * cheap).
   */
  exportImage(options: {
    width: number;
    height: number;
    transparent?: boolean;
    type?: string;
    quality?: number;
  }): string {
    const { width, height, transparent = false, type = 'image/png', quality = 0.92 } = options;
    const limit = this.maxImageSize;
    if (width > limit || height > limit) {
      throw new Error(`this GPU renders at most ${limit} pixels across`);
    }
    const target = new WebGLRenderTarget(width, height, { samples: 4 });
    const background = this.scene.background;
    const fog = this.scene.fog;
    const alpha = this.gl.getClearAlpha();
    const aspect = this.perspective.aspect;
    if (transparent) {
      this.scene.background = null;
      this.gl.setClearAlpha(0);
      // fog fades distant atoms towards the background colour, which is not there any more:
      // over transparency it would leave an opaque halo the viewport never showed.
      this.scene.fog = null;
    } else {
      this.updateFog();
    }
    this.perspective.aspect = width / height;
    this.perspective.updateProjectionMatrix();
    const buffer = new Uint8Array(width * height * 4);
    try {
      this.gl.setRenderTarget(target);
      this.gl.clear();
      this.gl.render(this.scene, this.camera);
      // the overlay pass draws the axes gizmo; the export is what the viewport shows
      for (const layer of this.layers)
        if (layer.visible && layer.renderOverlay) layer.renderOverlay(this.gl, this.camera);
      this.gl.readRenderTargetPixels(target, 0, 0, width, height, buffer);
    } finally {
      this.gl.setRenderTarget(null);
      this.scene.background = background;
      this.scene.fog = fog;
      this.gl.setClearAlpha(alpha);
      this.perspective.aspect = aspect;
      this.perspective.updateProjectionMatrix();
      target.dispose();
    }
    return imageDataUrl(buffer, width, height, type, quality);
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
    this.updateFog();
    this.gl.render(this.scene, this.camera);
    for (const layer of this.layers)
      if (layer.visible && layer.renderOverlay) layer.renderOverlay(this.gl, this.camera);
    this.frameCount++;
    this.onFrame?.(this.frameCount);
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
    if (IS_DEV && window.__atomscopeRenderer === this) delete window.__atomscopeRenderer;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.controller.dispose();
    for (const layer of this.layers) layer.dispose();
    this.gl.dispose();
    this.gl.domElement.remove();
  }
}
