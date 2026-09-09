import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
  // three decimals: Avogadro's default lengthPrecision, settable in the Display tab
  await expect.poll(labels).toEqual(['O', 'H', 'H', '0.958', '0.958']);

  // the style controls reach the renderer too
  await page.getByLabel('Colour', { exact: true }).fill('#ff0000');
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

  // the ribbon has a colour map of its own, so a cartoon can be coloured by chain while the
  // atoms keep their elements: the strip's vertex colours are what changes
  await page.getByLabel('Rendering').selectOption('cartoon');
  const stripColors = async (): Promise<string[]> =>
    page.evaluate(() => {
      const renderer = (window as unknown as { __atomscopeRenderer?: unknown })
        .__atomscopeRenderer as {
        getLayer(id: string): { object: { children: unknown[] } } | undefined;
      };
      const mesh = renderer.getLayer('ribbon')?.object.children[0] as {
        geometry: {
          getAttribute(name: string): {
            count: number;
            getX(i: number): number;
            getY(i: number): number;
            getZ(i: number): number;
          };
        };
      };
      const a = mesh.geometry.getAttribute('color');
      const out = new Set<string>();
      for (let i = 0; i < a.count; i++)
        out.add([a.getX(i), a.getY(i), a.getZ(i)].map((v) => v.toFixed(3)).join(','));
      return [...out].sort();
    });
  const bySecondary = await stripColors();
  await page.locator('#display-ribbon-colorby').selectOption('residue');
  await expect.poll(stripColors).not.toEqual(bySecondary);
  await page.locator('canvas').screenshot({ path: '../.scratch/dev/cartoon-by-residue.png' });
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

test('the Properties tab lists the angles and a typed angle bends the molecule', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Properties' }).click();
  // water has one angle and no torsion at all
  await expect(page.getByLabel('value of H2—O1—H3')).toBeVisible();
  await expect(page.getByText('No torsions.')).toBeVisible();
  await page.screenshot({ path: '../.scratch/dev/angle-table.png' });

  const angle = page.getByLabel('value of H2—O1—H3');
  await expect(angle).toHaveValue('104.48');
  await angle.fill('120.00');
  await angle.blur();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /Undo Set angle/ })).toBeVisible();
  await page.keyboard.press('Escape');
  // the bonds kept their lengths: an angle turns the far side, it does not stretch anything
  await expect(page.getByLabel('length of O1—H2')).toHaveValue('0.958');
  await expect(page.getByLabel('length of O1—H3')).toHaveValue('0.958');
  await expect(page.getByLabel('value of H2—O1—H3')).toHaveValue('120.00');
});

test('the auto-optimize tool relaxes a stretched bond and is one undo step', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Properties' }).click();
  const length = page.getByLabel('length of O1—H2');
  await length.fill('1.400');
  await length.blur();

  await page.getByRole('button', { name: /Auto-optimize/ }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await page.screenshot({ path: '../.scratch/dev/auto-optimize.png' });
  // MMFF94 pulls the O-H bond back towards 0.97 A while the tool runs
  await expect
    .poll(async () => Number(await page.getByLabel('length of O1—H2').inputValue()), {
      timeout: 15000,
    })
    .toBeLessThan(1.1);
  await page.getByRole('button', { name: 'Stop' }).click();

  // the whole run is one entry, and undoing it gives the stretched bond back
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('menuitem', { name: /Undo Auto-optimize/ }).click();
  await expect
    .poll(async () => Number(await page.getByLabel('length of O1—H2').inputValue()))
    .toBeGreaterThan(1.3);
});

