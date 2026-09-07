import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * The Database tab against the course project's real 22 rows. Kept with the other course
 * pictures (ATOMSCOPE_COURSE=1): it opens a project of its own.
 */
const RUNS = join(process.cwd(), '..', '.scratch', 'course-runs');
const SHOTS = join(process.cwd(), '..', '.scratch', 'course-shots');

test('the database selects the course calculations by chemistry', async ({ page, request }) => {
  const base = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://127.0.0.1:5173';
  const project = join(RUNS, 'course');
  test.skip(!existsSync(project), 'run the course exercises first');

  await request.post(`${base}/api/project/close`);
  expect(
    (await request.post(`${base}/api/project/open`, { data: { path: project } })).ok(),
  ).toBeTruthy();

  await page.goto('/');
  await page.getByRole('tab', { name: 'Database' }).click();

  // scoped to the panel: 'Select' is also the name of the selection tool in the toolbar
  const panel = page.getByLabel('Database');
  const status = panel.getByRole('status');
  const select = panel.getByRole('button', { name: 'Select' });
  await expect(status).toHaveText('22 calculations', { timeout: 20_000 });

  // iron: the reference plus the eight cutoff points plus the five dual-cutoff points
  await panel.getByLabel('Selection').fill('Fe');
  await select.click();
  await expect(status).toHaveText('14 of 22 match Fe');
  await expect(panel.getByRole('cell', { name: 'iron-reference' })).toBeVisible();

  // chemistry and a parameter together, which is the point of the thing
  await panel.getByLabel('Selection').fill('Si,epwpsi=30');
  await select.click();
  await expect(status).toContainText('match Si,epwpsi=30');
  await expect(panel.locator('.orbital-table tbody tr')).toHaveCount(5);

  await panel.getByLabel('Selection').fill('H');
  await select.click();
  await expect(status).toHaveText('3 of 22 match H');
  await page.screenshot({ path: join(SHOTS, 'database-water.png') });

  // an example is a button
  await panel.getByTitle('contains both iron and oxygen').click();
  await expect(status).toContainText('match Fe,O');
});
