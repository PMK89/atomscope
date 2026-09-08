import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Pictures of the course results, taken in the running application, with the one assertion that
 * says a picture is right: the isosurface has to be drawn where the molecule is.
 *
 * Needs finished CP-PAW runs under `.scratch/course-runs/` (`scripts/course/run.py`) and skips
 * without them. Out of the normal suite -- it opens structures of its own; see playwright.config.
 */
const RUNS = join(process.cwd(), '..', '.scratch', 'course-runs');
const SHOTS = join(process.cwd(), '..', '.scratch', 'course-shots');

/** The canvas as RGBA, bottom-up, straight out of the GL context. */
async function pixels(page: import('@playwright/test').Page): Promise<{
  data: number[];
  width: number;
  height: number;
}> {
  return page.locator('.viewport-canvas canvas').evaluate((c: HTMLCanvasElement) => {
    const gl = c.getContext('webgl2', { preserveDrawingBuffer: true }) as WebGL2RenderingContext;
    const px = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { data: Array.from(px), width: c.width, height: c.height };
  });
}

/** Centre of mass of the pixels a predicate picks out, in canvas coordinates. */
function centre(
  frame: { data: number[]; width: number; height: number },
  pick: (i: number) => boolean,
): { x: number; y: number; n: number } {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let p = 0; p < frame.width * frame.height; p++) {
    if (!pick(p * 4)) continue;
    sx += p % frame.width;
    sy += Math.floor(p / frame.width);
    n++;
  }
  return { x: n ? sx / n : 0, y: n ? sy / n : 0, n };
}

test('water: the HOMO is drawn on the molecule, not at the corners of the cell', async ({
  page,
  request,
}) => {
  const base = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://127.0.0.1:5173';
  const work = join(RUNS, 'water-orbitals', 'work');
  const cube = join(work, 'case_orb_b4k1s1_centred.cub');
  test.skip(!existsSync(cube), 'run scripts/course/run.py water-orbitals first');

  // a project of its own -- safe because this file never runs beside the shared suite
  const dir = test.info().outputPath('project');
  await request.post(`${base}/api/project/close`);
  expect(
    (
      await request.post(`${base}/api/project/create`, {
        data: { path: join(dir, 'p'), name: 'course' },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.post(`${base}/api/io/import/path`, {
        data: { path: join(RUNS, 'water-relax', 'final.xyz') },
      })
    ).ok(),
  ).toBeTruthy();

  await page.goto('/');
  await expect(page.locator('.app-statusbar')).toContainText('atoms');
  await page.getByRole('tab', { name: 'Surfaces' }).click();
  await page.getByLabel('Import cube').fill(cube);
  await page.getByLabel('cube kind').selectOption('orbital');
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText(/orbital · \d+ × \d+ × \d+/)).toBeVisible();

  // what is on screen before the surface exists is the molecule, and that is what it has to
  // line up with
  const before = await pixels(page);
  const white = (d: number[], i: number): boolean =>
    d[i]! > 245 && d[i + 1]! > 245 && d[i + 2]! > 245;
  const molecule = centre(before, (i) => !white(before.data, i));
  expect(molecule.n).toBeGreaterThan(500);

  await page.getByRole('button', { name: 'Add surface' }).click();
  await expect(page.getByRole('slider', { name: /Isovalue/ })).toBeVisible();
  await page.waitForTimeout(2500);
  const after = await pixels(page);

  // the surface is whatever appeared: pixels that changed when it was switched on
  const surface = centre(after, (i) => {
    const d =
      Math.abs(after.data[i]! - before.data[i]!) +
      Math.abs(after.data[i + 1]! - before.data[i + 1]!) +
      Math.abs(after.data[i + 2]! - before.data[i + 2]!);
    return d > 30;
  });
  expect(surface.n).toBeGreaterThan(500);

  await page.screenshot({ path: join(SHOTS, 'water-homo.png') });

  // Before the grid was rolled, the lobes sat at the corners of the cell and this distance was
  // most of the viewport. An orbital belongs to the atoms it is an orbital of.
  const apart = Math.hypot(surface.x - molecule.x, surface.y - molecule.y);
  expect(apart).toBeLessThan(0.12 * Math.min(after.width, after.height));
});

test('water: the cell-size convergence curve, in the app', async ({ page, request }) => {
  const base = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://127.0.0.1:5173';
  const project = join(RUNS, 'water-cell-size', 'project');
  test.skip(!existsSync(project), 'run scripts/course/sweep.py water-cell-size first');

  await request.post(`${base}/api/project/close`);
  expect(
    (await request.post(`${base}/api/project/open`, { data: { path: project } })).ok(),
  ).toBeTruthy();

  await page.goto('/');
  await page.getByRole('tab', { name: 'Sweeps' }).click();
  await expect(page.getByRole('combobox', { name: 'Sweep' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText(/Settled from|Not settled/);
  await expect(page.getByRole('img', { name: 'Convergence' })).toBeVisible();
  await page.screenshot({ path: join(SHOTS, 'cell-size-convergence.png') });
});

test('water: the density of states, with the O-H COOP under it', async ({ page, request }) => {
  const base = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://127.0.0.1:5173';
  const project = join(RUNS, 'course');
  test.skip(!existsSync(project), 'run scripts/course/run.py water-orbitals first');

  await request.post(`${base}/api/project/close`);
  expect(
    (await request.post(`${base}/api/project/open`, { data: { path: project } })).ok(),
  ).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: 'water-orbitals completed' }).click();
  await page.getByRole('tab', { name: 'Analysis' }).click();
  await page.getByRole('button', { name: 'DOS', exact: true }).click();

  // the DOS was computed when the exercise ran; the panel reads it back
  const coop = page.locator('svg[aria-label="Crystal-orbital overlap population"]');
  await expect(coop).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Positive where the two orbitals are bonding/)).toBeVisible();
  await page.screenshot({ path: join(SHOTS, 'water-dos-coop.png') });
});

