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
