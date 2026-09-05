import { CanvasTexture, Sprite, SpriteMaterial } from 'three';

/**
 * A billboard label. Returns null where no 2D canvas is available (tests, headless), so callers
 * simply skip labels there.
 */
export function makeTextSprite(text: string, color: string, worldSize = 0.6): Sprite | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 32, 34);
  const texture = new CanvasTexture(canvas);
  const sprite = new Sprite(new SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.set(worldSize, worldSize, 1);
  return sprite;
}

export function disposeSprite(sprite: Sprite): void {
  sprite.material.map?.dispose();
  sprite.material.dispose();
}
