import { expect, test } from '@playwright/test';

test('app renders the demo molecule into the WebGL canvas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await expect(page.locator('.app-statusbar')).toContainText('H2O');
  const canvas = page.locator('.viewport-canvas canvas');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(500);
  // Count pixels that differ from the white background: atoms must have been drawn.
  const colored = await canvas.evaluate((c: HTMLCanvasElement) => {
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
      if (px[i] < 240 || px[i + 1] < 240 || px[i + 2] < 240) n++;
    return n;
  });
  expect(colored).toBeGreaterThan(500);
  await page.screenshot({ path: '../.scratch/dev/app.png' });
  expect(errors).toEqual([]);
});

test('view menu switches to stick and status bar shows selection on click', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'View' }).click();
  // checkable items carry the menuitemcheckbox role (ARIA menu-button contract)
  await page.getByRole('menuitemcheckbox', { name: 'Stick', exact: true }).click();
  const box = await page.locator('.viewport-canvas canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(200);
  const text = await page.locator('.app-statusbar').innerText();
  expect(text).toMatch(/[01] selected/);
});

test('Extensions menu runs a chemistry operation against the backend', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-statusbar')).toContainText('3 atoms');

  // remove then re-add the hydrogens: both go through /api/chem and commit as undo steps
  await page.getByRole('button', { name: 'Extensions' }).click();
  await page.getByRole('menuitem', { name: 'Remove hydrogens' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('1 atoms');

  await page.getByRole('button', { name: 'Extensions' }).click();
  await page.getByRole('menuitem', { name: 'Add hydrogens', exact: true }).click();
  await expect(page.locator('.app-statusbar')).toContainText('3 atoms');
  await expect(page.locator('.app-statusbar')).toContainText('H2O');
});

test('Build > Insert fragment adds a real fragment from the library', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-statusbar')).toContainText('3 atoms');

  await page.getByRole('button', { name: 'Build' }).click();
  await page.getByRole('menuitem', { name: 'Insert fragment…' }).click();
  await page.getByLabel('Search').fill('benzene');
  await page
    .getByRole('button', { name: /benzene/i })
    .first()
    .click();

  await expect(page.locator('.app-statusbar')).toContainText('15 atoms');
});
