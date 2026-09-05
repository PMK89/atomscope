import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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

test('Build > Insert peptide uses the presets the backend actually offers', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build' }).click();
  await page.getByRole('menuitem', { name: 'Insert peptide…' }).click();

  // the names come from the API; a hard-coded one would be rejected by the schema
  const preset = page.getByLabel('Conformation');
  await expect(preset).toHaveValue(/[a-z_]+/);
  await page.getByLabel('Sequence').fill('AG');
  await page.getByRole('button', { name: 'Insert', exact: true }).click();

  // water (3) plus the dipeptide
  await expect(page.locator('.app-statusbar')).toContainText('23 atoms');
});

test('the Display tab drives the labels drawn into the scene', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Display' }).click();
  await page.getByLabel('Atoms', { exact: true }).selectOption('symbol');

  const labels = async (): Promise<string[]> =>
    page.evaluate(() => {
      const renderer = (window as unknown as { __atomscopeRenderer?: unknown })
        .__atomscopeRenderer as { getLayer(id: string): { labels(): string[] } | undefined };
      return renderer.getLayer('labels')?.labels() ?? [];
    });
  await expect.poll(labels).toEqual(['O', 'H', 'H']);

  await page.getByLabel('Bonds', { exact: true }).selectOption('length');
  await expect.poll(labels).toEqual(['O', 'H', 'H', '0.96', '0.96']);

  // the style controls reach the renderer too
  await page.getByLabel('Colour').fill('#ff0000');
  await page.getByRole('slider', { name: 'Size' }).fill('1.2');
  const style = await page.evaluate(() => {
    const renderer = (window as unknown as { __atomscopeRenderer?: unknown })
      .__atomscopeRenderer as {
      getLayer(id: string): { settings: { color: string; size: number } } | undefined;
    };
    return renderer.getLayer('labels')?.settings;
  });
  expect(style).toMatchObject({ color: '#ff0000', size: 1.2 });
});

