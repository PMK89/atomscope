import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { CameraController } from './CameraController';

describe('CameraController listener lifetime', () => {
  test('dispose removes the contextmenu handler', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const controller = new CameraController(new PerspectiveCamera(), el);

    const before = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
    el.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);

    controller.dispose();
    const after = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
    el.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
    el.remove();
  });
});

test('setPivot moves what the camera looks at, not how it looks at it', () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const camera = new PerspectiveCamera();
  const controller = new CameraController(camera, el);
  controller.fit(new Vector3(0, 0, 0), 4);
  const distance = camera.position.distanceTo(controller.pivot);
  const direction = controller.viewDirection(new Vector3()).clone();

  // View ▸ Centre: the structure comes back to the middle at the zoom and angle it was at
  controller.setPivot(new Vector3(10, -3, 2));
  expect(controller.pivot.toArray()).toEqual([10, -3, 2]);
  expect(camera.position.distanceTo(controller.pivot)).toBeCloseTo(distance, 6);
  const after = controller.viewDirection(new Vector3());
  expect(after.dot(direction)).toBeCloseTo(1, 6);
  controller.dispose();
  el.remove();
});

describe('rotating about a reference point', () => {
  const setUp = (): {
    controller: CameraController;
    camera: PerspectiveCamera;
    el: HTMLElement;
  } => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientHeight', { value: 600 });
    document.body.appendChild(el);
    const camera = new PerspectiveCamera();
    const controller = new CameraController(camera, el);
    controller.fit(new Vector3(0, 0, 0), 4);
    return { controller, camera, el };
  };

  test('orbitAbout keeps the camera at its distance from that point, not from the pivot', () => {
    const { controller, camera } = setUp();
    const about = new Vector3(3, 1, 0);
    const before = camera.position.distanceTo(about);
    const radius = camera.position.distanceTo(controller.pivot);

    controller.orbitAbout(about, 90, 40);

    expect(camera.position.distanceTo(about)).toBeCloseTo(before, 6);
    // the pivot travels the same arc, so the view is still framed the way it was
    expect(camera.position.distanceTo(controller.pivot)).toBeCloseTo(radius, 6);
    expect(controller.pivot.distanceTo(about)).toBeCloseTo(about.length(), 6);
  });

  test('and it is still looking at the pivot afterwards', () => {
    const { controller, camera } = setUp();
    controller.orbitAbout(new Vector3(3, 1, 0), 70, -30);
    const towards = controller.pivot.clone().sub(camera.position).normalize();
    const facing = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    expect(towards.distanceTo(facing)).toBeLessThan(1e-6);
  });

  test('about the pivot itself, it is the plain orbit', () => {
    const { controller: a } = setUp();
    const { controller: b } = setUp();
    a.orbit(55, 25);
    b.orbitAbout(b.pivot.clone(), 55, 25);
    expect(b.camera.position.toArray()).toEqual(a.camera.position.toArray());
    expect(b.pivot.toArray()).toEqual(a.pivot.toArray());
  });

  test('a drag asks for the reference once, at the start, and lets go of it at the end', () => {
    const { controller, camera, el } = setUp();
    const asked: Array<[number, number]> = [];
    const about = new Vector3(3, 1, 0);
    controller.rotationReference = (x, y) => {
      asked.push([x, y]);
      return about;
    };
    const before = camera.position.distanceTo(about);

    el.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 60, clientY: 30 }));
    expect(asked).toEqual([[10, 10]]);
    expect(camera.position.distanceTo(about)).toBeCloseTo(before, 6);

    window.dispatchEvent(new MouseEvent('pointerup', {}));
    // a pan is not asked at all: the reference is only for rotation
    el.dispatchEvent(new MouseEvent('pointerdown', { button: 2, clientX: 10, clientY: 10 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 60, clientY: 30 }));
    expect(asked).toHaveLength(1);
    window.dispatchEvent(new MouseEvent('pointerup', {}));
  });

  test('no reference provider, and it turns about the pivot as it always did', () => {
    const { controller, camera, el } = setUp();
    const radius = camera.position.distanceTo(controller.pivot);
    const pivot = controller.pivot.clone();

    el.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 60, clientY: 30 }));
    window.dispatchEvent(new MouseEvent('pointerup', {}));

    expect(controller.pivot.toArray()).toEqual(pivot.toArray());
    expect(camera.position.distanceTo(controller.pivot)).toBeCloseTo(radius, 6);
  });
});