test('water: the density of states, stacked and filled under the total', async ({
  page,
  request,
}) => {
  const base = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://127.0.0.1:5173';
  const project = join(RUNS, 'course');
  test.skip(!existsSync(project), 'run scripts/course/run.py water-orbitals first');

  await request.post(`${base}/api/project/close`);
  expect(
    (await request.post(`${base}/api/project/open`, { data: { path: project } })).ok(),
  ).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: 'water-orbitals completed' }).click();
  await page.getByRole('tab', { name: 'Analysis' }).click();
  await page.getByRole('button', { name: 'DOS', exact: true }).click();

  const chart = page.locator('svg[aria-label="Density of states"]');
  await expect(chart).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel('Stack the projections under the total')).toBeChecked();

  // four filled bands (O s, O p, and one s per hydrogen), each split at the Fermi level
  const fills = chart.locator('path[fill-opacity]');
  await expect(fills).toHaveCount(8);
  const faint = chart.locator('path[fill-opacity="0.35"]');
  await expect(faint).toHaveCount(4);

  // and the regions are named, which is how the course's captions identify them
  const legend = page.locator('.analysis-panel .chart-legend');
  await expect(legend).toContainText('O_1 p');
  // the whole-atom weights are the sums of the stacked channels: naming them too would put the
  // same states on the chart twice
  await expect(legend).not.toContainText('O_1 s O_1');
  await expect(legend).toContainText('total');
  await page.screenshot({ path: join(SHOTS, 'water-dos-stacked.png') });

  // unstacked it is plain lines again, and nothing is filled
  await page.getByLabel('Stack the projections under the total').uncheck();
  await expect(chart.locator('path[fill-opacity]')).toHaveCount(0);
});

