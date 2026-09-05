import { applyPersisted, pickPersisted } from './viewSettingsSync';
import { useViewStore } from './viewStore';

test('pickPersisted keeps plain settings and skips fitRequest', () => {
  const s = useViewStore.getState();
  const out = pickPersisted(s);
  expect(out).toMatchObject({ style: s.style, background: s.background });
  expect('fitRequest' in out).toBe(false);
  expect(Object.values(out).every((v) => typeof v !== 'function')).toBe(true);
});

test('applyPersisted only touches known keys', () => {
  applyPersisted({ style: 'stick', bogus: 1, fitRequest: 99 });
  const s = useViewStore.getState();
  expect(s.style).toBe('stick');
  expect((s as unknown as Record<string, unknown>)['bogus']).toBeUndefined();
  expect(s.fitRequest).not.toBe(99);
});
