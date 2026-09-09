/**
 * The vibrational modes and the IR spectrum, as ASE's `Infrared` example produces them.
 *
 * Water, because its three modes are textbook and checkable: a bend near 1600 cm^-1 and two O-H
 * stretches near 3700 (experiment: 1595, 3657, 3756). Out of the shared suite because it runs a
 * real finite-difference Hessian.
 *
 * The intensities come from point-charge dipole derivatives, and they have to: none of ASE's
 * built-in calculators implements `get_dipole_moment`, which `Infrared` needs -- EMT,
 * Lennard-Jones and Morse all raise PropertyNotImplementedError. That is why the Open Babel
 * path with Gasteiger charges is the one that produces intensities at all.
 */
import { test, expect } from '@playwright/test';
import { join } from 'node:path';

const SHOTS = join(process.cwd(), '..', '.scratch', 'course-shots');

test('water: three modes, an IR spectrum, and an animation', async ({ page }) => {
  await page.goto('/');

  // build water from SMILES so the test does not depend on a project on disk
  page.once('dialog', (d) => void d.accept('O'));
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Build from SMILES…' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('3 atoms, 2 bonds');

  await page.getByRole('tab', { name: 'Spectra' }).click();
  const panel = page.locator('.panel').filter({ has: page.locator('#vib-ff') });
  await panel.getByRole('button', { name: 'Compute modes' }).click();

  // three real modes for a triatomic: 3N - 6 = 3
  const rows = panel.locator('table tbody tr');
  await expect(rows).toHaveCount(3, { timeout: 120_000 });

  const text = (await panel.textContent()) ?? '';
  const freqs = [...text.matchAll(/(\d{3,4})\.\d/g)].map((m) => Number(m[1]));
  // the bend, and the two stretches
  expect(freqs.some((f) => f > 1400 && f < 1800)).toBeTruthy();
  expect(freqs.filter((f) => f > 3400 && f < 4000).length).toBeGreaterThanOrEqual(2);
  // and no imaginary mode: the geometry was minimised first
  expect(text).not.toMatch(/-\d{3,4}\.\d/);

  // the broadened spectrum is below the fold in this panel, and a screenshot that does not
  // contain it is not a picture of the spectrum -- the same trap the friction chart sprang
  const spectrum = page.locator('svg[aria-label*="IR"], svg[aria-label*="Absorbance"]').first();
  await spectrum.scrollIntoViewIfNeeded();
  await expect(spectrum).toBeVisible();
  expect(await spectrum.locator('polyline, path').count()).toBeGreaterThan(0);
  await page.screenshot({ path: join(SHOTS, 'water-ir.png') });

  // the mode animates on the molecule, which is what makes it readable
  await panel.getByRole('button', { name: /Animate/ }).click();
  await expect(panel.getByRole('button', { name: /Stop/ })).toBeEnabled();
  await page.screenshot({ path: join(SHOTS, 'water-mode-animation.png') });
  await panel.getByRole('button', { name: /Stop/ }).click();
});
