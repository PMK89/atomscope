import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';

/** Phenol as a sketcher writes it: a connection table and flat coordinates, no hydrogens. */
const PHENOL_2D = `phenol
     RDKit          2D

  7  7  0  0  0  0  0  0  0  0999 V2000
    0.3214   -1.2990    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
   -1.1786   -1.2990    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
   -1.9286    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
   -1.1786    1.2990    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    0.3214    1.2990    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.0714   -0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    2.5714    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0
  2  3  2  0
  3  4  1  0
  4  5  2  0
  5  6  1  0
  6  7  1  0
  6  1  2  0
M  END
`;

test('a file drawn in two dimensions is offered a geometry, and gets one', async ({ page }) => {
  const target = join(test.info().outputPath('open'), 'phenol.mol');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, PHENOL_2D);

  await page.goto('/');
  // the question is a browser confirm: answer it before the click that raises it
  const asked: string[] = [];
  page.on('dialog', (d) => {
    asked.push(d.message());
    void d.accept();
  });

  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Open…' }).click();
  await page.getByLabel('Path on this machine').fill(target);
  await page.getByRole('button', { name: 'Open path' }).click();

  // seven heavy atoms drawn; six hydrogens built onto them
  await expect(page.locator('.app-statusbar')).toContainText('13 atoms');
  expect(asked.join('\n')).toContain('no 3D coordinates');
  // and it is one undo step: Edit ▸ Undo names it and gives the drawing back
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('menuitem', { name: /Undo Build 3D geometry/ })).toBeVisible();
  await page.getByRole('menuitem', { name: /Undo Build 3D geometry/ }).click();
  await expect(page.locator('.app-statusbar')).toContainText('7 atoms');
});
