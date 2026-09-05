import { afterEach, expect, test, vi } from 'vitest';
import { makeAtom, normalizeStructure } from '../model/structure';
import { useStructureStore } from '../state/structureStore';
import { confirmReplace } from './replaceDocument';

const water = (): ReturnType<typeof normalizeStructure> =>
  normalizeStructure({ name: 'water', charge: 0, atoms: [makeAtom('O', [0, 0, 0])] });

afterEach(() => vi.restoreAllMocks());

test('an unmodified document is replaced without a word', () => {
  useStructureStore.getState().load(water());
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  expect(confirmReplace()).toBe(true);
  expect(confirm).not.toHaveBeenCalled();
});

test('unsaved work is asked about, and Cancel means no', () => {
  const st = useStructureStore.getState();
  st.load(water());
  st.commit('rename', { ...useStructureStore.getState().doc, name: 'edited' });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

  expect(confirmReplace()).toBe(false);
  expect(confirm.mock.calls[0]?.[0]).toMatch(/edited has unsaved changes/);
  expect(confirm.mock.calls[0]?.[0]).toMatch(/Ctrl\+S/);

  confirm.mockReturnValue(true);
  expect(confirmReplace()).toBe(true);
});
