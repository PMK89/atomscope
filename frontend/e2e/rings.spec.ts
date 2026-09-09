import { expect, test } from '@playwright/test';
import { join } from 'node:path';
const SHOTS = join(process.cwd(), '..', '.scratch', 'dev');

/**
 * Avogadro's Ring engine on caffeine, which is a five-ring fused to a six-ring. Two rings is the
 * whole point: the nine-membered perimeter is their sum, and a naive "every smallest cycle"
 * perception would fill it as a third.
 */
test('ring planes on caffeine', async ({ page }) => {
  await page.goto('/');
  page.once('dialog', (d) => void d.accept('Cn1cnc2c1c(=O)n(C)c(=O)n2C'));
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Build from SMILES…' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('24 atoms', { timeout: 30_000 });
  await page.getByRole('tab', { name: 'Display' }).click();
  await page.locator('#display-rings').check();
  await page.waitForTimeout(600);
  const drawn = await page.evaluate(() => {
    const r = (window as unknown as { __atomscopeRenderer?: unknown }).__atomscopeRenderer as {
      getLayer(id: string): { rings(): number } | undefined;
    };
    return r.getLayer('rings')?.rings() ?? -1;
  });
  expect(drawn).toBe(2); // caffeine's fused five- and six-ring
  await page.locator('canvas').screenshot({ path: join(SHOTS, 'rings-caffeine.png') });
});
