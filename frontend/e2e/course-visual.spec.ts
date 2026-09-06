import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Pictures of the course results, taken in the running application. Not a regression test: it
 * needs `.scratch/course-runs/` to hold finished CP-PAW runs (`scripts/course/run.py`), and it
 * skips when they are not there.
 */
const RUNS = join(process.cwd(), '..', '.scratch', 'course-runs');
const SHOTS = join(process.cwd(), '..', '.scratch', 'course-shots');

test('water: the HOMO as an isosurface', async ({ page, request }) => {
  const base = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://127.0.0.1:5173';
  const cube = join(RUNS, 'water-orbitals', 'work', 'case_orb_b4k1s1.cub');
  test.skip(!existsSync(cube), 'run scripts/course/run.py water-orbitals first');
  // no project is created or closed here: the suite shares one, and taking a picture must not
  // pull it out from under the specs that run after this one

  // the relaxed geometry the orbital belongs to
  const imported = await request.post(`${base}/api/io/import/path`, {
    data: { path: join(RUNS, 'water-relax', 'final.xyz') },
  });
  expect(imported.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByRole('tab', { name: 'Surfaces' }).click();
  await page.getByLabel('Import cube').fill(cube);
  await page.getByLabel('cube kind').selectOption('orbital');
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText(/orbital · \d+ × \d+ × \d+/)).toBeVisible();
  await page.getByRole('button', { name: 'Add surface' }).click();
  await expect(page.getByRole('slider', { name: /Isovalue/ })).toBeVisible();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(SHOTS, 'water-homo.png') });
});
