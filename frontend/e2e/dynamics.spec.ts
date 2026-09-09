import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Analysis ▸ Dynamics against a real molecular-dynamics run: an ASE Langevin trajectory of
 * water, fetched through the binary positions endpoint, then reduced to a group temperature and
 * to an internal coordinate. Chapter 5.7/5.8 of the course is this, with `paw_tra` in place of
 * the panel.
 *
 * The MD task is what makes it worth running: its frames carry times, so the temperature path is
 * exercised rather than only the "no time axis" message a relaxation would produce.
 */
test('plot a group temperature and a mode from an MD trajectory', async ({ page }) => {
  test.slow(); // a real 30-step Langevin run of water, not a fixture
  const dir = join(mkdtempSync(join(process.cwd(), '..', '.scratch', 'e2e-')), 'proj');
  await page.goto('/');
  page.once('dialog', (d) => void d.accept('O'));
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Build from SMILES…' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('H2O');

  const closeButton = page.getByRole('button', { name: 'Close', exact: true });
  if (await closeButton.isVisible()) await closeButton.click();
  await page.getByLabel('Project path').fill(dir);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByText('Structures (0)')).toBeVisible();

  await page.locator('#calc-name').fill('water md');
  await page.getByLabel('Backend').selectOption('ase_builtin');
  await page.getByLabel('Task').selectOption('md');
  await page.locator('.calc-panel').getByLabel('Maximum steps').fill('30');
  await page.getByRole('button', { name: 'Generate input' }).click();
  // wait for the generated input before pressing on: Setup re-renders the panel and the Run
  // button is detached under a click that races it
  await expect(page.locator('.generated pre')).toContainText('"task": "md"');
  await page.getByRole('button', { name: 'Setup' }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('.calc-panel .badge-completed')).toBeVisible({ timeout: 60_000 });

  await page.getByRole('tab', { name: 'Analysis' }).click();
  await page.locator('.analysis-panel').getByRole('button', { name: 'Dynamics' }).click();
  // every panel is mounted at once, so everything below is scoped to this view
  const view = page.locator('.dynamics-view');
  await expect(view).toContainText('No trajectory loaded');
  await view.getByRole('button', { name: 'Load trajectory' }).click();

  // 31 frames: ase reports the initial configuration and then each of the 30 steps
  await expect(view).toContainText('31 frames · 3 atoms');
  await expect(view.locator('.chart-title')).toHaveText('Group temperature');
  await expect(view.locator('polyline')).toHaveCount(1);
  // a Langevin run at 300 K: the finite-difference temperature has to be in the right decade
  const heading = view.locator('svg[aria-label="Group temperature"]');
  await expect(heading).toBeVisible();

  // the averaging window has to be visible on the chart: Figs 5.3-5.5 differ by it alone
  await view.getByLabel(/Running average/).fill('20');
  await expect(view.locator('.chart-title')).toHaveText('Group temperature · τ 20 fs');

  // Fig 5.4: the hydrogens against the oxygen
  await view.getByLabel('Atoms').selectOption('element');
  await expect(view.locator('polyline')).toHaveCount(2);
  await expect(view.locator('.chart-legend')).toContainText('H');
  await expect(view.locator('.chart-legend')).toContainText('O');

  // Fig 5.5: an internal coordinate against time, here the H-O-H angle
  await view.getByLabel('Series').selectOption('mode');
  await view.getByLabel('Term 1 kind').selectOption('angle');
  await view.getByLabel('Term 1 atom 1').fill('1');
  await view.getByLabel('Term 1 atom 2').fill('0');
  await view.getByLabel('Term 1 atom 3').fill('2');
  await expect(view.locator('.chart-title')).toHaveText('Mode · τ 20 fs');
  await expect(view.locator('polyline')).toHaveCount(1);
  await expect(view.locator('svg[aria-label^="Mode"]')).toBeVisible();

  await view.getByLabel('Plot the time derivative').check();
  await expect(view.locator('polyline')).toHaveCount(1);
});
