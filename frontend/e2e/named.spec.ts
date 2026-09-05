import { expect, test } from '@playwright/test';

test('a selection can be named, recalled and removed', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-statusbar')).toContainText('H2O');

  // the two hydrogens, by element
  await page.locator('button.menu-title', { hasText: 'Select' }).click();
  page.once('dialog', (d) => void d.accept('H'));
  await page.getByRole('menuitem', { name: 'Select by element…' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('2 selected');

  await page.locator('button.menu-title', { hasText: 'Select' }).click();
  page.once('dialog', (d) => void d.accept('hydrogens'));
  await page.getByRole('menuitem', { name: 'Add named selection…' }).click();

  // cleared, then put back from the menu entry the set made
  await page.locator('button.menu-title', { hasText: 'Select' }).click();
  await page.getByRole('menuitem', { name: 'Select none' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('0 selected');
  await page.locator('button.menu-title', { hasText: 'Select' }).click();
  await page.getByRole('menuitem', { name: 'hydrogens' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('2 selected');

  await page.locator('button.menu-title', { hasText: 'Select' }).click();
  await page.getByRole('menuitem', { name: 'Named selections…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Named selections' });
  await expect(dialog.getByRole('cell', { name: 'hydrogens' })).toBeVisible();
  await page.screenshot({ path: '../.scratch/dev/named-selections.png' });

  await dialog.getByRole('button', { name: 'Remove' }).click();
  await expect(dialog.getByText(/No named selections/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});
