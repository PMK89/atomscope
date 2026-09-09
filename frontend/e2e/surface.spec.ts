import { expect, test } from '@playwright/test';
import { join } from 'node:path';

/**
 * A named surface and an adsorbate on one of its sites, through the browser.
 *
 * The named builders exist for exactly one reason the generic Miller-index cut cannot give: the
 * site names. So what this checks is that a slab built here offers them and that placing an
 * adsorbate on one lands it there — including the second one, which is where the height reference
 * would go wrong if the surface information were not carried with the structure.
 */
const SHOTS = join(process.cwd(), '..', '.scratch', 'dev');

test('a named surface offers its sites and takes an adsorbate', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Crystal' }).click();
  await page.getByRole('button', { name: 'Build' }).click();
  await page.getByRole('menuitem', { name: 'Surface slab…' }).click();

  const dialog = page.getByRole('dialog', { name: 'Surface slab' });
  await expect(dialog).toBeVisible();
  // the default is the Miller-index cut, which has no named sites
  await dialog.getByLabel('Surface').selectOption('fcc111');
  await expect(dialog).toContainText('bridge, fcc, hcp, ontop');
  await dialog.getByLabel('Element').fill('Cu');
  await dialog.getByLabel('Layers').fill('3');
  await dialog.getByLabel('Vacuum (Å)').fill('8');
  await dialog.getByRole('button', { name: 'Build slab' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.app-statusbar')).toContainText('12 atoms');

  const panel = page.locator('.adsorbate-section');
  await panel.scrollIntoViewIfNeeded();
  await expect(panel).toContainText('4 named sites');
  await panel.getByLabel('Site').selectOption('fcc');
  await panel.getByLabel('Adsorbate').fill('O');
  await panel.getByRole('button', { name: 'Add adsorbate' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('13 atoms');

  // a second one on another site, which is where a forgotten top-layer reference would show:
  // it would be placed above the first oxygen instead of above the copper
  await panel.getByLabel('Site').selectOption('hcp');
  await panel.getByRole('button', { name: 'Add adsorbate' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('14 atoms');

  await panel.screenshot({ path: join(SHOTS, 'adsorbate-section.png') });

  // the two oxygens are at the same height, read out of the coordinate editor rather than out of
  // the renderer: a forgotten top-layer reference would put the second one above the first
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('menuitem', { name: 'Cartesian editor…' }).click();
  // scoped to the dialog: 'Coordinates' also names a control in one of the mounted panels
  const editor = page.getByRole('dialog', { name: 'Cartesian editor' });
  const coordinates = editor.getByLabel('Coordinates');
  const oxygenLines = async (): Promise<string[]> =>
    (await coordinates.inputValue()).split('\n').filter((line) => /^\s*O\s/.test(line));
  // the editor fills its text from the structure in an effect, so poll for the two oxygens
  // rather than reading a textarea that may still be empty
  await expect.poll(async () => (await oxygenLines()).length).toBe(2);
  const zs = (await oxygenLines()).map((line) => Number(line.trim().split(/\s+/)[3]));
  expect(zs).toHaveLength(2);
  expect(Math.abs(zs[0]! - zs[1]!)).toBeLessThan(1e-4);
});