test('a peptide can be coloured by residue and selected by residue name', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build' }).click();
  await page.getByRole('menuitem', { name: 'Insert peptide…' }).click();
  await page.getByLabel('Conformation').selectOption('alpha_helix');
  await page.getByLabel('Sequence').fill('AGKDAGKD');
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(page.locator('.app-statusbar')).toContainText('atoms');

  await page.getByRole('tab', { name: 'Display' }).click();
  await page.locator('#display-color-scheme').selectOption('residue');
  // lysine is blue and aspartate red in the amino colours the residue scheme follows
  await page.locator('canvas').screenshot({ path: '../.scratch/dev/residue-colors.png' });

  // the three residue palettes are Avogadro's Residue Color settings, and they differ
  const amino = await page.locator('.viewport-canvas canvas').screenshot();
  await page.locator('#display-residue-palette').selectOption('shapely');
  await expect
    .poll(async () => (await page.locator('.viewport-canvas canvas').screenshot()).equals(amino))
    .toBe(false);
  await page.locator('canvas').screenshot({ path: '../.scratch/dev/residue-shapely.png' });

  // the menu bar's Select, not the Select tool button
  await page.locator('button.menu-title', { hasText: 'Select' }).click();
  page.once('dialog', (d) => void d.accept('LYS'));
  await page.getByRole('menuitem', { name: 'Select residues…' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('selected');
  const selected = await page.locator('.app-statusbar').textContent();
  expect(Number(/(\d+) selected/.exec(selected ?? '')?.[1] ?? 0)).toBeGreaterThan(20);
});

test('Settings > Preferences changes the rendering and lists the backends', async ({ page }) => {
  await page.goto('/');
  await page.locator('button.menu-title', { hasText: 'Settings' }).click();
  await page.getByRole('menuitem', { name: 'Preferences…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Preferences' });
  await expect(dialog).toBeVisible();

  // the backend list comes from the server, so at least the built-in ASE backend is there
  await expect(dialog.getByText(/ASE|available/).first()).toBeVisible();

  // depth cueing carries Avogadro's four named levels of its 0-9 fogLevel, not an on/off
  await dialog.getByLabel('Depth cueing').selectOption('mid');
  await dialog.getByLabel('Background').selectOption('black');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await page.screenshot({ path: '../.scratch/dev/settings.png' });

  // the background really changed in the scene, not only in the store
  const dark = await page.locator('.viewport-canvas canvas').evaluate((c: HTMLCanvasElement) => {
    const gl = c.getContext('webgl2', { preserveDrawingBuffer: true }) as WebGL2RenderingContext;
    const px = new Uint8Array(4);
    gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px[0]! + px[1]! + px[2]!;
  });
  expect(dark).toBeLessThan(60);
});

test('display scope hides atoms and shows only the selection', async ({ page }) => {
  /** pixels that differ from the white background: how much structure is on screen */
  const drawn = (): Promise<number> =>
    page.locator('.viewport-canvas canvas').evaluate((c: HTMLCanvasElement) => {
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
        if (px[i]! < 240 || px[i + 1]! < 240 || px[i + 2]! < 240) n++;
      return n;
    });

  await page.goto('/');
  await expect(page.locator('.app-statusbar')).toContainText('H2O');
  await page.waitForTimeout(400);
  const all = await drawn();
  expect(all).toBeGreaterThan(500);

  // the oxygen alone: the menu bar's Select, not the Select tool button
  await page.locator('button.menu-title', { hasText: 'Select' }).click();
  page.once('dialog', (d) => void d.accept('O'));
  await page.getByRole('menuitem', { name: 'Select by element…' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('1 selected');

  await page.getByRole('tab', { name: 'Display' }).click();
  await page.getByRole('button', { name: 'Display only selection' }).click();
  await expect(page.getByText(/3 of 3 atoms have a display type of their own/)).toBeVisible();
  // one atom and no bonds is much less than the whole molecule
  await expect.poll(drawn).toBeLessThan(all * 0.6);
  await page.screenshot({ path: '../.scratch/dev/display-scope.png' });
  const only = await drawn();

  // hiding the last atom leaves the structure empty; the axes gizmo is still drawn, so what is
  // left is the gizmo alone. Show all then brings the whole molecule back.
  await page.getByRole('button', { name: 'Hide selection' }).click();
  await expect.poll(drawn).toBeLessThan(only);
  await page.getByRole('button', { name: 'Show all' }).click();
  await expect.poll(drawn).toBeGreaterThan(all * 0.95);
});

test('atoms can be coloured by partial charge and by one colour', async ({ page }) => {
  /** the mean colour of the drawn pixels, which says what the molecule is painted with */
  const mean = (): Promise<[number, number, number]> =>
    page.locator('.viewport-canvas canvas').evaluate((c: HTMLCanvasElement) => {
      const gl = c.getContext('webgl2', {
        preserveDrawingBuffer: true,
      }) as WebGL2RenderingContext;
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i]! > 240 && px[i + 1]! > 240 && px[i + 2]! > 240) continue;
        r += px[i]!;
        g += px[i + 1]!;
        b += px[i + 2]!;
        n++;
      }
      return n ? [r / n, g / n, b / n] : [0, 0, 0];
    });

  await page.goto('/');
  await expect(page.locator('.app-statusbar')).toContainText('H2O');
  await page.getByRole('tab', { name: 'Display' }).click();

  // without charges the scheme says what is missing and the picture keeps its element colours
  await page.locator('#display-color-scheme').selectOption('charge');
  await expect(page.getByText(/no partial charges/)).toBeVisible();
  const elementColors = await mean();

  await page.locator('button.menu-title', { hasText: 'Extensions' }).click();
  await page.getByRole('menuitem', { name: 'Assign partial charges' }).click();
  await expect(page.getByText(/no partial charges/)).toBeHidden();
  // water: a negative oxygen (red) and two positive hydrogens (pale blue). The oxygen sphere is
  // the larger part of what is drawn, so the picture goes red where the element colours were not
  await expect.poll(mean).not.toEqual(elementColors);
  await expect
    .poll(async () => {
      const [cr, , cb] = await mean();
      return cr - cb;
    })
    .toBeGreaterThan(0);
  await page.screenshot({ path: '../.scratch/dev/colour-by-charge.png' });

  // one colour paints everything, and it is the one the panel says
  await page.locator('#display-color-scheme').selectOption('custom');
  await page.locator('#display-custom-color').fill('#00ff00');
  const greenness = async (): Promise<number> => {
    const [r, g, b] = await mean();
    return g - Math.max(r, b);
  };
  // the next frame is what carries the new colour, so poll rather than read once
  await expect.poll(greenness).toBeGreaterThan(40);
  const allGreen = await greenness();

  // a per-atom colour is painted over the scheme: the oxygen alone turns red while the two
  // hydrogens stay the scheme's green
  await page.locator('button.menu-title', { hasText: 'Select' }).click();
  page.once('dialog', (d) => void d.accept('O'));
  await page.getByRole('menuitem', { name: 'Select by element…' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('1 selected');
  await page.getByRole('tab', { name: 'Display' }).click();
  await page.locator('#display-scope-color').fill('#ff0000');
  await page.getByRole('button', { name: 'Colour selection' }).click();
  await expect(page.getByText(/1 of 3 atoms have a colour of their own/)).toBeVisible();
  // the selection tint is drawn over the atom colour, so the picture only shows the assignment
  // once the oxygen is no longer selected
  await page.locator('button.menu-title', { hasText: 'Select' }).click();
  await page.getByRole('menuitem', { name: 'Select none' }).click();
  // A large share of the green goes, but not enough to turn the mean red: at Avogadro's radii
  // the two hydrogens together cover about as much of the picture as the oxygen does (vdW H is
  // 1.10 A against O's 1.52, where the covalent radii are 0.31 against 0.66), so painting the
  // oxygen alone cannot outweigh them. Calibrated against the all-green frame rather than zero.
  await expect.poll(greenness).toBeLessThan(allGreen / 2);
  await page.screenshot({ path: '../.scratch/dev/atom-colour.png' });

  // and clearing gives the oxygen back to the scheme
  await page.getByRole('button', { name: 'Clear colours' }).click();
  await expect.poll(greenness).toBeGreaterThan(40);
});

test('Export writes a file on this machine, in the format the name asks for', async ({
  page,
  request,
}) => {
  const base = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://127.0.0.1:5173';
  // inside frontend/test-results/, never outside the repository
  const target = join(test.info().outputPath('export'), 'water.pdb');
  await mkdir(dirname(target), { recursive: true });

  await page.goto('/');
  await expect(page.locator('.app-statusbar')).toContainText('H2O');
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Export…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await expect(dialog).toBeVisible();

  // the extension chooses the writer: .pdb is Protein Data Bank, whatever the list started on
  await dialog.getByLabel('Path on this machine').fill(target);
  await expect(dialog.getByLabel('Format')).toHaveValue('pdb');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  // the file is really there, and really a PDB the backend can read back
  const back = await request.post(`${base}/api/io/import/path`, { data: { path: target } });
  expect(back.ok()).toBeTruthy();
  expect(((await back.json()) as { atoms: unknown[] }).atoms).toHaveLength(3);

  // writing over it again is refused until the dialog asks
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Export…', exact: true }).click();
  await dialog.getByLabel('Path on this machine').fill(target);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert')).toContainText('exists already');
  await dialog.getByRole('button', { name: 'Overwrite' }).click();
  await expect(dialog).toBeHidden();
});

test('the viewport can be exported as a POV-Ray scene', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-statusbar')).toContainText('H2O');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Export POV-Ray scene' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('water.pov');
  const text = await readFile((await file.path()) ?? '', 'utf8');

  // water is three spheres and four half-cylinders, on the white background the viewport shows
  expect([...text.matchAll(/sphere \{/g)]).toHaveLength(3);
  expect([...text.matchAll(/cylinder \{/g)]).toHaveLength(4);
  expect(text).toContain('background { color rgb <1, 1, 1> }');
  expect(text).toContain('camera {');
  expect(text).toContain('light_source {');
  // and no label sprite or axes gizmo made it in
  expect(text).not.toContain('text {');
});

test('a file dropped on the window opens, and a second file in the same drop is left alone', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.app-statusbar')).toContainText('3 atoms'); // the demo water

  // a real drop: a DataTransfer built in the page, so preventDefault and dataTransfer.files are
  // the browser's own rather than a synthetic event's
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    const xyz = '4\n\nN 0 0 0.11\nH 0 0.94 -0.27\nH 0.81 -0.47 -0.27\nH -0.81 -0.47 -0.27\n';
    transfer.items.add(new File([xyz], 'ammonia.xyz', { type: 'text/plain' }));
    transfer.items.add(new File(['1\n\nHe 0 0 0\n'], 'helium.xyz', { type: 'text/plain' }));
    const shell = document.querySelector('.app-shell')!;
    for (const type of ['dragenter', 'dragover', 'drop']) {
      shell.dispatchEvent(
        new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
    }
  });

  await expect(page.locator('.app-statusbar')).toContainText('4 atoms');
  await expect(page.locator('.app-statusbar')).toContainText('H3N');
  await expect(page.locator('.status-error')).toContainText('the other 1 file was left alone');
});

test('opening over unsaved work asks first, and Cancel keeps the document', async ({ page }) => {
  await page.goto('/');
  // an edit the document has not been saved with: the bullet in the status bar says so
  await page.getByRole('tab', { name: 'Properties' }).click();
  await page.getByLabel('Structure name').fill('work in progress');
  await page.getByLabel('Structure name').blur();
  await expect(page.locator('.status-modified')).toHaveCount(1);

  page.once('dialog', (d) => {
    expect(d.message()).toContain('unsaved changes');
    return d.dismiss();
  });
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'New' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('3 atoms');
  await expect(page.locator('.status-modified')).toHaveCount(1);

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'New' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('0 atoms');
});

test('the Properties tab shows the weight, the backend atom type and an editable charge', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Properties' }).click();
  await expect(page.getByText('18.015 g/mol')).toBeVisible();

  // the type comes from Open Babel, through /api/chem/atom-types: nothing local computes it
  await page.locator('button.menu-title', { hasText: 'Select' }).click();
  page.once('dialog', (d) => void d.accept('O'));
  await page.getByRole('menuitem', { name: 'Select by element…' }).click();
  await expect(page.getByText('O3', { exact: true })).toBeVisible();
  await expect(page.getByText('2 bonds, order sum 2')).toBeVisible();

  // no charges yet, so no charge field and no dipole
  await expect(page.getByLabel('Partial charge')).toHaveCount(0);
  await page.getByRole('button', { name: 'Extensions' }).click();
  await page.getByRole('menuitem', { name: 'Assign partial charges' }).click();
  await expect(page.getByLabel('Partial charge')).toBeVisible();
  // exact: the Display tab's "Dipole moment" heading is in the DOM too, and getByText is
  // case-insensitive by default
  await expect(page.getByText('dipole moment', { exact: true })).toBeVisible();

  // typing one by hand drops the dipole, which was the sum over the charges as they were
  await page.getByLabel('Partial charge').fill('-0.9');
  await page.getByLabel('Partial charge').blur();
  await expect(page.getByText('dipole moment', { exact: true })).toHaveCount(0);
});

test('the dipole panel says what it needs, then what the charges imply', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-statusbar')).toContainText('H2O');
  await page.getByRole('tab', { name: 'Display' }).click();

  // the panel says what is missing rather than drawing an arrow of nothing
  await expect(
    page.getByText(/summed from the partial charges, and this structure carries none/),
  ).toBeVisible();
  await page.locator('#display-dipole').check();

  await page.locator('button.menu-title', { hasText: 'Extensions' }).click();
  await page.getByRole('menuitem', { name: 'Assign partial charges' }).click();
  // water's dipole from Gasteiger charges, summed in the browser from the current positions
  await expect(page.getByText(/D, from the partial charges/)).toBeVisible();
  await page.screenshot({ path: '../.scratch/dev/dipole-arrow.png' });
});
