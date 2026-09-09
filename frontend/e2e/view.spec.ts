import { expect, test } from '@playwright/test';

/** The colour of the canvas corner, which is background and nothing else. */
const corner = (page: import('@playwright/test').Page): Promise<[number, number, number]> =>
  page.locator('.viewport-canvas canvas').evaluate((c: HTMLCanvasElement) => {
    const gl = c.getContext('webgl2', { preserveDrawingBuffer: true }) as WebGL2RenderingContext;
    const px = new Uint8Array(4);
    gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return [px[0]!, px[1]!, px[2]!] as [number, number, number];
  });

test('the background can be any colour', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-statusbar')).toContainText('H2O');
  await expect.poll(() => corner(page)).toEqual([255, 255, 255]);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('menuitem', { name: 'Preferences…' }).click();
  await page.getByLabel('Background').selectOption('custom');
  await page.locator('#settings-background-color').fill('#204080');
  await expect.poll(() => corner(page)).toEqual([0x20, 0x40, 0x80]);
  await page.screenshot({ path: '../.scratch/dev/background-colour.png' });

  // a preset takes the custom colour away again
  await page.getByLabel('Background').selectOption('black');
  await expect(page.locator('#settings-background-color')).toBeHidden();
  await expect.poll(() => corner(page)).toEqual([0, 0, 0]);
});

test('View > Centre brings the structure back without changing the zoom', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-statusbar')).toContainText('H2O');
  const canvas = page.locator('.viewport-canvas canvas');
  /** how much of the canvas the molecule covers */
  const drawn = (): Promise<number> =>
    canvas.evaluate((c: HTMLCanvasElement) => {
      const gl = c.getContext('webgl2', { preserveDrawingBuffer: true }) as WebGL2RenderingContext;
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let n = 0;
      for (let i = 0; i < px.length; i += 4)
        if (px[i]! < 240 || px[i + 1]! < 240 || px[i + 2]! < 240) n++;
      return n;
    });
  const box = (await canvas.boundingBox())!;
  const before = await drawn();
  expect(before).toBeGreaterThan(500);

  // pan the molecule off the screen with a right-drag
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + box.width * 2, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up({ button: 'right' });
  await expect.poll(drawn).toBeLessThan(before / 4);

  await page.getByRole('button', { name: 'View' }).click();
  await page.getByRole('menuitem', { name: 'Centre' }).click();
  // back, and the same size as it was: centring is not fitting
  await expect.poll(drawn).toBeGreaterThan(before * 0.9);
  expect(await drawn()).toBeLessThan(before * 1.1);
});

test('a bond can be selected on its own', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-statusbar')).toContainText('H2O');

  // the Select tool (its shortcut), in the default Atoms and bonds mode
  await page.locator('.viewport-canvas canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('s');
  await expect(page.getByLabel('Selection mode')).toHaveValue('atoms');

  // Shrink the atoms first, so how much of the bond is exposed does not depend on the default
  // radii: at Avogadro's defaults the spheres nearly meet on an O-H bond, and a pixel calibrated
  // against one set of radii silently starts hitting an atom when they change.
  await page.getByRole('tab', { name: 'Display' }).click();
  await page.locator('#display-atom-scale').fill('0.1');
  await page.getByRole('tab', { name: 'Calculation' }).click();

  // water is drawn with the oxygen in the middle and a bond running out to each hydrogen, so a
  // point part of the way towards one is on a bond and on neither atom
  const canvas = page.locator('.viewport-canvas canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 - 27, box.y + box.height / 2 - 18);
  await expect(page.locator('.app-statusbar')).toContainText('0 selected, 1 bond');
  await page.screenshot({ path: '../.scratch/dev/bond-selection.png' });
});

/** Whether the running renderer carries a layer, which is where a plugin switch has to reach. */
const hasLayer = (page: import('@playwright/test').Page, id: string): Promise<boolean> =>
  page.evaluate((layerId) => {
    const renderer = (window as unknown as { __atomscopeRenderer?: unknown })
      .__atomscopeRenderer as { getLayer(id: string): unknown } | undefined;
    return renderer !== undefined && renderer.getLayer(layerId) !== undefined;
  }, id);

test('switching a display type off takes it out of the running renderer', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-statusbar')).toContainText('H2O');
  expect(await hasLayer(page, 'axes')).toBe(true);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('menuitem', { name: 'Plugin manager…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plugin manager' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Kind').selectOption('layer');

  // Avogadro's own switch reloaded the engines rather than waiting for the next start
  await dialog.getByLabel('Axes').uncheck();
  await expect.poll(() => hasLayer(page, 'axes')).toBe(false);
  await dialog.getByLabel('Axes').check();
  await expect.poll(() => hasLayer(page, 'axes')).toBe(true);
  await dialog.getByRole('button', { name: 'Close' }).click();
});
