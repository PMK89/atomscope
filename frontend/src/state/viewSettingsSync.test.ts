import { applyPersisted, pickPersisted } from './viewSettingsSync';
import { DISPLAY_TYPE_DEFAULTS, useViewStore } from './viewStore';

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

test('label and cell settings survive a round trip', () => {
  useViewStore.setState({
    atomLabels: 'partial_charge',
    labelColor: '#ff0000',
    labelShift: [0, 0.5, 0],
    cellRepeat: [2, 1, 1],
  });
  const stored = JSON.parse(JSON.stringify(pickPersisted(useViewStore.getState())));
  useViewStore.setState({
    atomLabels: 'symbol_index',
    labelColor: '#222222',
    labelShift: [0, 0, 0],
    cellRepeat: [1, 1, 1],
  });

  applyPersisted(stored);
  const s = useViewStore.getState();
  expect(s.atomLabels).toBe('partial_charge');
  expect(s.labelColor).toBe('#ff0000');
  expect(s.labelShift).toEqual([0, 0.5, 0]);
  expect(s.cellRepeat).toEqual([2, 1, 1]);
});

test('switching a nullable setting back off is stored', () => {
  useViewStore.setState({ selectionStyle: 'vdw' });
  expect(pickPersisted(useViewStore.getState()).selectionStyle).toBe('vdw');
  useViewStore.setState({ selectionStyle: null });
  const stored = JSON.parse(JSON.stringify(pickPersisted(useViewStore.getState())));
  expect('selectionStyle' in stored).toBe(true);

  useViewStore.setState({ selectionStyle: 'stick' });
  applyPersisted(stored);
  expect(useViewStore.getState().selectionStyle).toBeNull();
});

test('a stored value of the wrong shape is ignored', () => {
  useViewStore.setState({ labelShift: [0, 0, 0], labelSize: 0.55 });
  applyPersisted({ labelShift: 'nope', labelSize: [1, 2], atomLabels: 'symbol' });
  const s = useViewStore.getState();
  expect(s.labelShift).toEqual([0, 0, 0]);
  expect(s.labelSize).toBe(0.55);
  expect(s.atomLabels).toBe('symbol');
});

test('a request counter is not a setting, and a chosen background is', () => {
  useViewStore.getState().requestCenter();
  useViewStore.getState().setBackgroundColor('#123456');
  const out = pickPersisted(useViewStore.getState());
  expect(out['centerRequest']).toBeUndefined();
  expect(out['fitRequest']).toBeUndefined();
  expect(out['backgroundColor']).toBe('#123456');

  // and it comes back, without the counter being restored over a live one
  const before = useViewStore.getState().centerRequest;
  applyPersisted({ ...out, centerRequest: 99 });
  expect(useViewStore.getState().backgroundColor).toBe('#123456');
  expect(useViewStore.getState().centerRequest).toBe(before);

  // choosing a preset again takes the custom colour away, so there is one answer
  useViewStore.getState().setBackground('black');
  expect(useViewStore.getState().backgroundColor).toBe('');
});

test('a project stored before the radius basis existed keeps the picture it was saved with', () => {
  // `atomScale` used to be a fraction of the covalent radius. Reading an old project's 0.35 on
  // the new van der Waals default would draw every atom about twice the size it was saved at.
  useViewStore.setState({ radiusBasis: 'vdw' });
  applyPersisted({ atomScale: 0.35, bondRadius: 0.12 });
  expect(useViewStore.getState().radiusBasis).toBe('covalent');
  expect(useViewStore.getState().atomScale).toBe(0.35);

  // a project that stores the basis is taken at its word, in both directions
  applyPersisted({ atomScale: 0.3, radiusBasis: 'vdw' });
  expect(useViewStore.getState().radiusBasis).toBe('vdw');
  applyPersisted({ atomScale: 0.3, radiusBasis: 'covalent' });
  expect(useViewStore.getState().radiusBasis).toBe('covalent');
});

test('settings that say nothing about radii do not force the old basis', () => {
  useViewStore.setState({ radiusBasis: 'vdw' });
  applyPersisted({ background: 'black' });
  expect(useViewStore.getState().radiusBasis).toBe('vdw');
});

test('resetting the display types leaves the camera and the preferences alone', () => {
  // Avogadro's View > Reset Display Types restores the engine set, not the application's
  // preferences -- losing your background and projection because you wanted default radii back
  // would be a surprise.
  useViewStore.setState({
    style: 'vdw',
    atomScale: 0.9,
    radiusBasis: 'covalent',
    opacity: 0.3,
    showLabels: true,
    background: 'black',
    projection: 'orthographic',
    quality: 'high',
    fog: 'lots',
  });
  useViewStore.getState().resetDisplayTypes();

  const s = useViewStore.getState();
  expect(s.style).toBe('ball-and-stick');
  expect(s.atomScale).toBe(DISPLAY_TYPE_DEFAULTS.atomScale);
  expect(s.radiusBasis).toBe('vdw');
  expect(s.opacity).toBe(1);
  expect(s.showLabels).toBe(false);
  // untouched
  expect(s.background).toBe('black');
  expect(s.projection).toBe('orthographic');
  expect(s.quality).toBe('high');
  expect(s.fog).toBe('lots');
});