test('water: what the thermostats did, against time', async ({ page, request }) => {
  const base = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://127.0.0.1:5173';
  const project = join(RUNS, 'course');
  test.skip(!existsSync(project), 'run scripts/course/run.py water-relax first');

  await request.post(`${base}/api/project/close`);
  expect(
    (await request.post(`${base}/api/project/open`, { data: { path: project } })).ok(),
  ).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: 'water-relax completed' }).click();
  await page.getByRole('tab', { name: 'Analysis' }).click();

  // both frictions, on their own axis -- on the eV convergence chart they would be a dot
  const friction = page.locator('.analysis-panel svg[aria-label="Thermostat friction"]');
  await expect(friction).toBeVisible({ timeout: 20_000 });
  await expect(friction.locator('polyline')).toHaveCount(2);
  // the eV series stay on their own chart: conserved energy and the fictitious kinetic energy
  await expect(page.locator('.analysis-panel svg[aria-label="Convergence"] polyline')).toHaveCount(
    2,
  );
  await expect(page.locator('.analysis-panel svg[aria-label="Total energy"] polyline')).toHaveCount(
    1,
  );
  await friction.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, 'water-friction.png') });
});

test('silicon: the band structure along the fcc path', async ({ page, request }) => {
  const base = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://127.0.0.1:5173';
  const project = join(RUNS, 'course');
  test.skip(!existsSync(project), 'run scripts/course/sweep.py silicon-kpoints first');

  await request.post(`${base}/api/project/close`);
  expect(
    (await request.post(`${base}/api/project/open`, { data: { path: project } })).ok(),
  ).toBeTruthy();

  await page.goto('/');
  await page
    .getByRole('button', { name: /Silicon k-points — k-point density R 30 completed/ })
    .click();
  await page.getByRole('tab', { name: 'Analysis' }).click();
  await page.getByRole('button', { name: 'Bands', exact: true }).click();

  // read back from the work directory, without recomputing minutes of work
  const chart = page.locator('svg[aria-label="Band structure"]');
  await expect(chart).toBeVisible({ timeout: 20_000 });
  await expect(chart.locator('polyline')).toHaveCount(10);
  // the high-symmetry points the path was built from
  await expect(chart).toContainText('L');

  // Fig. 6.4: four filled bands drawn apart from the six empty ones, and no band cut by the
  // level -- silicon is a semiconductor. Two colours on the chart, two entries in the legend.
  const strokes = await chart
    .locator('polyline')
    .evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('stroke')))]);
  expect(strokes).toHaveLength(2);
  const legend = page.locator('.analysis-panel .chart-legend').last();
  await expect(legend).toHaveText(/fully occupied/);
  await expect(legend).toHaveText(/empty/);
  await expect(legend).not.toHaveText(/partially filled/);
  // silicon uses fixed occupations, so the level is the top of the filled states, labelled so
  await expect(chart).toContainText('HOMO');

  await page.screenshot({ path: join(SHOTS, 'silicon-bands.png') });
});

test('iron: the cutoff convergence over the basis-set size it cost', async ({ page, request }) => {
  const base = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://127.0.0.1:5173';
  const project = join(RUNS, 'course');
  test.skip(!existsSync(project), 'run scripts/course/sweep.py iron-cutoff first');

  await request.post(`${base}/api/project/close`);
  expect(
    (await request.post(`${base}/api/project/open`, { data: { path: project } })).ok(),
  ).toBeTruthy();

  await page.goto('/');
  await page.getByRole('tab', { name: 'Sweeps' }).click();
  const picker = page.getByRole('combobox', { name: 'Sweep' });
  const cutoff = await picker
    .locator('option')
    .filter({ hasText: 'Plane-wave cutoff' })
    .first()
    .textContent();
  await picker.selectOption({ label: cutoff! });

  await expect(page.locator('.panel-body svg[aria-label="Convergence"]')).toBeVisible();
  // the second panel: both counts the tutorial lists beside every energy
  const basis = page.locator('.panel-body svg[aria-label="Basis-set size"]');
  await expect(basis).toBeVisible();
  await expect(basis.locator('polyline')).toHaveCount(2);
  await expect(page.getByRole('status')).toContainText(/Settled from|Not settled/);
  await page.screenshot({ path: join(SHOTS, 'iron-cutoff-basis.png') });
});
