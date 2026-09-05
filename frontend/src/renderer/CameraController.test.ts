import { PerspectiveCamera } from 'three';
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