test('copy, paste, and paste of text from another program', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('menubar').getByRole('button', { name: 'Select' }).click();
  await page.getByRole('menuitem', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('menuitem', { name: 'Copy Ctrl+C' }).click();

  // the system clipboard really got the fragment, not just the in-app one
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^3\n.*\nO /s);

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('menuitem', { name: 'Paste Ctrl+V' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('6 atoms');

  // text written by something else is read by the backend (AV-FILE-009)
  await page.evaluate(() => navigator.clipboard.writeText('2\n\nH 0 0 0\nH 0 0 0.74\n'));
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('menuitem', { name: 'Paste Ctrl+V' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('8 atoms');

  // and cut takes them away again in one undo step
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('menuitem', { name: 'Cut Ctrl+X' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('6 atoms');
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('menuitem', { name: 'Undo Cut Ctrl+Z' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('8 atoms');

  // the keyboard path goes through the DOM clipboard events, not the menu actions
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(page.locator('.app-statusbar')).toContainText('16 atoms');
});

test('a built peptide is drawn as a cartoon with its helices', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build' }).click();
  await page.getByRole('menuitem', { name: 'Insert peptide…' }).click();
  await page.getByLabel('Conformation').selectOption('alpha_helix');
  await page.getByLabel('Sequence').fill('AAAAAAAAAA');
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(page.locator('.app-statusbar')).toContainText('atoms');

  await page.getByRole('tab', { name: 'Display' }).click();
  await page.locator('#display-ribbon').check();

  const ribbon = async (): Promise<number> =>
    page.evaluate(() => {
      const renderer = (window as unknown as { __atomscopeRenderer?: unknown })
        .__atomscopeRenderer as { getLayer(id: string): { triangles(): number } | undefined };
      return renderer.getLayer('ribbon')?.triangles() ?? 0;
    });
  // the backend assigned the secondary structure and the layer turned it into geometry
  await expect.poll(ribbon).toBeGreaterThan(50);

  // a picture of the cartoon, so the geometry can be looked at and not only counted
  await page.locator('canvas').screenshot({ path: 'test-results/cartoon.png' });

  await page.getByLabel('Rendering').selectOption('backbone');
  await expect.poll(ribbon).toBeGreaterThan(50);
});

test('a pasted second water is drawn with a hydrogen bond to the first', async ({ page }) => {
  await page.goto('/');
  // a water 2.8 A below the demo molecule, donating straight at its oxygen
  await page.evaluate(() =>
    navigator.clipboard.writeText('3\n\nO 0 -2.8 0\nH 0 -1.82 0\nH 0.76 -3.39 0\n'),
  );
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('menuitem', { name: 'Paste Ctrl+V' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('6 atoms');

  await page.getByRole('tab', { name: 'Display' }).click();
  await page.locator('#display-hbonds').check();

  const hbonds = async (): Promise<number> =>
    page.evaluate(() => {
      const renderer = (window as unknown as { __atomscopeRenderer?: unknown })
        .__atomscopeRenderer as { getLayer(id: string): { bonds(): number } | undefined };
      return renderer.getLayer('hbonds')?.bonds() ?? 0;
    });
  await expect.poll(hbonds).toBeGreaterThan(0);

  // tightening the cut-off below the separation takes it away again
  await page.getByLabel('Cut-off distance (Å)').fill('2.0');
  await expect.poll(hbonds).toBe(0);
});

test('Save as writes a second structure and keeps editing the copy', async ({ page }) => {
  await page.goto('/');
  const before = await page.locator('.app-statusbar').textContent();
  expect(before).not.toBeNull();

  // an edit marks the document modified
  await page.getByRole('button', { name: 'Build' }).click();
  await page.getByRole('menuitem', { name: 'Insert fragment…' }).click();
  await page.getByLabel('Search').fill('benzene');
  await page
    .getByRole('button', { name: /benzene/i })
    .first()
    .click();
  await expect(page.locator('.status-modified')).toBeVisible();

  page.once('dialog', (d) => void d.accept('water plus fragment'));
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Save as… Ctrl+Shift+S' }).click();

  // the copy is in the project, is the open document, and is no longer marked modified
  await expect(page.getByRole('button', { name: /water plus fragment/ })).toBeVisible();
  await expect(page.locator('.app-statusbar')).toContainText('water plus fragment');
  await expect(page.locator('.status-modified')).toHaveCount(0);
});

test('benzene from SMILES is drawn with alternating double bonds', async ({ page }) => {
  await page.goto('/');
  page.once('dialog', (d) => void d.accept('c1ccccc1'));
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Build from SMILES…' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('12 atoms, 12 bonds');

  // 12 bonds: nine single (two half-cylinders each) and three double (two sticks each)
  const halves = async (): Promise<number> =>
    page.evaluate(() => {
      const renderer = (window as unknown as { __atomscopeRenderer?: unknown })
        .__atomscopeRenderer as { structureLayer: { pickables: { count?: number }[] } };
      return renderer.structureLayer.pickables[1]?.count ?? 0;
    });
  await expect.poll(halves).toBe(9 * 2 + 3 * 4);

  await page.getByRole('tab', { name: 'Display' }).click();
  await page.getByLabel('Show multiple bonds').uncheck();
  await expect.poll(halves).toBe(12 * 2);
});

test('repeating the unit cell repeats the atoms too', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build' }).click();
  await page.getByRole('menuitem', { name: 'Crystal library…' }).click();
  await page.getByRole('button', { name: 'AlSb AlSb' }).click();
  // the conventional cell of AlSb: waiting for "atoms" alone would still match the demo water
  await expect(page.locator('.app-statusbar')).toContainText('8 atoms');

  const drawn = async (): Promise<number> =>
    page.evaluate(() => {
      const renderer = (window as unknown as { __atomscopeRenderer?: unknown })
        .__atomscopeRenderer as { structureLayer: { pickables: { count?: number }[] } };
      return renderer.structureLayer.pickables[0]?.count ?? 0;
    });
  const one = await drawn();
  expect(one).toBeGreaterThan(0);

  await page.getByRole('tab', { name: 'Display' }).click();
  await page.getByLabel('Cell repeat a').fill('2');
  await page.getByLabel('Cell repeat b').fill('2');
  await expect.poll(drawn).toBe(one * 4);
});

test('Export image saves a PNG of the viewport at the chosen resolution', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Export image…' }).click();
  await page.getByLabel('Resolution').selectOption('2');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.png$/);

  // saved so the picture itself can be looked at, not only its header
  await file.saveAs('test-results/export.png');
  const bytes = await readFile('test-results/export.png');
  // a real PNG, and its header says twice the viewport's width
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  const width = bytes.readUInt32BE(16);
  const viewport = await page.evaluate(() => {
    const renderer = (window as unknown as { __atomscopeRenderer?: unknown })
      .__atomscopeRenderer as { viewportSize: { width: number } };
    return renderer.viewportSize.width;
  });
  expect(width).toBe(viewport * 2);
  // an empty frame of this size compresses to a couple of kilobytes; this one has a molecule in it
  expect(bytes.length).toBeGreaterThan(20_000);
});

test('Open reads a file from this machine, with the format named', async ({ page }) => {
  await page.goto('/');
  const dir = test.info().outputPath('open');
  await mkdir(dir, { recursive: true });
  // an XYZ file whose extension says nothing: only the override makes it readable
  const file = join(dir, 'ammonia.dat');
  await writeFile(
    file,
    '4\n\nN 0 0 0.11\nH 0 0.94 -0.27\nH 0.81 -0.47 -0.27\nH -0.81 -0.47 -0.27\n',
  );

  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Open… Ctrl+O' }).click();
  await page.getByLabel('Path on this machine').fill(file);
  await page.getByRole('button', { name: 'Open path' }).click();
  // without a format the backend cannot tell what .dat is
  await expect(page.locator('.status-error')).toContainText(/format|read/i);

  await page.getByLabel('Format').selectOption('xyz');
  await page.getByRole('button', { name: 'Open path' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('4 atoms');
  await expect(page.locator('.app-statusbar')).toContainText('H3N'); // Hill order
});

test('a constrained bond keeps its length through an optimization', async ({ page }) => {
  await page.goto('/');
  page.once('dialog', (d) => void d.accept('CCO'));
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Build from SMILES…' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('9 atoms');

  await page.getByRole('button', { name: 'Extensions' }).click();
  await page.getByRole('menuitem', { name: 'Constraints…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Constraints' });
  await dialog.getByLabel('Add').selectOption('distance');
  await dialog.getByLabel('atom 1').fill('1');
  await dialog.getByLabel('atom 2').fill('2');
  await dialog.getByLabel('target value').fill('1.8');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog.getByRole('cell', { name: 'C1, C2' })).toBeVisible();
  await page.screenshot({ path: '../.scratch/dev/constraints.png' });
  await dialog.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Extensions' }).click();
  await page.getByRole('menuitem', { name: 'Optimize geometry (MMFF94)' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('9 atoms');

  // the constrained C-C bond sits at the length that was asked for, not at MMFF94's own 1.52 A
  await page.getByRole('button', { name: 'Extensions' }).click();
  await page.getByRole('menuitem', { name: 'Constraints…' }).click();
  await expect
    .poll(async () => {
      const cells = page.getByRole('row', { name: /Distance/ }).getByRole('cell');
      return Number(/([\d.]+) Å/.exec((await cells.last().textContent()) ?? '')?.[1] ?? NaN);
    })
    .toBeCloseTo(1.8, 1);
});

test('the Properties tab lists the bonds and a typed length moves an atom', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Properties' }).click();
  const row = page.getByRole('row', { name: /O1—H2/ });
  await expect(row).toBeVisible();
  // both bonds of water end in a hydrogen, so neither rotates
  await expect(row.getByRole('cell').nth(2)).toHaveText('no');
  await page.screenshot({ path: '../.scratch/dev/bond-table.png' });

  const length = page.getByLabel('length of O1—H2');
  await length.fill('1.200');
  await length.blur();
  // the field keeps whatever was typed, so ask the document instead: the edit is on the undo stack
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /Undo Set bond length/ })).toBeVisible();
  await page.keyboard.press('Escape');
  // the other bond did not move with it
  await expect(page.getByLabel('length of O1—H3')).toHaveValue('0.958');
});
