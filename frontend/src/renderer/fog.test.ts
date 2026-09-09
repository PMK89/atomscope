/**
 * The depth-cueing band, against Avogadro's own formula (`glwidget.cpp:772-773`) and the four
 * levels its settings dialog names for the 0-9 `fogLevel` (`settingsdialog.cpp:118-142`).
 */
import { describe, expect, it } from 'vitest';

import { FOG_LEVELS, fogBand } from './Renderer';

describe('fogBand', () => {
  it('uses the levels Avogadro names', () => {
    // None is 0, and Some/Mid/Lots are the middles of its 1-3, 4-6 and 7-9 bands
    expect(FOG_LEVELS).toEqual({ none: 0, some: 2, mid: 5, lots: 8 });
  });

  it('is Avogadro arithmetic', () => {
    const d = 30;
    const r = 6;
    for (const [name, l] of Object.entries(FOG_LEVELS)) {
      const { near, far } = fogBand(d, r, name as keyof typeof FOG_LEVELS);
      expect(near).toBeCloseTo(d - (l / 8) * r, 6);
      expect(far).toBeCloseTo(d + ((10 - l) / 8) * 2 * r, 6);
    }
  });

  it('gets denser as the level rises', () => {
    const band = (l: keyof typeof FOG_LEVELS) => fogBand(30, 6, l);
    const order = (['none', 'some', 'mid', 'lots'] as const).map(band);
    for (let i = 1; i < order.length; i++) {
      // both ends come towards the camera, which is what thickens the fog
      expect(order[i]!.near).toBeLessThan(order[i - 1]!.near);
      expect(order[i]!.far).toBeLessThan(order[i - 1]!.far);
    }
  });

  it('falls back to the old band when there is nothing to measure', () => {
    // no structure, so no radius: this is what the boolean fog did before the levels existed
    for (const r of [undefined, 0, NaN]) {
      expect(fogBand(20, r, 'lots')).toEqual({ near: 20, far: 44 });
    }
  });

  it('never puts the near plane behind the camera, or the far plane in front of the near', () => {
    // a big molecule seen from close up: level 8 would otherwise give a negative near
    const { near, far } = fogBand(1, 100, 'lots');
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
  });
});
