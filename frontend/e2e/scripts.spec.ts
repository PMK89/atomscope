import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Python written and executed from inside Atomscope, for real: the script is stored in the
 * project, a child interpreter runs it, and what it prints, emits and saves comes back into the
 * panel. This is the acceptance test for the scripting subsystem -- everything below the panel
 * (job manager, runner, structure round trip) is exercised by it.
 */
const SHOTS = join(process.cwd(), '..', '.scratch', 'dev');

const SOURCE = [
  'from atomscope.scripting import save, value',
  '',
  "print('atoms:', len(atoms))",
  "value('formula', atoms.get_chemical_formula())",
  'shifted = atoms.copy()',
  'shifted.translate([2.0, 0.0, 0.0])',
  "save(shifted, name='shifted')",
  '',
].join('\n');

test('a script runs in the project and hands a structure back', async ({ page }) => {
  const dir = join(mkdtempSync(join(process.cwd(), '..', '.scratch', 'e2e-')), 'scripts');
  await page.goto('/');
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

  await page.getByRole('tab', { name: 'Scripts' }).click();
  const panel = page.locator('.scripts-panel');

  // the name is asked for with a prompt, as the rest of the application does
  page.once('dialog', (d) => void d.accept('shift-x'));
  await panel.getByRole('button', { name: 'New…' }).click();
  // by id: getByLabel matches substrings, and 'script' is also inside 'Script source'
  await expect(panel.locator('#script-id')).toHaveValue('shift-x');

  const editor = panel.getByLabel('Script source');
  await editor.fill(SOURCE);
  await panel.getByRole('button', { name: 'Run' }).click();

  await expect(panel.getByRole('status')).toHaveText('completed', { timeout: 60_000 });
  // what the script printed, and the value it emitted
  await expect(panel.locator('.script-output')).toContainText('atoms: 3');
  await expect(panel.locator('.script-values')).toContainText('formula');
  await expect(panel.locator('.script-values')).toContainText('H2O');

  // the structure it saved is a structure of the project, and opens into the viewport
  await expect(panel).toContainText('The script saved one structure');
  await panel.scrollIntoViewIfNeeded();
  await panel.screenshot({ path: join(SHOTS, 'scripts-panel.png') });
  page.once('dialog', (d) => void d.accept());
  await panel.getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('.app-statusbar')).toContainText('shifted');

  // and a script that raises reports the traceback rather than failing silently
  await page.getByRole('tab', { name: 'Scripts' }).click();
  await editor.fill("raise ValueError('deliberate')\n");
  await panel.getByRole('button', { name: 'Run' }).click();
  await expect(panel.getByRole('status')).toHaveText('failed', { timeout: 60_000 });
  await expect(panel).toContainText('ValueError: deliberate');
  await expect(panel.locator('.script-output')).toContainText('Traceback (most recent call last)');
});
