import { expect, test, vi } from 'vitest';
import { imageDataUrl } from './imageData';

/** jsdom has no 2D canvas; a stub that keeps what was drawn is enough to check the pixels. */
function stubCanvas(): { data: Uint8ClampedArray | null; types: string[] } {
  const captured: { data: Uint8ClampedArray | null; types: string[] } = { data: null, types: [] };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: (image: { data: Uint8ClampedArray }) => {
          captured.data = image.data;
        },
      }) as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation((type?: string) => {
    captured.types.push(type ?? 'image/png');
    return `data:${type ?? 'image/png'};base64,AA`;
  });
  return captured;
}

test('rows are flipped, because WebGL reads bottom-up and a canvas draws top-down', () => {
  const captured = stubCanvas();
  // two rows of one pixel: red at the bottom, blue at the top of the GL buffer
  const pixels = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]);
  const url = imageDataUrl(pixels, 1, 2);

  expect(url.startsWith('data:image/png')).toBe(true);
  expect([...captured.data!.slice(0, 4)]).toEqual([0, 0, 255, 255]);
  expect([...captured.data!.slice(4, 8)]).toEqual([255, 0, 0, 255]);
  vi.restoreAllMocks();
});

test('a JPEG gets a white background instead of a transparent one', () => {
  const captured = stubCanvas();
  imageDataUrl(new Uint8Array([0, 0, 0, 0]), 1, 1, 'image/jpeg');

  // fully transparent black becomes opaque white, not black
  expect([...captured.data!]).toEqual([255, 255, 255, 255]);
  expect(captured.types).toEqual(['image/jpeg']);
  vi.restoreAllMocks();
});

test('a half-transparent pixel is blended, not replaced', () => {
  const captured = stubCanvas();
  imageDataUrl(new Uint8Array([0, 0, 0, 128]), 1, 1, 'image/jpeg');
  expect(captured.data![0]).toBeGreaterThan(120);
  expect(captured.data![0]).toBeLessThan(135);
  vi.restoreAllMocks();
});
