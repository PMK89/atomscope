import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * The core mission workflow in the browser: create a project, configure an ASE built-in EMT
 * relaxation of the demo molecule's replacement (copper), run it, watch it complete, read the
 * energy, load the final structure. Uses a temporary project directory.
 */
test('create project, configure, run and inspect an ASE calculation', async ({ page }) => {
  const dir = join(mkdtempSync(join(process.cwd(), '..', '.scratch', 'e2e-')), 'proj');
  await page.goto('/');
  // Load a copper structure via SMILES is impossible; use the SMILES builder for an EMT-supported
  // molecule instead: EMT knows H, C, N, O approximately.
  page.once('dialog', (d) => void d.accept('O'));
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Build from SMILES…' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('H2O');

  // another test may have left a project open on the shared backend
  const closeButton = page.getByRole('button', { name: 'Close', exact: true });
  if (await closeButton.isVisible()) await closeButton.click();
  await page.getByLabel('Project path').fill(dir);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByText('Structures (0)')).toBeVisible();

  await page.locator('#calc-name').fill('water emt');
  await page.getByLabel('Backend').selectOption('ase_builtin');
  await page.getByLabel('Task').selectOption('relax');
  // scoped to this panel: every panel is mounted at once, so a bare label can be shadowed by
  // another one's field -- the reaction-path panel also has a maximum-steps input
  await page.locator('.calc-panel').getByLabel('Maximum steps').fill('20');
  await page.getByRole('button', { name: 'Generate input' }).click();
  await expect(page.locator('.generated pre')).toContainText('"task": "relax"');
  await page.getByRole('button', { name: 'Setup' }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('.calc-panel .badge-completed')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.console')).toContainText('final energy');

  await page.getByRole('button', { name: 'Results' }).click();
  await expect(page.locator('.results')).toContainText('Energy:');
  await page.getByRole('button', { name: 'Load final structure' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('(result)');

  // completed calculations are immutable in the UI
  await page.getByRole('button', { name: 'Setup' }).click();
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Fork' })).toBeVisible();
  await expect(page.getByText('Calculations (1)')).toBeVisible();
});

/**
 * The input-generator half of the same panel (Avogadro's input generators): no binary is run, a
 * deck is written. MOPAC is the one whose keyword line carries everything, so it is the one
 * worth reading back in the browser.
 */
test('a MOPAC deck is generated from the panel and named .mop', async ({ page }) => {
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

  await page.locator('#calc-name').fill('water mopac');
  await page.getByLabel('Backend').selectOption('qc_inputs');
  await page.getByLabel('Program').selectOption('mopac');
  // the Hamiltonian replaces method and basis, which mean nothing to a semi-empirical code
  await expect(page.getByLabel('Basis set')).toBeHidden();
  await page.getByLabel('Hamiltonian').selectOption('AM1');
  await page.getByLabel('Calculation type').selectOption('frequencies');
  await page.getByRole('button', { name: 'Generate input' }).click();

  await expect(page.locator('.generated summary')).toContainText('.mop');
  await expect(page.locator('.generated pre')).toContainText('AM1 FORCE SINGLET');
});
