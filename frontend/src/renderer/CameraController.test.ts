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
