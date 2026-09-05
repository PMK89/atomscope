import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';

test('a file opened by path comes back in the File menu', async ({ page }) => {
  // inside frontend/test-results/, never outside the repository
  const target = join(test.info().outputPath('open'), 'ethene.xyz');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(
    target,
    '6\nethene\nC 0 0 0\nC 1.33 0 0\nH -0.5 0.9 0\nH -0.5 -0.9 0\nH 1.83 0.9 0\nH 1.83 -0.9 0\n',
  );

  await page.goto('/');
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Open…' }).click();
  await page.getByLabel('Path on this machine').fill(target);
  await page.getByRole('button', { name: 'Open path' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('6 atoms');

  // the list is the backend's, so it is there after a reload as well
  await page.reload();
  await page.getByRole('button', { name: 'File' }).click();
  await expect(page.getByRole('menuitem', { name: 'ethene.xyz' })).toBeVisible();
  await page.screenshot({ path: '../.scratch/dev/recent-files.png' });

  await page.getByRole('menuitem', { name: 'Clear recent' }).click();
  await page.getByRole('button', { name: 'File' }).click();
  await expect(page.getByRole('menuitem', { name: 'ethene.xyz' })).toBeHidden();
});
