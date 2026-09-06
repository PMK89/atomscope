import { expect, test } from '@playwright/test';

/**
 * What a drag turns about. The rule itself is unit-tested in `renderer/rotationCenter.test.ts`;
 * what this covers is the wiring those cannot see -- that the renderer really hands the rule the
 * selection, the atom under the pointer and the camera it is drawing with.
 */

interface Point {
  x: number;
  y: number;
  z: number;
}

const gap = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** A pixel over an atom and a pixel over nothing. Water is drawn small and off-centre, so both
 *  are found by asking rather than assumed. */
const pixels = async (
  page: import('@playwright/test').Page,
  box: { x: number; y: number; width: number; height: number },
): Promise<{ onAtom: { x: number; y: number }; onNothing: { x: number; y: number } }> =>
  page.evaluate((b) => {
    const renderer = (window as unknown as { __atomscopeRenderer: { pick: (x: number, y: number) => unknown } })
      .__atomscopeRenderer;
    let onAtom: { x: number; y: number } | null = null;
    let onNothing: { x: number; y: number } | null = null;
    for (let i = 0; i <= 40 && !(onAtom && onNothing); i++)
      for (let j = 0; j <= 40 && !(onAtom && onNothing); j++) {
        const p = { x: b.x + (b.width * i) / 40, y: b.y + (b.height * j) / 40 };
        const hit = renderer.pick(p.x, p.y) as { kind: string } | null;
        if (hit?.kind === 'atom') onAtom ??= p;
        else if (!hit) onNothing ??= p;
      }
    if (!onAtom || !onNothing) throw new Error('no atom or no empty pixel on the canvas');
    return { onAtom, onNothing };
  }, box);

test('a drag turns about the selection, the grabbed atom, or what is on screen', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.app-statusbar')).toContainText('H2O');
  const box = await page.locator('.viewport-canvas canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  const { onAtom, onNothing } = await pixels(page, box);

  const centreAt = (p: { x: number; y: number }): Promise<Point | null> =>
    page.evaluate(
      (q) =>
        (
          window as unknown as {
            __atomscopeRenderer: { rotationCenter: (x: number, y: number) => Point | null };
          }
        ).__atomscopeRenderer.rotationCenter(q.x, q.y),
      p,
    );

  // nothing selected: over an atom it is that atom, over empty space it is the barycentre of
  // what is in view, and for a molecule whose atoms are not all at its centre those differ
  const grabbed = await centreAt(onAtom);
  const looked = await centreAt(onNothing);
  expect(grabbed).not.toBeNull();
  expect(looked).not.toBeNull();
  expect(gap(grabbed!, looked!)).toBeGreaterThan(0.05);

  // select that atom -- the Navigate tool does not select, so this is the Select tool ("s") and
  // then back to Navigate ("n"), which is the round trip a person makes to rotate about something
  await page.keyboard.press('s');
  await page.mouse.click(onAtom.x, onAtom.y);
  await expect(page.locator('.app-statusbar')).toContainText('1 selected');
  await page.keyboard.press('n');

  // now even a drag begun on empty space turns about the selected atom
  const selected = await centreAt(onNothing);
  expect(selected).not.toBeNull();
  expect(gap(selected!, grabbed!)).toBeLessThan(1e-9);

  // and the drag really orbits it: the camera keeps its distance to the selected atom, which it
  // could only do by moving the pivot out of the way
  const state = (): Promise<{ pivot: Point; camera: Point }> =>
    page.evaluate(() => {
      const c = (
        window as unknown as {
          __atomscopeRenderer: { controller: { pivot: Point; camera: { position: Point } } };
        }
      ).__atomscopeRenderer.controller;
      return {
        pivot: { x: c.pivot.x, y: c.pivot.y, z: c.pivot.z },
        camera: { x: c.camera.position.x, y: c.camera.position.y, z: c.camera.position.z },
      };
    });

  const before = await state();
  await page.mouse.move(onNothing.x, onNothing.y);
  await page.mouse.down();
  await page.mouse.move(onNothing.x + 90, onNothing.y + 40, { steps: 8 });
  await page.mouse.up();
  const after = await state();

  expect(gap(after.camera, selected!)).toBeCloseTo(gap(before.camera, selected!), 4);
  expect(gap(after.pivot, before.pivot)).toBeGreaterThan(0.01);
  await page.screenshot({ path: '../.scratch/dev/rotate-about-selection.png' });
});
