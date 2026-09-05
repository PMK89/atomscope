import { CanvasTexture, Sprite, SpriteMaterial } from 'three';

/**
 * A billboard label. Returns null where no 2D canvas is available (tests, headless), so callers
 * simply skip labels there.
 */
const FONT = 'bold 44px system-ui, sans-serif';
const CELL = 64;

export function makeTextSprite(text: string, color: string, worldSize = 0.6): Sprite | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // Size the canvas to the text: a single character keeps the original 64x64 cell, and a longer
  // label ("C12", "-0.34") gets a wider one instead of being clipped by it.
  ctx.font = FONT;
  const width = Math.max(CELL, Math.ceil(ctx.measureText(text).width) + 16);
  canvas.width = width;
  canvas.height = CELL;
  ctx.font = FONT; // resizing the canvas resets the context
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, width / 2, CELL / 2 + 2);
  const texture = new CanvasTexture(canvas);
  const sprite = new Sprite(new SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.set((worldSize * width) / CELL, worldSize, 1);
  return sprite;
}

export function disposeSprite(sprite: Sprite): void {
  sprite.material.map?.dispose();
  sprite.material.dispose();
}
