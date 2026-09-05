import { beforeEach, expect, test, vi } from 'vitest';
import { makeAtom, normalizeStructure } from '../model/structure';
import { useProjectStore } from '../state/projectStore';
import { useStructureStore } from '../state/structureStore';
import { promptSaveAs, saveStructure, saveStructureAs } from './fileActions';

const put = vi.fn(async () => ({}));
vi.mock('../api/client', () => ({
  api: {
    structures: {
      put: (doc: unknown) => put(doc as never),
    },
  },
}));

const errors: string[] = [];
const onError = (m: string): void => void errors.push(m);

beforeEach(() => {
  errors.length = 0;
  put.mockClear();
  useProjectStore.setState({
    info: { path: '/tmp/p', name: 'p' } as never,
    structures: [],
    refresh: async () => {},
  });
  useStructureStore
    .getState()
    .load(normalizeStructure({ name: 'water', atoms: [makeAtom('O', [0, 0, 0])] } as never));
});

test('saving marks the document unmodified again', async () => {
  const store = useStructureStore.getState();
  store.commit('edit', { ...store.doc, name: 'water' });
  expect(useStructureStore.getState().isModified()).toBe(true);

  expect(await saveStructure(onError)).toBe(true);
  expect(put).toHaveBeenCalledOnce();
  expect(useStructureStore.getState().isModified()).toBe(false);
});

test('save as writes a new structure and continues editing the copy', async () => {
  const before = useStructureStore.getState().doc;
  expect(await saveStructureAs('supercell', onError)).toBe(true);

  const written = put.mock.calls[0]![0] as unknown as { id: string; name: string };
  expect(written.name).toBe('supercell');
  expect(written.id).not.toBe(before.id);

  const after = useStructureStore.getState();
  expect(after.doc.id).toBe(written.id);
  expect(after.doc.name).toBe('supercell');
  // the copy is what is stored now, so it starts unmodified
  expect(after.isModified()).toBe(false);
});

test('saving without a project says so instead of failing silently', async () => {
  useProjectStore.setState({ info: null });
  expect(await saveStructure(onError)).toBe(false);
  expect(await saveStructureAs('x', onError)).toBe(false);
  expect(errors).toEqual(['Open a project before saving', 'Open a project before saving']);
  expect(put).not.toHaveBeenCalled();
});

test('a failed save is reported and leaves the document modified', async () => {
  const store = useStructureStore.getState();
  store.commit('edit', { ...store.doc, charge: 1 });
  put.mockRejectedValueOnce(new Error('disk full'));

  expect(await saveStructure(onError)).toBe(false);
  expect(errors[0]).toMatch(/disk full/);
  expect(useStructureStore.getState().isModified()).toBe(true);
});

test('cancelling the Save as prompt writes nothing', async () => {
  vi.spyOn(window, 'prompt').mockReturnValueOnce(null);
  await promptSaveAs(onError);
  expect(put).not.toHaveBeenCalled();

  vi.spyOn(window, 'prompt').mockReturnValueOnce('  named  ');
  await promptSaveAs(onError);
  expect((put.mock.calls[0]![0] as unknown as { name: string }).name).toBe('named');
});
