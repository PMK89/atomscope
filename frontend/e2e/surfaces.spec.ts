import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CUBE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../backend/tests/fixtures/cppaw/h2o/case_total_density.cub.gz',
);

/** pixels whose colour is dominated by red (the high end of the diverging colour scale) */
async function redPixels(page: Page): Promise<number> {
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
      if (px[i]! > px[i + 2]! + 40 && px[i]! > px[i + 1]! + 20) n++;
    return n;
  });
}

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
  await expect(page.locator('.app-statusbar')).toContainText('H2O');
  await page.getByRole('tab', { name: 'Surfaces' }).click();
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

  // colour the surface by a second grid: a ramp along x, standing in for a potential
  const ramp = join(dir, 'ramp.cube');
  await writeFile(ramp, rampCube());
  await page.getByLabel('Import cube').fill(ramp);
  await page.getByLabel('cube kind').selectOption('electrostatic_potential');
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText(/electrostatic potential · 2/)).toBeVisible();

  // the Display tab has 'Colour by' of its own (the structure's and the ribbon's): this is the
  // surface's, whose id carries the surface number
  await page.locator('select[id^="surf-"][id$="-colorby"]').selectOption({ label: 'ramp' });
  // the diverging scale paints the low end blue and the high end red: red is what was not there
  await expect.poll(() => redPixels(page), { timeout: 30_000 }).toBeGreaterThan(200);
  await page.screenshot({ path: join(dir, 'surface-colored.png') });
  console.log('screenshot:', join(dir, 'surface-colored.png'));

  await page.getByRole('button', { name: 'delete surface' }).click();
  await expect.poll(() => bluePixels(page)).toBeLessThan(before + 50);
  expect(errors).toEqual([]);
  console.log('screenshot:', join(dir, 'surface.png'));
});

/** A 2x2x2 Gaussian cube over a large box, ramping from -1 to 1 along x. */
function rampCube(): string {
  const lines = [
    'ramp',
    'linear in x',
    '    1    -12.000000    -12.000000    -12.000000',
    '    2     24.000000      0.000000      0.000000',
    '    2      0.000000     24.000000      0.000000',
    '    2      0.000000      0.000000     24.000000',
    '    8    8.000000     0.000000      0.000000      0.000000',
  ];
  const values: string[] = [];
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      for (let k = 0; k < 2; k++) values.push((i === 0 ? -1 : 1).toExponential(5));
    }
  }
  lines.push(values.join(' '));
  return lines.join('\n') + '\n';
}

const FCHK = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../backend/tests/fixtures/wavefunction/co.fchk',
);

test('an orbital reaches the project through the token, the poll and the dataset', async ({
  page,
  request,
}) => {
  const base = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://127.0.0.1:5173';
  const dir = test.info().outputPath('project');
  await request.post(`${base}/api/project/close`);
  expect(
    (
      await request.post(`${base}/api/project/create`, {
        data: { path: join(dir, 'p'), name: 'wf' },
      })
    ).ok(),
  ).toBeTruthy();

  await page.goto('/');
  await page.getByRole('tab', { name: 'Surfaces' }).click();
  await page.getByLabel('Wavefunction').fill(FCHK);
  await page.getByRole('button', { name: 'Load' }).click();
  await expect(page.getByTestId('wf-summary')).toContainText('14 electrons');

  // a grid coarse enough to finish quickly: this is about the task, not the arithmetic
  await page.getByLabel('Resolution').selectOption('0.4');
  await page.getByRole('button', { name: 'Calculate' }).click();

  // the HOMO becomes a dataset of the project, through the token the request handed back
  // the card names it and the dataset list repeats it, so take the first
  await expect(page.getByText(/co HOMO/).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Calculate' })).toBeEnabled();
});
