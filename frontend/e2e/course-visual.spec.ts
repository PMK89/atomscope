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
