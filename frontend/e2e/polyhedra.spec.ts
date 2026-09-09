import { expect, test } from '@playwright/test';
import { join } from 'node:path';

const SHOTS = join(process.cwd(), '..', '.scratch', 'dev');

/**
 * Avogadro's Polygon engine on a real crystal: periclase (MgO, rocksalt), where every magnesium
 * is octahedrally coordinated and oxygen is one of the elements the engine skips. So the picture
 * is four octahedra on the magnesium sites with the oxygens as their corners, which is how a
 * coordination structure is normally drawn.
 */
test('coordination polyhedra on periclase', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build' }).click();
  await page.getByRole('menuitem', { name: 'Crystal library…' }).click();
  await page.getByPlaceholder(/name or formula/).fill('Periclase');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /MgO-Periclase/ }).click();
  await expect(page.locator('.app-statusbar')).toContainText('8 atoms', { timeout: 20_000 });
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Display' }).click();
  await page.locator('#display-style').selectOption('ball-and-stick');
  await page.locator('#display-polygons').check();
  await page.waitForTimeout(700);
  const drawn = await page.evaluate(() => {
    const r = (window as unknown as { __atomscopeRenderer?: unknown }).__atomscopeRenderer as {
      getLayer(id: string): { polyhedra(): number } | undefined;
    };
    return r.getLayer('polygons')?.polyhedra() ?? -1;
  });
  expect(drawn).toBe(4); // the four magnesium sites; oxygen is skipped
  await page.locator('canvas').screenshot({ path: join(SHOTS, 'polyhedra-mgo.png') });
});
