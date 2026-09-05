/**
 * Trackball-style navigation: left drag rotates about the pivot, right/middle drag (or
 * shift+left) pans, wheel zooms. Works for both perspective and orthographic cameras.
 */
import {
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Spherical,
  Vector2,
  Vector3,
} from 'three';

export type AnyCamera = PerspectiveCamera | OrthographicCamera;

export class CameraController {
  readonly pivot = new Vector3();
  /** Distance from camera to pivot (perspective) or half-height of the view (orthographic). */
  private readonly spherical = new Spherical(20, Math.PI / 2, 0);
  private readonly last = new Vector2();
  private mode: 'none' | 'rotate' | 'pan' = 'none';
  private readonly quat = new Quaternion();
  private readonly quatInv = new Quaternion();
  rotateSpeed = 1.0;
  zoomSpeed = 1.0;
  /** When false, pointer drags are ignored (editor tools drive the camera explicitly). */
  enabled = true;
  onChange: (() => void) | null = null;

  constructor(
    public camera: AnyCamera,
    private readonly element: HTMLElement,
  ) {
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('wheel', this.onWheel, { passive: false });
    element.addEventListener('contextmenu', this.onContextMenu);
    this.updateCamera();
  }

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('wheel', this.onWheel);
    this.element.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
  }

  /**
   * Orient the camera to look along `direction` (from camera towards the pivot); the camera's
   * up vector is aligned with `up` as far as possible.
   */
  lookAlong(direction: Vector3, up?: Vector3): void {
    const offset = direction.clone().normalize().multiplyScalar(-1);
    if (offset.lengthSq() < 1e-12) return;
    this.spherical.setFromVector3(offset.multiplyScalar(this.spherical.radius));
    this.spherical.phi = Math.max(1e-3, Math.min(Math.PI - 1e-3, this.spherical.phi));
    this.updateCamera();
    if (up) {
      // roll so that `up` projects to screen-up
      const right = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      const camUp = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
      const angle = Math.atan2(up.dot(right), up.dot(camUp));
      if (Math.abs(angle) > 1e-6 && typeof (this as { roll?: unknown }).roll === 'function') {
        (this as unknown as { roll: (a: number) => void }).roll(angle);
      }
    }
  }

  /** Frame a sphere (center, radius) so it fills the view. */
  fit(center: Vector3, radius: number): void {
    this.pivot.copy(center);
    const r = Math.max(radius, 1.0);
    if (this.camera instanceof PerspectiveCamera) {
      const fov = (this.camera.fov * Math.PI) / 180;
      this.spherical.radius = (r * 1.15) / Math.sin(fov / 2);
    } else {
      this.spherical.radius = r * 2.6;
      this.applyOrthoZoom(r * 1.15);
    }
    this.updateCamera();
  }

  setCamera(camera: AnyCamera): void {
    const dir = new Vector3().setFromSpherical(this.spherical);
    this.camera = camera;
    if (camera instanceof OrthographicCamera) this.applyOrthoZoom(this.spherical.radius * 0.45);
    this.camera.position.copy(this.pivot).add(dir);
    this.updateCamera();
  }

  private applyOrthoZoom(halfHeight: number): void {
    if (!(this.camera instanceof OrthographicCamera)) return;
    const aspect = (this.camera.right - this.camera.left) / (this.camera.top - this.camera.bottom);
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.right = halfHeight * aspect;
    this.camera.left = -halfHeight * aspect;
    this.camera.updateProjectionMatrix();
  }

  private updateCamera(): void {
    const offset = new Vector3().setFromSpherical(this.spherical);
    this.camera.position.copy(this.pivot).add(offset);
    this.camera.lookAt(this.pivot);
    this.camera.updateMatrixWorld();
    this.onChange?.();
  }

  /** Move the pivot, keeping the current view direction and distance. */
  setPivot(center: Vector3): void {
    this.pivot.copy(center);
    this.updateCamera();
  }

  /** Orbit by screen-space deltas (pixels), same mapping as a left drag. */
  orbit(dx: number, dy: number): void {
    const h = this.element.clientHeight || 1;
    this.rotateBy(
      (2 * Math.PI * dx * this.rotateSpeed) / h,
      (2 * Math.PI * dy * this.rotateSpeed) / h,
    );
  }

  /** Orbit by angles (radians): azimuth about the vertical axis, then polar. */
  rotateBy(azimuth: number, polar: number): void {
    this.spherical.theta -= azimuth;
    this.spherical.phi -= polar;
    this.spherical.phi = Math.max(1e-3, Math.min(Math.PI - 1e-3, this.spherical.phi));
    this.updateCamera();
  }

  /** Camera axes in world space: right, up and forward (towards the pivot). */
  axes(): { right: Vector3; up: Vector3; forward: Vector3 } {
    return {
      right: new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).normalize(),
      up: new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1).normalize(),
      forward: this.viewDirection(new Vector3()),
    };
  }

  /** Roll the camera about the view direction (radians). */
  roll(angle: number): void {
    this.camera.up.applyAxisAngle(this.viewDirection(new Vector3()), angle).normalize();
    this.updateCamera();
  }

  /** Undo any roll so the vertical axis is up again. */
  resetRoll(): void {
    this.camera.up.set(0, 1, 0);
    this.updateCamera();
  }

  /** Zoom by a factor (>1 zooms in), same mapping as the wheel. */
  zoomBy(factor: number): void {
    if (this.camera instanceof PerspectiveCamera) {
      this.spherical.radius = Math.max(0.5, this.spherical.radius / factor);
    } else {
      this.camera.zoom = Math.max(0.05, this.camera.zoom * factor);
      this.camera.updateProjectionMatrix();
    }
    this.updateCamera();
  }

  /** World-space height of the view at the pivot plane per screen pixel. */
  worldPerPixel(): number {
    return this.viewHeightAtPivot() / (this.element.clientHeight || 1);
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    if (e.button === 0 && !e.shiftKey) this.mode = 'rotate';
    else this.mode = 'pan';
    this.last.set(e.clientX, e.clientY);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const dx = e.clientX - this.last.x;
    const dy = e.clientY - this.last.y;
    this.last.set(e.clientX, e.clientY);
    const h = this.element.clientHeight || 1;
    if (this.mode === 'rotate') {
      this.orbit(dx, dy);
    } else if (this.mode === 'pan') {
      const scale = this.viewHeightAtPivot() / h;
      const right = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      const up = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
      this.pivot.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
      this.updateCamera();
    }
  };

  private viewHeightAtPivot(): number {
    if (this.camera instanceof PerspectiveCamera) {
      return 2 * this.spherical.radius * Math.tan((this.camera.fov * Math.PI) / 360);
    }
    return (this.camera.top - this.camera.bottom) / this.camera.zoom;
  }

  private readonly onPointerUp = (): void => {
    this.mode = 'none';
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.zoomBy(Math.pow(0.95, (-e.deltaY / 53) * this.zoomSpeed));
  };

  private readonly onContextMenu = (e: Event): void => e.preventDefault();

  /** Current view direction (from camera towards pivot). */
  viewDirection(out: Vector3): Vector3 {
    return out.copy(this.pivot).sub(this.camera.position).normalize();
  }

  get rotation(): Quaternion {
    this.quat.copy(this.camera.quaternion);
    return this.quat;
  }

  get rotationInverse(): Quaternion {
    return this.quatInv.copy(this.camera.quaternion).invert();
  }
}
