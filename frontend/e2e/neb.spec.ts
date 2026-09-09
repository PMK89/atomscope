/**
 * The reaction-path panel, on the system ASE's own NEB tutorial uses: Au hopping between two
 * hollow sites on Al(100) with EMT, whose barrier ASE documents as about 0.40 eV.
 *
 * Out of the shared suite (it needs a project with both endpoints in it and takes a few seconds
 * of real optimisation); run with ATOMSCOPE_COURSE=1. The project is built by
 * `scripts/make_neb_project.py` -- without it this test skips rather than fails.
 */
import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const RUNS = join(process.cwd(), '..', '.scratch');
const SHOTS = join(RUNS, 'course-shots');

test('Au on Al(100): the band, its barrier and the path', async ({ page, request }) => {
  const base = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://127.0.0.1:5173';
  const project = join(RUNS, 'neb-proj');
  test.skip(!existsSync(project), 'create .scratch/neb-proj with both endpoints first');

  await request.post(`${base}/api/project/close`);
  expect(
    (await request.post(`${base}/api/project/open`, { data: { path: project } })).ok(),
  ).toBeTruthy();

  await page.goto('/');
  // load one end into the viewport; it is the band's first image
  await page.getByRole('button', { name: /Au hollow site A/ }).click();
  await page.getByRole('tab', { name: 'Path' }).click();

  const panel = page.locator('.neb-panel');
  await page.locator('#neb-final').selectOption({ label: 'Au hollow site B' });
  await page.locator('#neb-images').fill('5');
  await page.getByRole('button', { name: 'Run NEB' }).click();

  // the number is checkable: ASE's tutorial documents ~0.40 eV for this hop
  await expect(panel.getByText(/Barrier/)).toBeVisible({ timeout: 120_000 });
  const text = (await panel.getByText(/Barrier/).textContent()) ?? '';
  const barrier = Number(/([\d.]+) eV/.exec(text)?.[1]);
  expect(barrier).toBeGreaterThan(0.35);
  expect(barrier).toBeLessThan(0.45);
  await expect(panel.getByText(/converged/)).toBeVisible();
  // the saddle is the middle image of a symmetric hop
  await expect(panel.getByText(/at image 2/)).toBeVisible();

  const chart = page.locator('svg[aria-label="Reaction path"]');
  await expect(chart).toBeVisible();
  await expect(chart.locator('polyline')).toHaveCount(1);
  await expect(chart).toContainText('TS');

  // and the band itself is the trajectory, so the player can walk the path
  await expect(page.getByText(/frame 1\/5/)).toBeVisible();
  await page.screenshot({ path: join(SHOTS, 'neb-path.png') });
});
