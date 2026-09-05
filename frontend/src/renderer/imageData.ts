/**
 * Turning a block of pixels read back from the GPU into an image.
 *
 * WebGL reads rows bottom-up while a canvas draws them top-down, so the rows are flipped on the
 * way in; a JPEG has no alpha, so a transparent background would come out black and is filled
 * with white instead.
 */
export function imageDataUrl(
  pixels: Uint8Array,
  width: number,
  height: number,
  type = 'image/png',
  quality = 0.92,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const image = ctx.createImageData(width, height);
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    const from = (height - 1 - y) * row;
    image.data.set(pixels.subarray(from, from + row), y * row);
  }
  if (type !== 'image/png') flattenOntoWhite(image.data);
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL(type, quality);
}

function flattenOntoWhite(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]! / 255;
    for (let k = 0; k < 3; k++) data[i + k] = Math.round(data[i + k]! * a + 255 * (1 - a));
    data[i + 3] = 255;
  }
}
