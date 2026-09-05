import { expect, test, type Page } from '@playwright/test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CUBE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../backend/tests/fixtures/cppaw/h2o/case_total_density.cub.gz',
);

/** pixels whose colour is dominated by blue (the default density colour) */
async function bluePixels(page: Page): Promise<number> {
  return page.locator('.viewport-canvas canvas').evaluate((c: HTMLCanvasElement) => {
    const gl = c.getContext('webgl2', {
      preserveDrawingBuffer: true,
    }) as WebGL2RenderingContext | null;
    if (!gl) return -1;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0;
    for (let i = 0; i < px.length; i += 4)
      if (px[i + 2]! > px[i]! + 40 && px[i + 2]! > px[i + 1]! + 20) n++;
    return n;
  });
}

test('import a cube and render an isosurface', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const base = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://127.0.0.1:5173';
  // inside frontend/test-results/, never outside the repository
  const dir = test.info().outputPath('project');
  await request.post(`${base}/api/project/close`);
  const created = await request.post(`${base}/api/project/create`, {
    data: { path: join(dir, 'p'), name: 'e2e' },
  });
  expect(created.ok()).toBeTruthy();

  await page.goto('/');
  await expect(page.getByText('H2O')).toBeVisible();
  await page.getByRole('button', { name: 'Surfaces' }).click();
  await page.getByLabel('Import cube').fill(CUBE);
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText('electron density · 80 × 80 × 80')).toBeVisible();
  const before = await bluePixels(page);

  await page.getByRole('button', { name: 'Add surface' }).click();
  await expect(page.getByText(/suggested/)).toBeVisible();
  await expect(page.getByLabel('Isovalue (log)')).toBeVisible();
  // wait for the worker result to be drawn
  await expect.poll(() => bluePixels(page), { timeout: 30_000 }).toBeGreaterThan(before + 200);
  await page.screenshot({ path: join(dir, 'surface.png') });

  // changing opacity keeps the surface visible; deleting removes it
  await page.getByLabel('Opacity').fill('0.5');
  await page.waitForTimeout(300);
  expect(await bluePixels(page)).toBeGreaterThan(before + 200);
  await page.getByRole('button', { name: 'delete surface' }).click();
  await expect.poll(() => bluePixels(page)).toBeLessThan(before + 50);
  expect(errors).toEqual([]);
  console.log('screenshot:', join(dir, 'surface.png'));
});
